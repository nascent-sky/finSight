// Shared by provider adapters, preview and persistence. No document contents are stored.
export const STATEMENT_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, rows: 10000, csvRows: 12000, pages: 200, lines: 100000, field: 10000 })
export const STATEMENT_ACCEPT = "application/pdf,text/csv,application/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,.csv,.xlsx"

export const parseAmountPaise = (value) => {
  const text = String(value ?? "").trim().replace(/^(?:₹|INR\s*|Rs\.?\s*)/i, "").trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Amount must be a positive rupee value with at most two decimal places.")
  }
  const [whole, fraction = ""] = text.replaceAll(",", "").split(".")
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new Error("Amount is outside the supported range.")
  const [savedWhole, savedFraction = ""] = String(paise / 100).split(".")
  if (savedFraction.length > 2 || Number(savedWhole) * 100 + Number(savedFraction.padEnd(2, "0")) !== paise) throw new Error("Amount cannot be stored exactly in the transaction model.")
  return paise
}

const MONTHS = ["jan|january", "feb|february", "mar|march", "apr|april", "may", "jun|june", "jul|july", "aug|august", "sep|sept|september", "oct|october", "nov|november", "dec|december"]
const monthNumber = (name) => MONTHS.findIndex((names) => names.split("|").includes(name.toLowerCase())) + 1
export const parseStatementDatetime = (dateText, timeText) => {
  const date = String(dateText).trim().replaceAll(",", "").replace(/\s+/g, " ")
  let year, month, day
  let match = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (match) [, year, month, day] = match
  else if ((match = date.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [, day, month, year] = match
  else if ((match = date.match(/^([A-Za-z]{3,9}) (\d{1,2}) (\d{4})$/))) {
    [, , day, year] = match
    month = monthNumber(match[1])
  } else if ((match = date.match(/^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/))) {
    [, day, , year] = match
    month = monthNumber(match[2])
  } else throw new Error("Date must be a supported day-first or named-month date.")
  const time = String(timeText).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!time) throw new Error("Time could not be read.")
  let hour = Number(time[1])
  const minute = Number(time[2]), second = Number(time[3] || 0)
  if (time[4] && (hour < 1 || hour > 12)) throw new Error("Invalid 12-hour time.")
  if (time[4]) hour = hour % 12 + (time[4].toLowerCase() === "pm" ? 12 : 0)
  const local = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute, second))
  if (Number(year) < 1900 || local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month) || local.getUTCDate() !== Number(day) || hour > 23 || minute > 59 || second > 59) {
    throw new Error("Date or time is invalid.")
  }
  return new Date(local.getTime() - 330 * 60 * 1000).toISOString()
}

export const normalizeReference = (value) => String(value ?? "").trim().toUpperCase()
const reference = (value, label) => {
  const result = normalizeReference(value)
  if (result && (!/^[A-Z0-9-]{4,80}$/.test(result) || !/\d/.test(result))) throw new Error(`${label} is malformed.`)
  return result
}

export const normalizePhonePeTransaction = ({ date, time, details, transactionId, utr, direction, instrument, amount }, format) => {
  const type = { DEBIT: "expense", CREDIT: "income" }[String(direction).trim().toUpperCase()]
  if (!type) throw new Error("Transaction type must be DEBIT or CREDIT.")
  const person = String(details ?? "").replace(/\s+/g, " ").trim().replace(/^(?:Paid to|Received from)\s+/i, "").trim()
  if (!person || person.length > 1000) throw new Error("Transaction details are missing or too long.")
  const id = reference(transactionId, "Transaction ID"), bankReference = reference(utr, "UTR")
  if (!id && !bankReference) throw new Error("Transaction ID and UTR are both missing; identity cannot be verified.")
  const amountPaise = parseAmountPaise(amount)
  return {
    amount: amountPaise / 100, amountPaise,
    datetime: parseStatementDatetime(date, time), type, person,
    paymentMethod: "upi", category: "Other", note: "",
    transactionId: id, utr: bankReference, upiTransactionId: bankReference,
    paymentInstrument: String(instrument ?? "").replace(/\s+/g, " ").trim(),
    source: { provider: "phonepe", format },
  }
}

