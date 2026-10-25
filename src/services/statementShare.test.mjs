import test, { after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { shareHarness, shareOrigin as origin } from "../../tests/helpers/statementShareHarness.mjs"
import { receiveSharedStatement } from "./statementShareService.js"

const sharedKey = "/__finsight_shared_pdf__", xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const oldCaches = Object.getOwnPropertyDescriptor(globalThis, "caches")
after(() => { if (oldCaches) Object.defineProperty(globalThis, "caches", oldCaches); else delete globalThis.caches })
const useCache = (h) => Object.defineProperty(globalThis, "caches", { configurable: true, value: h.caches })

test("PDF, CSV and XLSX bytes stage locally and reach the importer unchanged through one-use handoffs", async () => {
  const h = shareHarness()
  useCache(h)
  for (const [name, type] of [["synthetic.pdf", "application/pdf"], ["synthetic.csv", "text/csv"], ["synthetic.csv", "application/csv"], ["synthetic.csv", ""], ["synthetic.xlsx", xlsx], ["synthetic.xlsx", "application/octet-stream"]]) {
    const response = await h.share([new File(["synthetic data"], name, { type })])
    assert.equal(response.status, 303)
    const url = new URL(response.headers.get("Location"))
    assert.equal(url.origin, origin); assert.equal(url.pathname, "/transactions-import")
    const token = url.searchParams.get("shared")
    assert.match(token, /^[a-f0-9-]{36}$/)
    const stored = h.stored.get(`${sharedKey}/${token}`)
    assert.equal(decodeURIComponent(stored.headers.get("X-FinSight-Filename")), name)
    assert.ok(Number(stored.headers.get("X-FinSight-Shared-At")))
    assert.equal(h.stored.size, 1)
    const file = await receiveSharedStatement(token)
    assert.equal(file.name, name); assert.equal(await file.text(), "synthetic data")
    if (name.endsWith(".xlsx")) assert.equal(file.type, xlsx)
    assert.equal(h.stored.size, 0)
    await assert.rejects(() => receiveSharedStatement(token), /no longer available/)
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
  const key = [...h.stored.keys()][0]
  h.stored.set(key, new Response("synthetic", { headers: { "X-FinSight-Shared-At": String(Date.now() - 6 * 60000) } }))
  await h.expire()
  assert.equal(h.stored.size, 0)
})

test("web and TWA manifests agree on narrow supported MIME types", async () => {
  for (const path of ["public/manifest.json", "finSight-android/twa-manifest.json", "finSight-android/app/src/main/res/raw/web_app_manifest.json"]) {
    const manifest = JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), "utf8"))
    const types = (manifest.share_target || manifest.shareTarget).params.files[0].accept
    assert.ok(types.includes("application/pdf") && types.includes("text/csv") && types.includes("application/csv"))
    assert.ok(types.includes(xlsx))
    if (path.endsWith("twa-manifest.json")) assert.ok(types.every((type) => type.includes("/")), "Bubblewrap copies native accept entries into Android mimeType attributes")
    else assert.ok(types.includes(".xlsx"))
    assert.ok(types.every((type) => !type.includes("*")))
  }
  const android = await readFile(new URL("../../finSight-android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8")
  assert.match(android, /android\.intent\.action\.SEND/)
  assert.match(android, /android\.intent\.action\.VIEW/)
  assert.match(android, /android:scheme="content"/)
  assert.match(android, /mimeType="text\/csv"/)
  assert.doesNotMatch(android, /mimeType="(?:\*\/\*|text\/\*|application\/\*)"/)
  const androidTypes = [...android.matchAll(/android:mimeType="([^"]+)"/g)].map((match) => match[1])
  assert.ok(androidTypes.length >= 8)
  assert.ok(androidTypes.every((type) => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(type)), "Android MIME attributes must never contain filename extensions")
  const launcher = await readFile(new URL("../../finSight-android/app/src/main/java/com/finsight/app/LauncherActivity.java", import.meta.url), "utf8")
  assert.match(launcher, /StatementShareIntent\.prepare/)
  const adapter = await readFile(new URL("../../finSight-android/app/src/main/java/com/finsight/app/StatementShareIntent.java", import.meta.url), "utf8")
  assert.match(adapter, /Intent\.EXTRA_STREAM/)
})

test("overlapping shares keep separate byte payloads and invalid shares do not erase a valid handoff", async () => {
  const h = shareHarness(); useCache(h)
  const responses = await Promise.all([h.share([new File(["first"], "first.pdf")]), h.share([new File(["second"], "second.csv")])])
  assert.equal(h.stored.size, 2)
  await h.share([new File(["unsupported"], "other.txt")])
  assert.equal(h.stored.size, 2)
  for (const [index, response] of responses.entries()) {
    const file = await receiveSharedStatement(new URL(response.headers.get("Location")).searchParams.get("shared"))
    assert.equal(await file.text(), ["first", "second"][index])
  }
})
test("legacy GPay handoffs remain readable; expired and invalid transfers fail clearly and are discarded", async () => {
  const h = shareHarness(); useCache(h)
  const response = (time) => new Response("fictional", { headers: { "X-FinSight-Shared-At": String(time), "X-FinSight-Filename": "legacy.pdf", "Content-Type": "application/pdf" } })
  h.stored.set(sharedKey, response(Date.now()))
  assert.equal((await receiveSharedStatement("1")).name, "legacy.pdf")
  h.stored.set(sharedKey, response(Date.now() - 6 * 60000))
  await assert.rejects(() => receiveSharedStatement("1"), /expired/)
  assert.equal(h.stored.size, 0)
  await assert.rejects(() => receiveSharedStatement("../../private"), /Share one non-empty/)
  await assert.rejects(() => receiveSharedStatement("missing"), /browser did not deliver/)
})
