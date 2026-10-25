import { parseAmountPaise, parseStatementDatetime, STATEMENT_LIMITS } from "./statementImportModel.js"

export const PAYTM_HEADERS = Object.freeze(["Date", "Time", "Transaction Details", "Other Transaction Details (UPI ID or A/c No)", "Your Account", "Amount", "UPI Ref No.", "Order ID", "Remarks", "Tags", "Comment"])
const clean = (value) => {
  const text = String(value ?? "")
  if (text.length > STATEMENT_LIMITS.field) throw new Error("Statement field exceeds the text safety limit.")
  return text.replace(/\s+/g, " ").trim()
}
const headerKey = (value) => clean(value).toLowerCase().replace(/[.]/g, "")
const isHeader = (row) => PAYTM_HEADERS.every((name, index) => headerKey(row[index]) === headerKey(name)) && row.slice(11).every((value) => !clean(value))
const result = (format) => ({ provider: "paytm", format, transactions: [], parseErrors: [], warnings: [], excludedTopUps: 0 })
const MAX_REFERENCE = /^\d{6,30}$/

export const parsePaytmAmount = (value) => {
  const match = clean(value).match(/^([+-])?\s*(?:(?:Rs\.?|INR|₹)\s*)?([\d,.]+)$/i)
  if (!match) throw new Error("Amount must be a signed rupee value, with at most two decimal places.")
  return { amountPaise: parseAmountPaise(match[2]), type: match[1] === "-" ? "expense" : "income" }
}

const dateCell = (value) => value instanceof Date
  ? `${String(value.getUTCDate()).padStart(2, "0")}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${value.getUTCFullYear()}` : clean(value)
const timeCell = (value) => value instanceof Date
  ? [value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds()].map((part) => String(part).padStart(2, "0")).join(":") : clean(value)

export const normalizePaytmTransaction = ({ date, time, details, reference, instrument, otherAccount, orderId, remarks, tags, comment }, amount, format) => {
  const { amountPaise, type } = parsePaytmAmount(amount)
  const description = clean(details)
  const action = description.match(/^(Received from|Refund from|Paid to|Sent to|Payment to)\s+(.+)$/i)
  if (!description || description.length > 1000) throw new Error("Transaction details are missing or too long.")
  if (action && (/^(Received|Refund)/i.test(action[1]) ? type !== "income" : type !== "expense")) throw new Error("Amount sign conflicts with the transaction description; review its direction.")
  const upi = clean(reference)
  if (!MAX_REFERENCE.test(upi)) throw new Error("UPI reference is missing or malformed; a complete reference is required before import.")
  const sourceDetails = Object.fromEntries(Object.entries({ description, otherAccount, orderId, remarks, tags, comment }).map(([key, value]) => [key, clean(value)]).filter(([, value]) => value))
  if (Object.values(sourceDetails).some((value) => value.length > STATEMENT_LIMITS.field)) throw new Error("Source details exceed the field safety limit.")
  const order = clean(orderId).toUpperCase()
  return {
    amount: amountPaise / 100, amountPaise, datetime: parseStatementDatetime(dateCell(date), timeCell(time)),
    type, person: action?.[2] || description, paymentMethod: "upi", category: "Other", note: "",
    upiTransactionId: upi, utr: upi,
    transactionId: /^[A-Z0-9-]{4,80}$/.test(order) && /\d/.test(order) ? order : "",
    paymentInstrument: clean(instrument), source: { provider: "paytm", format }, sourceDetails,
    timestampPrecision: format === "pdf" || !/\d:\d{2}:\d{2}/.test(timeCell(time)) ? "minute" : "second",
  }
}

const addReviewWarnings = (transaction, location, warnings) => {
  if (!/^(?:Received from|Refund from|Paid to|Sent to|Payment to)\s/i.test(transaction.sourceDetails.description)) warnings.push(`${location}: the description does not identify a standard payer/payee action. Review the signed amount and person.`)
  if (/\b(?:refund|reversal|cashback|self|own account)\b/i.test(transaction.sourceDetails.description)) warnings.push(`${location}: possible refund or self-transfer. Review its income/expense classification and category.`)
}

