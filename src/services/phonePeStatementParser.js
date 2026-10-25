import { normalizePhonePeTransaction, STATEMENT_LIMITS } from "./statementImportModel.js"

const HEADERS = ["date", "time", "transaction details", "transaction id", "utr", "transaction type", "credit/debit instrument", "amount"]
const cleanHeader = (value) => value.trim().toLowerCase().replace(/\s+/g, " ")
const isHeader = (row) => row.length === 8 && row.every((value, index) => cleanHeader(value) === HEADERS[index])
const addReferenceWarnings = (transaction, location, warnings) => {
  if (!transaction.utr) warnings.push(`${location}: UTR is missing. Only the PhonePe transaction ID can be checked; cross-app duplicates cannot be verified.`)
  else if (!transaction.transactionId) warnings.push(`${location}: PhonePe transaction ID is missing; duplicate checks will use the UTR.`)
  if (!transaction.paymentInstrument) warnings.push(`${location}: payment instrument could not be read. Review the source record.`)
}

// RFC-style quoted fields, including escaped quotes, commas and embedded CR/LF.
export const readCsvRows = (input) => {
  if (typeof input !== "string" || input.length > STATEMENT_LIMITS.bytes) throw new Error("CSV exceeds the 10 MB safety limit.")
  const text = input.replace(/^\uFEFF/, "")
  const rows = []
  let row = [], field = "", quoted = false, closed = false
  const pushField = () => { row.push(field); field = ""; closed = false; if (row.length > 40) throw new Error(`CSV row ${rows.length + 1} has too many columns.`) }
  const pushRow = () => { pushField(); rows.push(row); row = []; if (rows.length > STATEMENT_LIMITS.csvRows) throw new Error("CSV exceeds the row safety limit.") }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === ",") pushField()
    else if (char === "\r" || char === "\n") { pushRow(); if (char === "\r" && text[i + 1] === "\n") i++ }
    else if (char === '"' && !field && !closed) quoted = true
    else if (char === '"' || (closed && !/\s/.test(char))) throw new Error(`Malformed quoting in CSV row ${rows.length + 1}.`)
    else if (!closed) field += char
    if (field.length > STATEMENT_LIMITS.field) throw new Error(`CSV field in row ${rows.length + 1} is too long.`)
  }
  if (quoted) throw new Error(`Unclosed quoted field in CSV row ${rows.length + 1}.`)
  if (field || row.length || closed) pushRow()
  return rows
}

export const parsePhonePeCsv = (text) => {
  const rows = readCsvRows(text)
  const start = rows.findIndex(isHeader)
  if (start < 0) throw new Error("No PhonePe eight-column transaction header was found in this CSV.")
  const transactions = [], parseErrors = [], warnings = []
  let footer = false, count = 0
  rows.slice(start + 1).forEach((row, offset) => {
    const location = `CSV row ${start + offset + 2}`
    if (row.every((cell) => !cell.trim()) || isHeader(row)) return
    const looksLikeRecord = /\b(?:DEBIT|CREDIT)\b/i.test(row[5] || "") || /^(?:\d|[A-Za-z]{3,9}\s+\d)/.test(row[0].trim())
    if (!looksLikeRecord && /^(?:This is|Disclaimer\s*:|Note\s*:)/i.test(row[0].trim())) footer = true
    if (footer && !looksLikeRecord) return
    if (++count > STATEMENT_LIMITS.rows) throw new Error("Statement exceeds the 10,000 transaction safety limit.")
    try {
      if (row.length !== 8) throw new Error("Expected eight columns.")
      const [date, time, details, transactionId, utr, direction, instrument, amount] = row
      const transaction = normalizePhonePeTransaction({ date, time, details, transactionId, utr, direction, instrument, amount }, "csv")
      transactions.push(transaction)
      addReferenceWarnings(transaction, location, warnings)
    } catch (error) { parseErrors.push(`${location}: ${error.message}`) }
  })
  return { provider: "phonepe", format: "csv", transactions, parseErrors, warnings, excludedTopUps: 0 }
}

