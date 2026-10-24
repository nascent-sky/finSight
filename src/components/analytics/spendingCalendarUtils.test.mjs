import test from "node:test"
import assert from "node:assert/strict"

import { getMonthlyExpenseStats } from "./expenseChartUtils.js"
import { getMonthlyCashFlow } from "./cashFlowTrendUtils.js"
import {
  getLocalDayKey, getMonthlySpendingCalendar, getSpendingCalendarPreview, getSpendingIntensity,
} from "./spendingCalendarUtils.js"

const now = new Date(2026, 9, 24, 12)
const expense = (day, amount, overrides = {}) => ({
  type: "expense", amount, category: "Food & Dining", paymentMethod: "upi",
  datetime: new Date(2026, 9, day, 12).toISOString(), ...overrides,
})

test("multiple expenses group by local day using exact paise totals and transaction counts", () => {
  const stats = getMonthlySpendingCalendar([expense(1, 0.1), expense(1, "0.20"), expense(7, 345.67)], "2026-10", now)
  assert.equal(stats.days.length, 31)
  assert.equal(stats.days[0].amount, 0.3)
  assert.equal(stats.days[0].transactionCount, 2)
  assert.equal(stats.days[6].amount, 345.67)
  assert.equal(stats.totalExpenses, 345.97)
  assert.equal(stats.transactionCount, 3)
  assert.equal(stats.spendingDays, 2)
  assert.ok(stats.days.filter((day) => day.transactionCount === 0).every((day) => day.amount === 0 && day.intensity === 0))
})

test("canonical expense type excludes income, transfers and invalid or missing records", () => {
  const stats = getMonthlySpendingCalendar([
    expense(1, 100, { category: "Income" }), expense(1, 1000, { type: "income" }),
    expense(1, 5000, { type: "transfer" }), expense(1, 6000, { type: "internal_transfer" }),
    expense(1, 5, { type: undefined }), expense(1, 0), expense(1, -10), expense(1, Infinity),
    expense(1, NaN), expense(1, "bad"), expense(1, 0.001), expense(1, Number.MAX_VALUE),
    expense(1, 50, { datetime: null }), expense(1, 50, { datetime: "" }),
    expense(1, 50, { datetime: "not a date" }), expense(1, 50, { datetime: 0 }), null,
    expense(1, 50, { datetime: "2026-10-32T12:00:00Z" }),
    expense(1, 50, { datetime: "2026-02-30T12:00:00Z" }),
  ], "2026-10", now)
  assert.equal(stats.totalExpenses, 100)
  assert.equal(stats.transactionCount, 1)
})

test("first and last local instants include only the selected month across year boundaries", () => {
  const make = (date, amount) => expense(1, amount, { datetime: date.toISOString() })
  const stats = getMonthlySpendingCalendar([
    make(new Date(2025, 11, 31, 23, 59, 59, 999), 10),
    make(new Date(2026, 0, 1, 0, 0, 0, 0), 100),
    make(new Date(2026, 0, 31, 23, 59, 59, 999), 200),
    make(new Date(2026, 1, 1, 0, 0, 0, 0), 20),
  ], "2026-01", now)
  assert.equal(stats.days[0].amount, 100)
  assert.equal(stats.days.at(-1).amount, 200)
  assert.equal(stats.totalExpenses, 300)
  assert.equal(stats.transactionCount, 2)
})

test("UTC serialization is converted back to the local day rather than sliced for grouping", () => {
  const localMidnight = new Date(2026, 9, 1, 0, 1)
  const localLateNight = new Date(2026, 9, 31, 23, 59)
  const stats = getMonthlySpendingCalendar([
    expense(1, 11, { datetime: localMidnight.toISOString() }),
    expense(1, 22, { datetime: localLateNight.toISOString() }),
  ], "2026-10", now)
  assert.equal(getLocalDayKey(localMidnight), "2026-10-01")
  assert.equal(stats.days[0].amount, 11)
  assert.equal(stats.days[30].amount, 22)
})