export const parsePaytmWorkbookRows = (sheets) => {
  const candidates = sheets.filter((sheet) => /^Passbook Payments? History$/i.test(clean(sheet.sheet)))
  if (candidates.length !== 1) throw new Error("A single Paytm Passbook Payment History worksheet is required. The Summary sheet cannot be imported as transactions.")
  const rows = candidates[0].data
  const header = rows.findIndex(isHeader)
  if (header < 0) throw new Error("The Paytm history worksheet does not contain the supported eleven-column header.")
  if (rows.length > STATEMENT_LIMITS.csvRows) throw new Error("Workbook exceeds the row safety limit.")
  const parsed = result("xlsx")
  let count = 0
  rows.slice(header + 1).forEach((row, index) => {
    if (row.some((value) => String(value ?? "").length > STATEMENT_LIMITS.field)) {
      parsed.parseErrors.push(`Excel row ${header + index + 2}: statement field exceeds the text safety limit.`)
      return
    }
    if (row.every((value) => !clean(value)) || isHeader(row)) return
    const location = `Excel row ${header + index + 2}`
    // A labeled footer total is not an individual payment, even when it has an amount.
    if (/^(?:total|grand total|closing balance|opening balance)\b/i.test(clean(row[0])) && !clean(row[6])) return
    if (++count > STATEMENT_LIMITS.rows) throw new Error("Statement exceeds the 10,000 transaction safety limit.")
    try {
      if (row.slice(11).some((value) => clean(value))) throw new Error("Unexpected populated transaction columns.")
      const [date, time, details, otherAccount, instrument, amount, reference, orderId, remarks, tags, comment] = row
      if (!(date instanceof Date) && !/^\d{2}\/\d{2}\/\d{4}$/.test(clean(date))) throw new Error("Excel date must be DD/MM/YYYY.")
      const transaction = normalizePaytmTransaction({ date, time, details, reference, instrument, otherAccount, orderId, remarks, tags, comment }, amount, "xlsx")
      parsed.transactions.push(transaction)
      addReviewWarnings(transaction, location, parsed.warnings)
    } catch (error) { parsed.parseErrors.push(`${location}: ${error.message}`) }
  })
  return parsed
}

const PERIOD_DATE = "(\\d{1,2})\\s+([A-Za-z]{3,9})\\s*['’ ,]?\\s*(\\d{4}|\\d{2})"
export const readPaytmStatementPeriod = (pages) => {
  const text = pages.flat().join(" ")
  const matches = [...text.matchAll(new RegExp(`${PERIOD_DATE}\\s*(?:-|–|to)\\s*${PERIOD_DATE}`, "gi"))]
  const periods = new Map()
  for (const match of matches) {
    try {
      const stamp = (day, month, year) => {
        const iso = parseStatementDatetime(`${day} ${month} ${year.length === 2 ? 2000 + Number(year) : year}`, "12:00")
        return new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10)
      }
      const start = stamp(match[1], match[2], match[3]), end = stamp(match[4], match[5], match[6])
      if (start > end || Number(end.slice(0, 4)) - Number(start.slice(0, 4)) > 100) throw new Error("Invalid period")
      periods.set(`${start}:${end}`, { start, end })
    } catch { throw new Error("The Paytm statement period is invalid.") }
  }
  if (periods.size !== 1) throw new Error("A single unambiguous Paytm statement period is required to resolve PDF transaction years.")
  return [...periods.values()][0]
}

export const resolvePaytmPdfDate = (dayMonth, period) => {
  const possible = []
  for (let year = Number(period.start.slice(0, 4)); year <= Number(period.end.slice(0, 4)); year++) {
    try {
      const date = new Date(Date.parse(parseStatementDatetime(`${dayMonth} ${year}`, "12:00")) + 330 * 60000).toISOString().slice(0, 10)
      if (date >= period.start && date <= period.end) possible.push(date)
    } catch { /* Invalid dates, including a non-leap February 29, are not candidates. */ }
  }
  if (possible.length !== 1) throw new Error("The PDF transaction year cannot be placed unambiguously inside its statement period.")
  return possible[0]
}

export const isPaytmPdf = (pages) => {
  const text = pages.flat().join(" ")
  return /\bPaytm Statement\b/i.test(text) && /Passbook Payments? History/i.test(text) && /Transaction Details/i.test(text) && /Your Account/i.test(text)
}

const labelX = (items, label) => {
  for (let index = 0; index < items.length; index++) {
    const phrase = items.slice(index, index + 4).map((item) => item.text).join(" ")
    if (new RegExp(`^${label}\\b`, "i").test(phrase)) return items[index].x
  }
  return null
}