const DATE = /(?:[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/
const TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/i
// Capture the whole amount token so malformed precision/grouping cannot be
// truncated into a valid-looking smaller value.
const AMOUNT = /(?:₹|\bINR|\bRs\.?)\s*[+-]?\d[\d,.]*(?=\s|$)/gi
const ID = /\bTransaction\s*ID\s*:?\s*([A-Z0-9-]+)(?=\s|$)/gi
const UTR = /\bUTR(?:\s+No\.?)?\s*:?\s*([A-Z0-9-]+)(?=\s|$)/gi
const TABLE = /\bDate\s+Transaction Details\s+(?:Transaction )?Type\s+Amount\b/i
const allLines = (pages) => pages.flat().map((line) => String(line).replace(/\s+/g, " ").trim()).filter(Boolean)

export const isPhonePePdf = (pages) => {
  const text = allLines(pages).join(" ")
  return /\bPhonePe\b|support\.phonepe\.com/i.test(text) && TABLE.test(text) && /Transaction Statement/i.test(text)
}

export const parsePhonePePdfLines = (pages) => {
  if (!isPhonePePdf(pages)) throw new Error("This PDF does not have a recognizable PhonePe statement table.")
  const transactions = [], parseErrors = [], warnings = [], blocks = []
  let current = null, inTable = false
  const flush = () => { if (current) blocks.push(current); current = null }
  for (const [pageIndex, page] of (Array.isArray(pages[0]) ? pages : [pages]).entries()) {
    let footer = false
    for (const line of allLines([page])) {
      if (TABLE.test(line)) { inTable = true; footer = false; continue }
      if (/^(?:Page\s+\d+\s+of\s+\d+|This is|Disclaimer\s*:|Note\s*:)/i.test(line)) { footer = true; continue }
      if (footer || /^(?:PhonePe|Transaction Statement|Date|Transaction Details|Type|Amount)$/i.test(line) || /^Transaction Statement\b/i.test(line) || new RegExp(`^${DATE.source}\\s*[-–]`).test(line)) continue
      if (!inTable) continue
      if (new RegExp(`^${DATE.source}(?=\\s|$)`, "i").test(line)) {
        flush()
        if (blocks.length >= STATEMENT_LIMITS.rows) throw new Error("Statement exceeds the 10,000 transaction safety limit.")
        current = { lines: [line], page: pageIndex + 1 }
      } else if (current) current.lines.push(line)
      else if (/Transaction ID|\bUTR\b|\b(?:DEBIT|CREDIT)\b/i.test(line)) parseErrors.push(`PDF page ${pageIndex + 1}: transaction text without a readable starting date was excluded.`)
    }
  }
  flush()
  for (const [index, block] of blocks.entries()) {
    const location = `PDF transaction ${index + 1} (page ${block.page})`
    try {
      const text = block.lines.join(" ")
      const date = text.match(DATE)?.[0], time = text.match(TIME)?.[0]
      const directions = [...text.matchAll(/\b(?:DEBIT|CREDIT)\b/gi)].map((match) => match[0].toUpperCase())
      const amounts = [...text.matchAll(AMOUNT)].map((match) => match[0])
      const ids = [...text.matchAll(ID)].map((match) => match[1]), utrs = [...text.matchAll(UTR)].map((match) => match[1])
      if (directions.length !== 1 || amounts.length !== 1 || ids.length > 1 || utrs.length > 1 || !date || !time || [...text.matchAll(new RegExp(DATE.source, "gi"))].length !== 1 || [...text.matchAll(new RegExp(TIME.source, "gi"))].length !== 1) throw new Error("Incomplete or ambiguous date, time, direction, amount or references; review the source record.")
      if ((/Transaction\s*ID/i.test(text) && !ids.length) || (/\bUTR\b/i.test(text) && (!utrs.length || !/\d/.test(utrs[0])))) throw new Error("Transaction ID or UTR could not be read.")
      const stripped = text.replace(DATE, " ").replace(TIME, " ").replace(AMOUNT, " ").replace(/\b(?:DEBIT|CREDIT)\b/gi, " ")
      const details = stripped.match(/\b(?:Paid to|Received from)\s+(.+?)(?=\s+(?:Transaction\s*ID|UTR|Paid by|Received (?:by|in)|Credited to|Debited from|Credit\/debit instrument)\b|$)/i)?.[0]
      const instrument = text.match(/\b(?:Paid by|Received (?:by|in)|Credited to|Debited from|Credit\/debit instrument\s*:)\s*(.+)$/i)?.[0] || ""
      if (!details) throw new Error("Payee or payer could not be read.")
      const transaction = normalizePhonePeTransaction({ date, time, details, transactionId: ids[0], utr: utrs[0], direction: directions[0], instrument, amount: amounts[0] }, "pdf")
      transactions.push(transaction)
      addReferenceWarnings(transaction, location, warnings)
    } catch (error) { parseErrors.push(`${location}: ${error.message}`) }
  }
  return { provider: "phonepe", format: "pdf", transactions, parseErrors, warnings, excludedTopUps: 0 }
}
