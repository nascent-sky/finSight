const SHARED_PDF_CACHE = "finsight-shared-pdf-v1"
const SHARED_PDF_CACHE_PATH = "/__finsight_shared_pdf__"
const MAX_STATEMENT_BYTES = 10 * 1024 * 1024
const SHARE_LIFETIME_MS = 5 * 60 * 1000
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const redirectToImport = (state) =>
  Response.redirect(
    new URL(`/transactions-import?shared=${state}`, self.location.origin),
    303,
  )

const purgeExpiredShare = async () => {
  const cache = await caches.open(SHARED_PDF_CACHE)
  for (const key of await cache.keys()) {
    const response = await cache.match(key)
    const storedAt = Number(response?.headers.get("X-FinSight-Shared-At"))
    if (response && (!storedAt || Date.now() - storedAt > SHARE_LIFETIME_MS)) await cache.delete(key)
  }
}

const readShareForm = async (request) => {
  const reader = request.body?.getReader()
  if (!reader) throw new Error("Missing share body")
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_STATEMENT_BYTES + 64 * 1024) { await reader.cancel(); throw new Error("Share too large") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return new Response(new Blob(chunks), { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData()
}

const handleStatementShare = async (request) => {
  try {
    const cache = await caches.open(SHARED_PDF_CACHE)
    await purgeExpiredShare()
    if ((await cache.keys()).length >= 8) return redirectToImport("error")
    const formData = await readShareForm(request)
    const statement = formData.get("statement")
    const fileName = typeof statement?.name === "string" ? statement.name : ""
    const isSupported =
      statement instanceof Blob &&
      (["application/pdf", "text/csv", "application/csv", XLSX_MIME].includes(statement.type) || /\.(?:pdf|csv|xlsx)$/i.test(fileName))

    if (!isSupported || !statement.size || statement.size > MAX_STATEMENT_BYTES || formData.getAll("statement").length !== 1) return redirectToImport("error")

    const token = crypto.randomUUID()
    const cacheKey = new URL(`${SHARED_PDF_CACHE_PATH}/${token}`, self.location.origin)
    const fallbackType = /\.xlsx$/i.test(fileName) ? XLSX_MIME : /\.csv$/i.test(fileName) ? "text/csv" : "application/pdf"
    const mime = ["application/pdf", "text/csv", "application/csv", XLSX_MIME].includes(statement.type) ? statement.type : fallbackType
    const headers = new Headers({
      "Content-Type": mime,
      "X-FinSight-Filename": encodeURIComponent(fileName.split(/[\\/]/).at(-1).slice(0, 255) || `shared-statement.${mime === XLSX_MIME ? "xlsx" : mime.includes("csv") ? "csv" : "pdf"}`),
      "X-FinSight-Shared-At": String(Date.now()),
      "Cache-Control": "no-store",
    })

    await cache.put(cacheKey, new Response(statement, { headers }))
    return redirectToImport(token)
  } catch {
    return redirectToImport("error")
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  if (
    event.request.method === "POST" &&
    url.origin === self.location.origin &&
    url.pathname === "/share-target"
  ) {
    event.respondWith(handleStatementShare(event.request))
  }
})

// Staging is only for local TWA/PWA hand-off; remove abandoned expired shares
// when this worker wakes for another fetch or is activated.
self.addEventListener("activate", (event) => event.waitUntil(purgeExpiredShare()))
self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET") event.waitUntil(purgeExpiredShare())
})
