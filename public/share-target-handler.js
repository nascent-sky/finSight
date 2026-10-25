const SHARED_PDF_CACHE = "finsight-shared-pdf-v1"
const SHARED_PDF_CACHE_PATH = "/__finsight_shared_pdf__"
const MAX_STATEMENT_BYTES = 10 * 1024 * 1024
const SHARE_LIFETIME_MS = 5 * 60 * 1000

const redirectToImport = (state) =>
  Response.redirect(
    new URL(`/transactions-import?shared=${state}`, self.location.origin),
    303,
  )

const purgeExpiredShare = async () => {
  const cache = await caches.open(SHARED_PDF_CACHE)
  const response = await cache.match(SHARED_PDF_CACHE_PATH)
  const storedAt = Number(response?.headers.get("X-FinSight-Shared-At"))
  if (response && (!storedAt || Date.now() - storedAt > SHARE_LIFETIME_MS)) await cache.delete(SHARED_PDF_CACHE_PATH)
}

const handleStatementShare = async (request) => {
  try {
    const cache = await caches.open(SHARED_PDF_CACHE)
    await cache.delete(SHARED_PDF_CACHE_PATH)
    const formData = await request.formData()
    const statement = formData.get("statement")
    const fileName = typeof statement?.name === "string" ? statement.name : ""
    const isSupported =
      statement instanceof Blob &&
      (["application/pdf", "text/csv", "application/csv"].includes(statement.type) || /\.(?:pdf|csv)$/i.test(fileName))

    if (!isSupported || !statement.size || statement.size > MAX_STATEMENT_BYTES || formData.getAll("statement").length !== 1) return redirectToImport("error")

    const cacheKey = new URL(SHARED_PDF_CACHE_PATH, self.location.origin)
    const headers = new Headers({
      "Content-Type": statement.type || (/\.csv$/i.test(fileName) ? "text/csv" : "application/pdf"),
      "X-FinSight-Filename": encodeURIComponent(fileName || (["text/csv", "application/csv"].includes(statement.type) ? "shared-statement.csv" : "shared-statement.pdf")),
      "X-FinSight-Shared-At": String(Date.now()),
      "Cache-Control": "no-store",
    })

    await cache.put(cacheKey, new Response(statement, { headers }))
    return redirectToImport("1")
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
