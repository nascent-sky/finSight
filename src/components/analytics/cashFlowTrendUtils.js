import { getMonthKey, getMonthLabel } from "./expenseChartUtils.js"

export const getTrendMonthKeys = (endMonth, monthCount = 6) => {
  if (![6, 12].includes(monthCount)) throw new RangeError("Choose a 6- or 12-month range.")
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(endMonth)) throw new RangeError("Choose a valid ending month.")
  const [year, month] = endMonth.split("-").map(Number)
  return Array.from({ length: monthCount }, (_, index) =>
    getMonthKey(new Date(year, month - monthCount + index, 1)),
  )
}

export const getMonthlyCashFlow = (transactions, endMonth, monthCount = 6) => {
  const buckets = new Map(getTrendMonthKeys(endMonth, monthCount).map((monthKey) => [
    monthKey, { monthKey, incomePaise: 0, expensePaise: 0, transactionCount: 0 },
  ]))
  const seenIds = new Set()

  for (const transaction of transactions || []) {
    // Source bookmarks and UI tabs are not additional payments. Use each
    // canonical transaction once, regardless of its person or category name.
    // The model currently has only income/expense types; explicit transfers
    // and other unknown classifications are deliberately excluded.
    if (!transaction || !["income", "expense"].includes(transaction.type) || !transaction.datetime) continue
    const date = new Date(transaction.datetime)
    if (Number.isNaN(date.getTime())) continue
    const bucket = buckets.get(getMonthKey(date))
    if (!bucket) continue
    const amount = Number(transaction.amount)
    const paise = Math.round((amount + Number.EPSILON) * 100)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(paise) || paise <= 0) continue
    const id = transaction.id == null ? "" : String(transaction.id).trim()
    if (id && seenIds.has(id)) continue
    if (id) seenIds.add(id)
    bucket[transaction.type === "income" ? "incomePaise" : "expensePaise"] += paise
    bucket.transactionCount += 1
  }

  let totalIncomePaise = 0
  let totalExpensePaise = 0
  let transactionCount = 0
  let populatedMonths = 0
  const months = [...buckets.values()].map((bucket) => {
    totalIncomePaise += bucket.incomePaise
    totalExpensePaise += bucket.expensePaise
    transactionCount += bucket.transactionCount
    if (bucket.transactionCount > 0) populatedMonths += 1
    const label = getMonthLabel(bucket.monthKey)
    return {
      monthKey: bucket.monthKey,
      label,
      shortLabel: label.slice(0, 3),
      income: bucket.incomePaise / 100,
      expenses: bucket.expensePaise / 100,
      net: (bucket.incomePaise - bucket.expensePaise) / 100,
      transactionCount: bucket.transactionCount,
    }
  })

  return {
    months,
    transactionCount,
    populatedMonths,
    totalIncome: totalIncomePaise / 100,
    totalExpenses: totalExpensePaise / 100,
    netCashFlow: (totalIncomePaise - totalExpensePaise) / 100,
    // Averages include every month in the selected range, including zero months.
    averageIncome: Math.round(totalIncomePaise / monthCount) / 100,
    averageExpenses: Math.round(totalExpensePaise / monthCount) / 100,
  }
}

const compactNumber = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 })

export const formatTrendAxisAmount = (amount) => {
  const absolute = Math.abs(amount)
  const [divisor, suffix] = absolute >= 1e7 ? [1e7, "Cr"]
    : absolute >= 1e5 ? [1e5, "L"]
      : absolute >= 1e3 ? [1e3, "k"] : [1, ""]
  return `${amount < 0 ? "−" : ""}₹${compactNumber.format(absolute / divisor)}${suffix}`
}

export const getCashFlowPreview = (endMonth, monthCount = 6) => {
  // Generate a fresh, memory-only dataset. The last six months are identical
  // across range switches. Nothing here imports a persistence or Firebase API.
  const incomes = [42000, 45000, 44000, 47000, 48000, 47500, 51000, 52000, 50000, 56000, 55000, 58500]
  const expenses = [28600, 32100, 35400, 30300, 51800, 34200, 36600, 39500, 37800, 41100, 39200, 42400]
  const transactions = getTrendMonthKeys(endMonth, 12).flatMap((monthKey, index) => {
    const [year, month] = monthKey.split("-").map(Number)
    const datetime = new Date(year, month - 1, 5, 12).toISOString()
    const freelance = index % 3 === 0 ? 4500 : 0
    const base = { datetime, paymentMethod: "upi" }
    const records = [
      { ...base, type: "income", amount: incomes[index] - freelance, category: "Income", person: "Sample employer" },
      ...(freelance ? [{ ...base, type: "income", amount: freelance, category: "Income", person: "Sample client" }] : []),
      ...[
        ["Housing", 0.4], ["Food & Dining", 0.25], ["Utilities", 0.1],
        ["Transport", 0.1], ["Shopping", 0.15],
      ].map(([category, share]) => ({ ...base, type: "expense", amount: expenses[index] * share, category })),
    ]
    return records.map((transaction, recordIndex) => ({
      id: `__finsight_trend_preview_${monthKey}_${recordIndex}`,
      ...transaction,
    }))
  })
  return getMonthlyCashFlow(transactions, endMonth, monthCount)
}
