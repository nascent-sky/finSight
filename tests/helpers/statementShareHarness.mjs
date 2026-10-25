import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import vm from "node:vm"

const script = await readFile(new URL("../../public/share-target-handler.js", import.meta.url), "utf8")
export const shareOrigin = "https://finsight.example"
export const shareHarness = () => {
  const events = new Map(), stored = new Map()
  const key = (url) => new URL(typeof url === "string" || url instanceof URL ? url : url.url, shareOrigin).pathname
  const cache = {
    match: async (url) => stored.get(key(url))?.clone(),
    delete: async (url) => stored.delete(key(url)),
    put: async (url, response) => stored.set(key(url), response),
    keys: async () => [...stored.keys()].map((path) => new Request(new URL(path, shareOrigin))),
  }
  const caches = { open: async () => cache }
  vm.runInNewContext(script, { URL, Response, Headers, Blob, Date, crypto: { randomUUID }, caches, self: { location: { origin: shareOrigin }, addEventListener: (type, listener) => events.set(type, [...(events.get(type) || []), listener]) } })
  const share = async (files) => {
    const data = new FormData()
    files.forEach((file) => data.append("statement", file))
    let response
    const event = { request: new Request(`${shareOrigin}/share-target`, { method: "POST", body: data }), respondWith: (value) => { response = value }, waitUntil() {} }
    events.get("fetch").forEach((handler) => handler(event))
    return await response
  }
  const expire = async () => {
    const waits = []
    events.get("activate").forEach((handler) => handler({ waitUntil: (value) => waits.push(value) }))
    await Promise.all(waits)
  }
  return { stored, cache, caches, share, expire }
}
