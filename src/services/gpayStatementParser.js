import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

const INDIA_TIME_OFFSET = "+05:30"
const TRANSACTION_PATTERN = /\b(Paid to|Received from|Top-up to UPI Lite)\b/i
const AMOUNT_PATTERN = /₹\s*([\d,]+(?:\.\d{1,2})?)/
const DATE_PATTERN = /\b\d{1,2}\s+[A-Za-z]{3,9}\s*,\s*\d{4}\b/i
const TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)\b/i
const UPI_TRANSACTION_ID_PATTERN = /\bUPI Transaction ID\s*:\s*(\d+)\b/i
const MONTHS = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

const pad = (value) => String(value).padStart(2, "0")

const toIndiaIsoString = ({ year, month, day, hour, minute, second = 0, meridiem }) => {
  let normalizedHour = Number(hour)

  if (meridiem) {
    normalizedHour %= 12
    if (meridiem.toLowerCase() === "pm") normalizedHour += 12
  }

  const isoWithOffset = `${year}-${pad(month)}-${pad(day)}T${pad(normalizedHour)}:${pad(minute)}:${pad(second)}${INDIA_TIME_OFFSET}`
  const date = new Date(isoWithOffset)

  if (
    Number.isNaN(date.getTime()) ||
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > 31 ||
    normalizedHour < 0 ||
    normalizedHour > 23 ||
    Number(minute) < 0 ||
    Number(minute) > 59 ||
    Number(second) < 0 ||
    Number(second) > 59
  ) {
    return null
  }

  return date.toISOString()
}

export const parseGooglePayDatetime = (text) => {
  const normalized = String(text).replace(/\s+/g, " ")
  const dayFirst = normalized.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s*(\d{4})\s*(?:,|at)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)\b/i,
  )

  if (dayFirst) {
    const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()]
    if (!month) return null

    return toIndiaIsoString({
      day: dayFirst[1],
      month,
      year: dayFirst[3],
      hour: dayFirst[4],
      minute: dayFirst[5],
      second: dayFirst[6],
      meridiem: dayFirst[7],
    })
  }

  const monthFirst = normalized.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2})\s*,\s*(\d{4})\s*(?:,|at)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)\b/i,
  )

  if (monthFirst) {
    const month = MONTHS[monthFirst[1].slice(0, 3).toLowerCase()]
    if (!month) return null

    return toIndiaIsoString({
      day: monthFirst[2],
      month,
      year: monthFirst[3],
      hour: monthFirst[4],
      minute: monthFirst[5],
      second: monthFirst[6],
      meridiem: monthFirst[7],
    })
  }

  const numericDate = normalized.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*(?:,|at)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i,
  )

  if (!numericDate) return null

  return toIndiaIsoString({
    day: numericDate[1],
    month: numericDate[2],
    year: numericDate[3],
    hour: numericDate[4],
    minute: numericDate[5],
    second: numericDate[6],
    meridiem: numericDate[7],
  })
}