export const parsePaytmPdfLines = (pages, layout) => {
  if (!isPaytmPdf(pages)) throw new Error("This PDF does not contain the supported Paytm Passbook Payments History layout.")
  const period = readPaytmStatementPeriod(pages), parsed = result("pdf"), blocks = []
  if (!layout?.length) throw new Error("The Paytm PDF table columns could not be read safely.")
  let active = false, columns, current
  const flush = () => { if (current) blocks.push(current); current = null }
  for (const [pageIndex, page] of layout.entries()) {
    let footer = false
    for (const line of page.lines) {
      const text = clean(line.text)
      if (/Passbook Payments? History/i.test(text)) { active = true; footer = false; continue }
      if (/^Page\s+\d+\s+of\s+\d+/i.test(text)) { footer = true; continue }
      if (!active || footer) continue
      if (/Transaction Details/i.test(text) && /Your Account/i.test(text)) {
        const details = labelX(line.items, "Transaction Details"), account = labelX(line.items, "Your Account"), amount = labelX(line.items, "Amount")
        const notes = line.items.find((item) => /^(?:Comments?|Remarks?|Tags)\b/i.test(item.text))?.x
        if (details == null || account == null || amount == null || !(details < account && account < amount)) throw new Error("The Paytm PDF transaction columns are ambiguous.")
        columns = { details, notes: notes ?? account, account, amount }
        continue
      }
      if (!columns) continue
      const segment = (start, end) => clean(line.items.filter((item) => item.x >= start - 1 && item.x < end - 1).map((item) => item.text).join(" "))
      const dateText = segment(-Infinity, columns.details)
      const dateMatch = dateText.match(/^(\d{1,2}\s+[A-Za-z]{3,9})(?=\s|$)/)
      const beginsPayment = /^(?:Received from|Refund from|Paid to|Sent to|Payment to)\b/i.test(segment(columns.details, columns.notes))
      if (dateMatch || (beginsPayment && (!current || current.details.length))) {
        flush()
        if (blocks.length >= STATEMENT_LIMITS.rows) throw new Error("Statement exceeds the 10,000 transaction safety limit.")
        current = { date: dateMatch?.[1] || "", page: pageIndex + 1, time: [], details: [], instrument: [], amounts: [], notes: [] }
      }
      if (!current) continue
      const time = dateText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\b/i)?.[0]
      if (time) current.time.push(time)
      const details = segment(columns.details, columns.notes), instrument = segment(columns.account, columns.amount), amount = segment(columns.amount, Infinity), notes = segment(columns.notes, columns.account)
      if (details) current.details.push(details)
      if (instrument) current.instrument.push(instrument)
      if (amount) current.amounts.push(amount)
      if (notes) current.notes.push(notes)
    }
  }
  flush()
  for (const [index, block] of blocks.entries()) {
    const location = `PDF transaction ${index + 1} (page ${block.page})`
    try {
      const details = block.details.join(" ")
      const refs = [...details.matchAll(/\bUPI\s+Ref\s+No\.?\s*:\s*([^\s]+)/gi)].map((match) => match[1])
      if (refs.length !== 1 || block.time.length !== 1 || block.amounts.length !== 1) throw new Error("Incomplete or ambiguous time, signed amount or UPI reference; review the source record.")
      if (!/^[+-]\s*(?:Rs\.?|INR|₹)/i.test(block.amounts[0])) throw new Error("A signed Paytm amount is required.")
      const description = details.split(/\bUPI\s+(?:ID|Ref\s+No\.?)\s*:/i)[0].trim()
      const otherAccount = details.match(/\bUPI\s+ID\s*:\s*([^\s]+)/i)?.[1] || ""
      const transaction = normalizePaytmTransaction({ date: resolvePaytmPdfDate(block.date, period), time: block.time[0], details: description, reference: refs[0], instrument: block.instrument.join(" "), otherAccount, comment: block.notes.join(" ") }, block.amounts[0], "pdf")
      parsed.transactions.push(transaction)
      addReviewWarnings(transaction, location, parsed.warnings)
    } catch (error) { parsed.parseErrors.push(`${location}: ${error.message}`) }
  }
  if (!blocks.length) parsed.warnings.push("No dated transaction blocks were found in the Paytm history table. Review whether the statement is empty or uses a different layout.")
  return parsed
}
