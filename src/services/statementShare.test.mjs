import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"

const script = await readFile(new URL("../../public/share-target-handler.js", import.meta.url), "utf8")
const origin = "https://finsight.example", sharedKey = "/__finsight_shared_pdf__"
const shareHarness = () => {
  const events = new Map(), stored = new Map()
  const key = (url) => new URL(url, origin).pathname
  const cache = { match: async (url) => stored.get(key(url))?.clone(), delete: async (url) => stored.delete(key(url)), put: async (url, response) => stored.set(key(url), response) }
  vm.runInNewContext(script, { URL, Response, Headers, Blob, Date, caches: { open: async () => cache }, self: { location: { origin }, addEventListener: (type, listener) => events.set(type, [...(events.get(type) || []), listener]) } })
  const share = async (files) => {
    const data = new FormData()
    files.forEach((file) => data.append("statement", file))
    let response
    const event = { request: new Request(`${origin}/share-target`, { method: "POST", body: data }), respondWith: (value) => { response = value }, waitUntil() {} }
    events.get("fetch").forEach((handler) => handler(event))
    return await response
  }
  const expire = async () => {
    const waits = []
    events.get("activate").forEach((handler) => handler({ waitUntil: (value) => waits.push(value) }))
    await Promise.all(waits)
  }
  return { stored, share, expire }
}

test("existing PDF and new CSV shares stage locally with MIME/name, then redirect to the same review route", async () => {
  const h = shareHarness()
  for (const [name, type] of [["synthetic.pdf", "application/pdf"], ["synthetic.csv", "text/csv"], ["synthetic.csv", "application/csv"], ["synthetic.csv", ""]]) {
    const response = await h.share([new File(["synthetic data"], name, { type })])
    assert.equal(response.status, 303)
    assert.equal(response.headers.get("Location"), `${origin}/transactions-import?shared=1`)
    const stored = h.stored.get(sharedKey)
    assert.equal(decodeURIComponent(stored.headers.get("X-FinSight-Filename")), name)
    assert.ok(Number(stored.headers.get("X-FinSight-Shared-At")))
    assert.equal(h.stored.size, 1)
  }
})

test("empty, unrelated, oversized and multiple-file shares fail without retaining documents", async () => {
  const h = shareHarness()
  for (const files of [[], [new File([], "empty.csv")], [new File(["private"], "unrelated.txt", { type: "text/plain" })], [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.csv")], [new File(["first"], "a.pdf"), new File(["second"], "b.pdf")]]) {
    const response = await h.share(files)
    assert.equal(response.headers.get("Location"), `${origin}/transactions-import?shared=error`)
    assert.equal(h.stored.size, 0)
  }
})

test("expired abandoned handoffs are removed when the service worker wakes", async () => {
  const h = shareHarness()
  await h.share([new File(["synthetic"], "synthetic.csv", { type: "text/csv" })])
  await h.expire()
  assert.equal(h.stored.size, 1)
  h.stored.set(sharedKey, new Response("synthetic", { headers: { "X-FinSight-Shared-At": String(Date.now() - 6 * 60000) } }))
  await h.expire()
  assert.equal(h.stored.size, 0)
})

test("web and TWA manifests agree on narrow supported MIME types", async () => {
  for (const path of ["public/manifest.json", "finSight-android/twa-manifest.json", "finSight-android/app/src/main/res/raw/web_app_manifest.json"]) {
    const manifest = JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), "utf8"))
    const types = (manifest.share_target || manifest.shareTarget).params.files[0].accept
    assert.ok(types.includes("application/pdf") && types.includes("text/csv") && types.includes("application/csv"))
    assert.ok(types.every((type) => !type.includes("*")))
  }
  const android = await readFile(new URL("../../finSight-android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8")
  assert.match(android, /android\.intent\.action\.SEND/)
  assert.match(android, /mimeType="text\/csv"/)
  assert.doesNotMatch(android, /mimeType="(?:\*\/\*|text\/\*|application\/\*)"/)
})