const extractPageLines = async (page) => {
  const textContent = await page.getTextContent()
  const positionedItems = textContent.items
    .filter((item) => item.str?.trim())
    .map((item) => ({
      text: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
    }))
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

  return lines.map((line) =>
    line.items
      .sort((first, second) => first.x - second.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  )
}

const getBlockDatetime = (blockLines) => {
  const blockText = blockLines.join(" ")
  const date = blockText.match(DATE_PATTERN)?.[0]
  const time = blockText.match(TIME_PATTERN)?.[0]

  return date && time ? parseGooglePayDatetime(`${date} ${time}`) : null
}

const getBlockAmount = (blockLines) => {
  const match = blockLines.join(" ").match(AMOUNT_PATTERN)
  if (!match) return null

  const amount = Number(match[1].replaceAll(",", ""))
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

const getBlockUpiTransactionId = (blockLines) =>
  blockLines.join(" ").match(UPI_TRANSACTION_ID_PATTERN)?.[1] ?? null

const cleanPerson = (person) =>
  person
    .replace(AMOUNT_PATTERN, "")
    .replace(/\s+UPI Transaction ID:.*$/i, "")
    .replace(/\s+Paid (?:to|by) Kotak Mahindra Bank.*$/i, "")
    .trim()

const getBlockAction = (blockLines) => {
  for (const line of blockLines) {
    const receivedMatch = line.match(/\bReceived from\s+(.+)$/i)
    if (receivedMatch) {
      return { type: "income", person: cleanPerson(receivedMatch[1]) }
    }
  }

  for (const line of blockLines) {
    if (/\bPaid to Kotak Mahindra Bank(?:\s+\d+)?\b/i.test(line)) continue

    const paidMatch = line.match(/\bPaid to\s+(.+)$/i)
    if (paidMatch) {
      return { type: "expense", person: cleanPerson(paidMatch[1]) }
    }
  }

  return null
}

export const parseGooglePayStatementLines = (lines) => {
  const normalizedLines = lines
    .map((line) => String(line).replace(/\s+/g, " ").trim())
    .filter(Boolean)
  const dateIndexes = normalizedLines.reduce((indexes, line, index) => {
    if (DATE_PATTERN.test(line)) indexes.push(index)
    return indexes
  }, [])
  const hasTransactionMarkers = normalizedLines.some((line) => TRANSACTION_PATTERN.test(line))
  const looksLikeGooglePay = normalizedLines.some((line) =>
    /Google Pay|transaction statement/i.test(line),
  )

  if (!hasTransactionMarkers) {
    if (looksLikeGooglePay) {
      return { transactions: [], excludedTopUps: 0, parseErrors: [] }
    }

    throw new Error("This PDF does not look like a recognizable Google Pay statement.")
  }

  if (dateIndexes.length === 0) {
    throw new Error("The Google Pay transactions were found, but their dates could not be read.")
  }

  const transactions = []
  const parseErrors = []
  let excludedTopUps = 0

  dateIndexes.forEach((dateIndex, position) => {
    const nextDateIndex = dateIndexes[position + 1] ?? normalizedLines.length
    const blockLines = normalizedLines.slice(dateIndex, nextDateIndex)
    const blockText = blockLines.join(" ")

    if (!TRANSACTION_PATTERN.test(blockText)) return

    if (/\bTop-up to UPI Lite\b/i.test(blockText)) {
      excludedTopUps += 1
      return
    }

    const action = getBlockAction(blockLines)
    const amount = getBlockAmount(blockLines)
    const datetime = getBlockDatetime(blockLines)
    const upiTransactionId = getBlockUpiTransactionId(blockLines)

    if (!action?.person || !amount || !datetime || !upiTransactionId) {
      parseErrors.push(`Could not parse the transaction beginning "${blockLines[0]}".`)
      return
    }

    transactions.push({
      amount,
      datetime,
      type: action.type,
      person: action.person,
      paymentMethod: "upi",
      category: "Other",
      note: "",
      upiTransactionId,
    })
  })

  if (transactions.length === 0 && excludedTopUps === 0 && parseErrors.length > 0) {
    throw new Error("Could not parse any complete transactions from this Google Pay statement.")
  }

  return { transactions, excludedTopUps, parseErrors }
}

export const parseGooglePayStatement = async (file) => {
  const isPdf =
    file instanceof File &&
    (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))

  if (!isPdf) {
    throw new Error("Select a valid PDF file.")
  }

  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist")
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const loadingTask = getDocument({ data: await file.arrayBuffer() })

  try {
    const pdf = await loadingTask.promise
    const lines = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      lines.push(...(await extractPageLines(page)))
    }

    return parseGooglePayStatementLines(lines)
  } catch (error) {
    if (error?.message?.includes("Google Pay") || error?.message?.includes("transaction")) {
      throw error
    }

    throw new Error("The PDF could not be read. It may be damaged or password-protected.")
  } finally {
    await loadingTask.destroy()
  }
}