test("date-only legacy values remain local and impossible dates do not roll over", () => {
  const stats = getMonthlySpendingCalendar([
    expense(1, 10, { datetime: "2024-02-01" }),
    expense(1, 20, { datetime: "2024-02-29" }),
    expense(1, 30, { datetime: "2024-02-30" }),
    expense(1, 40, { datetime: "2023-02-29" }),
  ], "2024-02", now)
  assert.equal(stats.days.length, 29)
  assert.equal(stats.days[0].amount, 10)
  assert.equal(stats.days[28].amount, 20)
  assert.equal(stats.totalExpenses, 30)
})

test("Monday-first calendar aligns weekdays, leap years and four- to six-week months", () => {
  for (const [monthKey, days, leading, weeks] of [
    ["2021-02", 28, 0, 4], ["2024-02", 29, 3, 5], ["2026-08", 31, 5, 6],
  ]) {
    const stats = getMonthlySpendingCalendar([], monthKey, now)
    assert.equal(stats.weeks.length, weeks)
    assert.ok(stats.weeks.every((week) => week.length === 7))
    assert.equal(stats.weeks[0].findIndex(Boolean), leading)
    assert.equal(stats.weeks.flat().filter(Boolean).length, days)
    assert.deepEqual(stats.weeks.flat().filter(Boolean).map((day) => day.day), Array.from({ length: days }, (_, index) => index + 1))
  }
})

test("past-month average includes every calendar day, including days without expenses", () => {
  const stats = getMonthlySpendingCalendar([
    expense(1, 1000, { datetime: new Date(2026, 3, 12, 12).toISOString() }),
  ], "2026-04", now)
  assert.equal(stats.averageDayCount, 30)
  assert.equal(stats.averageDailyExpense, 33.33)
  assert.equal(stats.isCurrentMonth, false)
})

test("current-month average includes today and zero days but excludes future-dated expenses", () => {
  const stats = getMonthlySpendingCalendar([expense(1, 120), expense(24, 240), expense(25, 240)], "2026-10", now)
  assert.equal(stats.averageDayCount, 24)
  assert.equal(stats.averageDailyExpense, 15)
  assert.equal(stats.totalExpenses, 600)
  assert.equal(stats.transactionCount, 3)
  assert.equal(stats.days[23].isToday, true)
  assert.equal(stats.days[24].isFuture, true)
  assert.equal(stats.days[23].isFuture, false)
  assert.equal(stats.isCurrentMonth, true)
})

test("future months have no elapsed-day average and midnight advances the denominator", () => {
  const records = [expense(1, 24)]
  assert.equal(getMonthlySpendingCalendar(records, "2026-10", new Date(2026, 8, 30)).averageDayCount, 0)
  assert.equal(getMonthlySpendingCalendar(records, "2026-10", new Date(2026, 8, 30)).averageDailyExpense, 0)
  assert.equal(getMonthlySpendingCalendar(records, "2026-10", new Date(2026, 9, 24, 23, 59)).averageDailyExpense, 1)
  assert.equal(getMonthlySpendingCalendar(records, "2026-10", new Date(2026, 9, 25, 0, 0)).averageDailyExpense, 0.96)
})

test("peak ties choose the earliest date and intensity stays proportional and bounded", () => {
  const records = [expense(9, 1000), expense(3, 1000), expense(1, 250)]
  const stats = getMonthlySpendingCalendar(records, "2026-10", now)
  assert.equal(stats.highestDay.day, 3)
  assert.equal(getMonthlySpendingCalendar([...records].reverse(), "2026-10", now).highestDay.day, 3)
  assert.equal(stats.days[0].intensity, 1)
  assert.equal(stats.days[2].intensity, 4)
  assert.deepEqual([0, 1, 250, 251, 500, 501, 750, 751, 1000].map((amount) => getSpendingIntensity(amount, 1000)), [0, 1, 1, 2, 2, 3, 3, 4, 4])
  assert.equal(getSpendingIntensity(100, 0), 0)
})

