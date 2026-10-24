import { getMonthKey, getMonthLabel } from "./expenseChartUtils.js"

const dayFormatter = new Intl.DateTimeFormat("en-IN", {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
})

export const getLocalDayKey = (date) => `${getMonthKey(date)}-${String(date.getDate()).padStart(2, "0")}`

const parseExpenseDate = (datetime) => {
  if (typeof datetime !== "string") return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(datetime)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const local = new Date(year, month - 1, day)
  // Date parses some impossible dates by rolling into the next month. Reject
  // those records, and treat legacy date-only values as local dates, not UTC.
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== day) return null
  const date = datetime.length === 10 ? local : new Date(datetime)
  return Number.isNaN(date.getTime()) ? null : date
}

export const getSpendingIntensity = (amount, maximum) => {
  if (amount <= 0 || maximum <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((amount / maximum) * 4)))
}

export const getMonthlySpendingCalendar = (transactions, monthKey, now = new Date()) => {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(monthKey)) throw new RangeError("Choose a valid calendar month.")
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError("Choose a valid current date.")
  const [year, month] = monthKey.split("-").map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const currentMonth = getMonthKey(now)
  const averageDayCount = monthKey < currentMonth ? daysInMonth : monthKey === currentMonth ? now.getDate() : 0
  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month - 1, index + 1)
    return {
      day: index + 1, dateKey: getLocalDayKey(date), label: dayFormatter.format(date),
      isToday: getLocalDayKey(date) === getLocalDayKey(now),
      isFuture: getLocalDayKey(date) > getLocalDayKey(now),
      totalPaise: 0, transactions: [],
    }
  })
  const seenIds = new Set()
  for (const [index, transaction] of (transactions || []).entries()) {
    // Match the canonical type. Income, explicit transfers and other unknown
    // classifications never become expenses based on their category or person.
    if (transaction?.type !== "expense") continue
    const date = parseExpenseDate(transaction.datetime)
    if (!date || getMonthKey(date) !== monthKey) continue
    const amount = Number(transaction.amount)
    const paise = Math.round((amount + Number.EPSILON) * 100)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(paise) || paise <= 0) continue
    const id = transaction.id == null ? "" : String(transaction.id).trim()
    if (id && seenIds.has(id)) continue
    if (id) seenIds.add(id)
    const bucket = days[date.getDate() - 1]
    bucket.totalPaise += paise
    // Copy only display fields: neither sorting nor preview interaction can
    // mutate records from the live transaction subscription.
    bucket.transactions.push({
      id: id || `calendar-record-${index}`, amount: paise / 100, timestamp: date.getTime(),
      category: String(transaction.category || "Other").trim() || "Other",
      person: String(transaction.person || "").trim(), note: String(transaction.note || "").trim(),
      paymentMethod: transaction.paymentMethod,
    })
  }
  const totalPaise = days.reduce((total, day) => total + day.totalPaise, 0)
  const maximumPaise = Math.max(...days.map((day) => day.totalPaise))
  const elapsedPaise = days.slice(0, averageDayCount).reduce((total, day) => total + day.totalPaise, 0)
  const dailyValues = days.map(({ totalPaise: paise, ...day }) => ({
    ...day, amount: paise / 100, transactionCount: day.transactions.length,
    intensity: getSpendingIntensity(paise, maximumPaise),
    transactions: day.transactions.sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id)),
  }))
  // Monday-first weeks, including neutral padding so February and six-week
  // months retain the correct weekday alignment without invented dates.
  const leadingDays = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const cells = Array.from({ length: Math.ceil((leadingDays + daysInMonth) / 7) * 7 }, (_, index) => dailyValues[index - leadingDays] || null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7))
  return {
    monthKey, monthLabel: getMonthLabel(monthKey), days: dailyValues, weeks,
    totalExpenses: totalPaise / 100,
    transactionCount: dailyValues.reduce((total, day) => total + day.transactionCount, 0),
    spendingDays: dailyValues.filter((day) => day.transactionCount > 0).length,
    // Equal peaks choose the earliest date, independently of input order.
    highestDay: dailyValues.find((day) => day.amount > 0 && day.amount === maximumPaise / 100) || null,
    averageDayCount,
    averageDailyExpense: averageDayCount ? Math.round(elapsedPaise / averageDayCount) / 100 : 0,
    isCurrentMonth: monthKey === currentMonth,
  }
}

export const getSpendingCalendarPreview = (monthKey, now = new Date()) => {
  // These local examples never pass through a service or transaction store.
  // Return a fresh display snapshot with clearly named sample merchants.
  const examples = [
    [1, 14500, "Housing", "Sample rent"], [2, 180, "Transport", "Sample metro"],
    [3, 920, "Food & Dining", "Sample grocery store"], [5, 240, "Food & Dining", "Sample café"],
    [7, 1499, "Utilities", "Sample internet bill"], [8, 320, "Transport", "Sample cab"],
    [10, 1280, "Shopping", "Sample essentials"], [10, 460, "Food & Dining", "Sample restaurant"],
    [12, 650, "Healthcare", "Sample pharmacy"], [14, 1100, "Food & Dining", "Sample groceries"],
    [16, 299, "Subscription", "Sample streaming"], [18, 220, "Transport", "Sample metro"],
    [20, 1750, "Shopping", "Sample clothing"], [22, 850, "Entertainment", "Sample cinema"],
    [24, 780, "Food & Dining", "Sample market"], [26, 1590, "Utilities", "Sample electricity bill"],
    [28, 540, "Food & Dining", "Sample restaurant"],
  ]
  const transactions = examples.map(([day, amount, category, person], index) => ({
    id: `__finsight_calendar_preview_${index}`, type: "expense", amount, category, person,
    paymentMethod: index % 3 === 0 ? "cash" : "upi",
    datetime: `${monthKey}-${String(day).padStart(2, "0")}T${index % 2 === 0 ? "12" : "18"}:30:00`,
  }))
  return getMonthlySpendingCalendar(transactions, monthKey, now)
}