// UTR/UPI reference IDs are global. App transaction IDs are provider-scoped.
export const getImportIdentityKeys = (transaction = {}) => {
  const keys = new Set()
  for (const value of [transaction.utr, transaction.upiTransactionId]) {
    if (value) keys.add(`upi:${normalizeReference(value)}`)
  }
  const provider = transaction.source?.provider
  if (provider && transaction.transactionId) keys.add(`${provider}:${normalizeReference(transaction.transactionId)}`)
  const legacy = String(transaction.id || "").match(/^(?:gpay|upi)_([A-Z0-9-]+)$/i)
  if (legacy) keys.add(`upi:${normalizeReference(legacy[1])}`)
  const appId = String(transaction.id || "").match(/^(phonepe|paytm)_([A-Z0-9-]+)$/i)
  if (appId) keys.add(`${appId[1].toLowerCase()}:${normalizeReference(appId[2])}`)
  return [...keys]
}

export const getImportDocumentIds = (transaction) => {
  const keys = getImportIdentityKeys(transaction)
  const ids = keys.flatMap((key) => {
    const [provider, value] = key.split(":")
    return provider === "upi" ? [`upi_${value}`, `gpay_${value}`] : [`${provider}_${value}`]
  })
  return [...new Set(ids)]
}

export const getImportDocumentId = (transaction) => {
  const id = getImportDocumentIds(transaction)[0]
  if (!id || id.includes("/")) throw new Error("The transaction has no usable import identity.")
  return id
}

const localDay = (datetime) => {
  const value = new Date(Date.parse(datetime) + 330 * 60000)
  return Number.isNaN(value.getTime()) ? "invalid" : value.toISOString().slice(0, 10)
}
const financialSignature = (transaction) => `${Number(transaction.amount)}:${transaction.type}:${localDay(transaction.datetime)}`
const bankReference = (transaction) => normalizeReference(transaction.utr || transaction.upiTransactionId || String(transaction.id || "").match(/^(?:gpay|upi)_(.+)$/)?.[1])
const minute = (transaction) => Math.floor(Date.parse(transaction.datetime) / 60000)
const party = (transaction) => String(transaction.person || "").trim().replace(/\s+/g, " ").toLowerCase()
const isPaytm = (transaction) => transaction.source?.provider === "paytm"
const preciseTime = (transaction) => Date.parse(transaction.datetime) % 60000 ? Date.parse(transaction.datetime) : null
const hasConflict = (left, right) => financialSignature(left) !== financialSignature(right)
  || Boolean(bankReference(left) && bankReference(right) && bankReference(left) !== bankReference(right))
  || ((isPaytm(left) || isPaytm(right)) && (minute(left) !== minute(right) || party(left) !== party(right)
    || (preciseTime(left) !== null && preciseTime(right) !== null && preciseTime(left) !== preciseTime(right))))

export const findImportMatch = (transaction, existing) => {
  const keys = new Set(getImportIdentityKeys(transaction))
  const records = existing.filter((item) => getImportIdentityKeys(item).some((key) => keys.has(key)))
  const conflicting = records.find((record) => hasConflict(transaction, record))
  return records.length ? { record: conflicting || records[0], conflict: Boolean(conflicting) } : null
}

export const annotateImportDuplicates = (transactions, existing = []) => {
  const groups = new Map()
  const add = (record, index) => getImportIdentityKeys(record).forEach((key) => {
    if (!groups.has(key)) groups.set(key, { first: index, signatures: new Set(), references: new Set(), minutes: new Set(), preciseTimes: new Set(), parties: new Set(), paytm: false })
    const group = groups.get(key)
    group.signatures.add(financialSignature(record))
    group.minutes.add(minute(record)); group.parties.add(party(record)); group.paytm ||= isPaytm(record)
    if (preciseTime(record) !== null) group.preciseTimes.add(preciseTime(record))
    const ref = bankReference(record)
    if (ref) group.references.add(ref)
  })
  existing.forEach((record) => add(record, -1))
  transactions.forEach(add)
  return transactions.map((transaction, index) => {
    const matches = getImportIdentityKeys(transaction).map((key) => groups.get(key))
    const conflict = matches.some((group) => group.signatures.size > 1 || group.references.size > 1 || (group.paytm && (group.minutes.size > 1 || group.parties.size > 1 || group.preciseTimes.size > 1)))
    return { duplicate: !conflict && matches.some((group) => group.first < index), conflict }
  })
}

export const toImportPayload = (transaction) => {
  const amountPaise = parseAmountPaise(transaction.amount)
  const { datetime, type, person } = transaction
  if (!datetime || Number.isNaN(Date.parse(datetime)) || !["expense", "income"].includes(type) || !String(person ?? "").trim()) throw new Error("Review the transaction date, direction and person before importing.")
  getImportDocumentId(transaction)
  return { ...transaction, amount: amountPaise / 100, amountPaise }
}