test("canonical duplicate ids count once; separate identical id-less payments remain distinct", () => {
  const payment = expense(1, 200, { id: "one" })
  const stats = getMonthlySpendingCalendar([payment, { ...payment, pending: true }, expense(1, 200), expense(1, 200)], "2026-10", now)
  assert.equal(stats.totalExpenses, 600)
  assert.equal(stats.transactionCount, 3)
})

test("day details sort by time and copy display fields without mutating the live feed", () => {
  const records = Object.freeze([
    Object.freeze(expense(1, 100, { id: "morning", datetime: new Date(2026, 9, 1, 8).toISOString() })),
    Object.freeze(expense(1, 200, { id: "evening", category: "  ", datetime: new Date(2026, 9, 1, 20).toISOString() })),
  ])
  const original = structuredClone(records)
  const stats = getMonthlySpendingCalendar(records, "2026-10", now)
  assert.deepEqual(stats.days[0].transactions.map((transaction) => transaction.id), ["evening", "morning"])
  assert.equal(stats.days[0].transactions[0].category, "Other")
  stats.days[0].transactions[0].amount = 0
  assert.deepEqual(records, original)
  assert.equal(getMonthlySpendingCalendar(records, "2026-10", now).totalExpenses, 300)
})

test("daily totals reconcile with category and cash-flow Analytics calculations", () => {
  const records = [expense(1, 123.45), expense(3, 32.1), expense(10, 500), expense(1, 2000, { type: "income" })]
  const stats = getMonthlySpendingCalendar(records, "2026-10", now)
  assert.equal(stats.totalExpenses, getMonthlyExpenseStats(records, "2026-10").totalExpenses)
  assert.equal(stats.totalExpenses, getMonthlyCashFlow(records, "2026-10").months.at(-1).expenses)
  assert.equal(Math.round(stats.days.reduce((sum, day) => sum + day.amount, 0) * 100), Math.round(stats.totalExpenses * 100))
})

test("empty data is neutral, never auto-generates samples and has no invented highest day", () => {
  for (const records of [[], null, [expense(1, 100, { type: "income" })]]) {
    const stats = getMonthlySpendingCalendar(records, "2026-10", now)
    assert.equal(stats.transactionCount, 0)
    assert.equal(stats.totalExpenses, 0)
    assert.equal(stats.spendingDays, 0)
    assert.equal(stats.averageDailyExpense, 0)
    assert.equal(stats.highestDay, null)
    assert.ok(stats.days.every((day) => day.intensity === 0 && day.transactions.length === 0))
  }
})

test("preview data is realistic, valid in short months and fully isolated from real transactions", () => {
  const records = [expense(3, 99)]
  const before = getMonthlySpendingCalendar(records, "2026-10", now)
  const preview = getSpendingCalendarPreview("2026-10", now)
  assert.ok(preview.spendingDays >= 10)
  assert.ok(preview.days.some((day) => day.transactionCount > 1))
  assert.ok(preview.days.some((day) => day.amount === 0))
  assert.ok(preview.days.some((day) => day.amount > 10000))
  assert.ok(preview.days.flatMap((day) => day.transactions).every((record) => record.person.startsWith("Sample ")))
  preview.days[0].transactions[0].amount = 1
  preview.days.length = 0
  assert.deepEqual(getMonthlySpendingCalendar(records, "2026-10", now), before)
  assert.equal(getSpendingCalendarPreview("2026-10", now).days.length, 31)
  assert.equal(getSpendingCalendarPreview("2023-02", now).transactionCount, 17)
  assert.equal(getMonthlySpendingCalendar([], "2026-10", now).transactionCount, 0)
})

test("invalid months and invalid reference dates are rejected instead of producing misleading calendars", () => {
  for (const month of ["bad", "2026-00", "2026-13", "2026-1", "0000-01"]) {
    assert.throws(() => getMonthlySpendingCalendar([], month, now), RangeError)
  }
  assert.throws(() => getMonthlySpendingCalendar([], "2026-10", new Date("bad")), RangeError)
})
