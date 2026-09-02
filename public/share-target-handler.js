const SHARED_PDF_CACHE = "finsight-shared-pdf-v1"
const SHARED_PDF_CACHE_PATH = "/__finsight_shared_pdf__"

const redirectToImport = (state) =>
  Response.redirect(
    new URL(`/transactions-import?shared=${state}`, self.location.origin),
    303,
  )

const handlePdfShare = async (request) => {
  try {
    const formData = await request.formData()
    const statement = formData.get("statement")
    const fileName = typeof statement?.name === "string" ? statement.name : ""
    const isPdf =
      statement instanceof Blob &&
      (statement.type === "application/pdf" || fileName.toLowerCase().endsWith(".pdf"))

    if (!isPdf) return redirectToImport("error")

    const cache = await caches.open(SHARED_PDF_CACHE)
    const cacheKey = new URL(SHARED_PDF_CACHE_PATH, self.location.origin)
    const headers = new Headers({
      "Content-Type": statement.type || "application/pdf",
      "X-FinSight-Filename": encodeURIComponent(fileName || "shared-statement.pdf"),
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
    event.respondWith(handlePdfShare(event.request))
  }
})
