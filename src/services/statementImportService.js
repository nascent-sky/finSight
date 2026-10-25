import { isPhonePePdf, parsePhonePeCsv, parsePhonePePdfLines } from "./phonePeStatementParser.js"
import { STATEMENT_LIMITS } from "./statementImportModel.js"

// Add future Paytm adapters here; all adapters return the same preview contract.
export const parseStatementFile = async (file) => {
  if (!file || typeof file.arrayBuffer !== "function" || !file.size || file.size > STATEMENT_LIMITS.bytes) throw new Error("Select a non-empty PDF or CSV statement up to 10 MB.")
  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer())
  if (signature !== "%PDF-") {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) throw new Error("The selected file does not contain a valid PDF.")
    if (!/\.csv$/i.test(file.name) && !["text/csv", "application/csv"].includes(file.type)) throw new Error("Supported statements: Google Pay PDF and PhonePe PDF or CSV.")
    let text
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()) }
    catch { throw new Error("CSV must be a readable UTF-8 text file.") }
    return parsePhonePeCsv(text)
  }
  let reader
  try { reader = await import("./pdfStatementReader.js") }
  catch { throw new Error("The local PDF parser is unavailable. Reopen FinSight while online once, then try again.") }
  const { readPdfStatementPages } = reader
  const pages = await readPdfStatementPages(file)
  if (isPhonePePdf(pages)) return parsePhonePePdfLines(pages)
  const lines = pages.flat()
  if (!lines.some((line) => /Google Pay/i.test(line)) && !lines.some((line) => /UPI Transaction ID/i.test(line))) throw new Error("This PDF is not a supported Google Pay or PhonePe statement.")
  let gpay
  try { gpay = await import("./gpayStatementParser.js") }
  catch { throw new Error("The local Google Pay parser is unavailable. Reopen FinSight while online once, then try again.") }
  const { parseGooglePayStatementLines } = gpay
  const result = parseGooglePayStatementLines(lines)
  if (result.transactions.length > STATEMENT_LIMITS.rows) throw new Error("Statement exceeds the 10,000 transaction safety limit.")
  return { ...result, provider: "gpay", format: "pdf", warnings: [], transactions: result.transactions.map((transaction) => ({ ...transaction, amountPaise: Math.round(transaction.amount * 100), source: { provider: "gpay", format: "pdf" } })) }
}
