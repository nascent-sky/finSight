import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { STATEMENT_LIMITS } from "./statementImportModel.js"

// Keep the working GPay positioning rules for all text-based statement adapters.
export const extractPageLines = async (page) => {
  const textContent = await page.getTextContent()
  if (textContent.items.length > STATEMENT_LIMITS.lines) throw new Error("PDF page exceeds the text safety limit.")
  const positionedItems = textContent.items
    .filter((item) => item.str?.trim())
    .map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .sort((first, second) => second.y - first.y || first.x - second.x)
  const lines = []
  positionedItems.forEach((item) => {
    const currentLine = lines.at(-1)
    if (!currentLine || Math.abs(currentLine.y - item.y) > 2) {
      lines.push({ y: item.y, items: [item] })
      return
    }
    currentLine.items.push(item)
  })
  return lines.map((line) => line.items.sort((first, second) => first.x - second.x).map((item) => item.text).join(" ").replace(/\s+/g, " ").trim())
}

export const readPdfStatementPages = async (file) => {
  if (!file.size || file.size > STATEMENT_LIMITS.bytes) throw new Error("Select a non-empty statement up to 10 MB.")
  let loadingTask
  try {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist")
    GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    loadingTask = getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, stopAtErrors: true, verbosity: 0 })
    const pdf = await loadingTask.promise
    if (pdf.numPages > STATEMENT_LIMITS.pages) throw new Error("PDF exceeds the 200 page safety limit.")
    const pages = []
    let lineCount = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const lines = await extractPageLines(page)
      lineCount += lines.length
      if (lineCount > STATEMENT_LIMITS.lines || lines.some((line) => line.length > STATEMENT_LIMITS.field)) throw new Error("PDF exceeds the text safety limit.")
      pages.push(lines)
      page.cleanup()
    }
    if (!pages.flat().length) throw new Error("This PDF has no readable text. Scanned/image statements are not supported.")
    return pages
  } catch (error) {
    const name = String(error?.name || ""), message = String(error?.message || "")
    if (name === "PasswordException" || /password/i.test(message)) throw new Error("This PDF is password-protected and cannot be imported.")
    if (/worker|failed to fetch|dynamically imported module|networkerror|loading chunk/i.test(`${name} ${message}`)) throw new Error("The local PDF parser is unavailable. Reopen FinSight while online once, then try again.")
    if (/safety limit|no readable text|10 MB/.test(message)) throw error
    throw new Error("This PDF could not be read. It may be damaged or unsupported.")
  } finally {
    await loadingTask?.destroy()
  }
}
