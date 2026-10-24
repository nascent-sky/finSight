import test from "node:test"
import assert from "node:assert/strict"

import { getMonthlyExpenseStats } from "./expenseChartUtils.js"
import {
  formatTrendAxisAmount,
  getCashFlowPreview,
  getMonthlyCashFlow,
  getTrendMonthKeys,
} from "./cashFlowTrendUtils.js"

const record = (type, amount, monthKey = "2026-01", overrides = {}) => {
  const [year, month] = monthKey.split("-").map(Number)
  return { type, amount, datetime: new Date(year, month - 1, 15, 12).toISOString(), ...overrides }
}

test("6- and 12-month windows are chronological and include the selected ending month across years", () => {
  assert.deepEqual(getTrendMonthKeys("2026-01", 6), ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"])
  const keys = getTrendMonthKeys("2026-02", 12)
  assert.equal(keys.length, 12)
  assert.equal(keys[0], "2025-03")
  assert.equal(keys.at(-1), "2026-02")
  assert.deepEqual([...keys].sort(), keys)
})

test("income-source payments count once by canonical id, while separate payments from the same person remain distinct", () => {
  const salary = record("income", 45000, "2026-01", { id: "salary", person: "Employer", category: "Income" })
  const stats = getMonthlyCashFlow([
    salary, { ...salary }, { ...salary, pending: true },
    record("income", 5000, "2026-01", { id: "bonus", person: "Employer" }),
    record("expense", 30000, "2026-01", { id: "rent" }),
  ], "2026-01")
  assert.equal(stats.totalIncome, 50000)
  assert.equal(stats.totalExpenses, 30000)
  assert.equal(stats.netCashFlow, 20000)
  assert.equal(stats.transactionCount, 3)
})

test("canonical type controls classification; explicit transfers and invalid records are excluded", () => {
  const stats = getMonthlyCashFlow([
    record("income", 500, "2026-01", { category: "Food & Dining" }),
    record("expense", 200, "2026-01", { category: "Income" }),
    record("transfer", 20000), record("internal_transfer", 40000), record(undefined, 5000),
    record("income", -100), record("expense", 0), record("income", Infinity),
    record("expense", "invalid"), record("income", 10, "2026-01", { datetime: "bad date" }),
    record("income", 10, "2026-01", { datetime: null }), null,
  ], "2026-01")
  assert.equal(stats.totalIncome, 500)
  assert.equal(stats.totalExpenses, 200)
  assert.equal(stats.transactionCount, 2)
})

test("missing months are zero and period averages include every month", () => {
  const stats = getMonthlyCashFlow([record("expense", 600)], "2026-01")
  assert.equal(stats.months.length, 6)
  assert.ok(stats.months.slice(0, -1).every(({ income, expenses, net }) => income === 0 && expenses === 0 && net === 0))
  assert.equal(stats.populatedMonths, 1)
  assert.equal(stats.averageExpenses, 100)
  assert.equal(stats.averageIncome, 0)
  assert.equal(stats.netCashFlow, -600)
})

test("empty and out-of-range data stay empty without injecting demo values", () => {
  for (const records of [[], null, [record("income", 100, "2024-01")]]) {
    const stats = getMonthlyCashFlow(records, "2026-01", 12)
    assert.equal(stats.transactionCount, 0)
    assert.equal(stats.populatedMonths, 0)
    assert.equal(stats.netCashFlow, 0)
    assert.ok(stats.months.every(({ income, expenses, net }) => income === 0 && expenses === 0 && net === 0))
  }
})

test("paise arithmetic produces exact income, expenses, net and rounded monthly averages", () => {
  const stats = getMonthlyCashFlow([
    record("income", "100.10"), record("income", 0.2), record("expense", 0.1), record("expense", 0.2),
  ], "2026-01")
  assert.equal(stats.totalIncome, 100.3)
  assert.equal(stats.totalExpenses, 0.3)
  assert.equal(stats.netCashFlow, 100)
  assert.equal(stats.months.at(-1).net, 100)
  assert.equal(stats.averageIncome, 16.72)
  assert.equal(stats.averageExpenses, 0.05)
})

test("local first/last month boundaries and leap days are handled correctly", () => {
  const stats = getMonthlyCashFlow([
    record("income", 100, "2024-02", { datetime: new Date(2023, 8, 1, 0, 0).toISOString() }),
    record("income", 200, "2024-02", { datetime: new Date(2024, 1, 29, 23, 59, 59, 999).toISOString() }),
    record("expense", 300, "2024-02", { datetime: new Date(2023, 7, 31, 23, 59, 59, 999).toISOString() }),
    record("expense", 400, "2024-02", { datetime: new Date(2024, 2, 1, 0, 0).toISOString() }),
  ], "2024-02")
  assert.equal(stats.months[0].income, 100)
  assert.equal(stats.months.at(-1).income, 200)
  assert.equal(stats.totalExpenses, 0)
})

test("positive, negative and break-even monthly net flow retain their signs", () => {
  const stats = getMonthlyCashFlow([
    record("income", 100, "2025-11"), record("expense", 50, "2025-11"),
    record("income", 100, "2025-12"), record("expense", 150, "2025-12"),
    record("income", 100, "2026-01"), record("expense", 100, "2026-01"),
  ], "2026-01")
  assert.deepEqual(stats.months.slice(-3).map(({ net }) => net), [50, -50, 0])
  assert.equal(stats.netCashFlow, 0)
})

test("range switches preserve overlapping values and exclude old transactions from six-month summaries", () => {
  const records = [record("income", 1000, "2025-03"), record("income", 2000, "2025-12"), record("expense", 300, "2026-01")]
  const six = getMonthlyCashFlow(records, "2026-01", 6)
  const twelve = getMonthlyCashFlow(records, "2026-01", 12)
  assert.deepEqual(twelve.months.slice(-6), six.months)
  assert.equal(twelve.totalIncome - six.totalIncome, 1000)
})

test("distinct id-less records are not accidentally deduplicated by amount or person", () => {
  const stats = getMonthlyCashFlow([record("income", 100), record("income", 100)], "2026-01")
  assert.equal(stats.totalIncome, 200)
  assert.equal(stats.transactionCount, 2)
})

test("aggregation never mutates the live transaction array", () => {
  const records = Object.freeze([
    Object.freeze(record("expense", 1200)), Object.freeze(record("income", 4000)),
  ])
  const before = structuredClone(records)
  getMonthlyCashFlow(records, "2026-01")
  assert.deepEqual(records, before)
})

test("trend expense values agree with the Phase 19.1 category calculation", () => {
  const records = getTrendMonthKeys("2026-01", 12).flatMap((monthKey, index) => [
    record("expense", 100.25 + index, monthKey), record("income", 2000 + index, monthKey),
  ])
  for (const month of getMonthlyCashFlow(records, "2026-01", 12).months) {
    assert.equal(month.expenses, getMonthlyExpenseStats(records, month.monthKey).totalExpenses)
  }
})

test("sample data spans twelve believable months, contains negative net flow and stays consistent across ranges", () => {
  const twelve = getCashFlowPreview("2026-01", 12)
  const six = getCashFlowPreview("2026-01", 6)
  assert.equal(twelve.populatedMonths, 12)
  assert.ok(twelve.months.some(({ net }) => net < 0))
  assert.ok(twelve.months.every(({ income, expenses }) => income >= 30000 && expenses >= 20000))
  assert.deepEqual(twelve.months.slice(-6), six.months)
  assert.equal(twelve.months.reduce((sum, { income }) => sum + income, 0), twelve.totalIncome)
  assert.equal(twelve.totalIncome - twelve.totalExpenses, twelve.netCashFlow)
})

test("sample previews are fresh snapshots and cannot alter real calculations", () => {
  const records = [record("income", 1000)]
  const original = structuredClone(records)
  const before = getMonthlyCashFlow(records, "2026-01")
  const preview = getCashFlowPreview("2026-01")
  preview.months[0].income = 0
  preview.months.length = 0
  assert.deepEqual(getMonthlyCashFlow(records, "2026-01"), before)
  assert.deepEqual(records, original)
  assert.equal(getCashFlowPreview("2026-01").months.length, 6)
})

test("axis labels use readable INR units and preserve negative signs", () => {
  assert.equal(formatTrendAxisAmount(0), "₹0")
  assert.equal(formatTrendAxisAmount(500), "₹500")
  assert.equal(formatTrendAxisAmount(45000), "₹45k")
  assert.equal(formatTrendAxisAmount(-125000), "−₹1.3L")
  assert.equal(formatTrendAxisAmount(15000000), "₹1.5Cr")
})

test("invalid ranges cannot silently generate misleading periods", () => {
  assert.throws(() => getMonthlyCashFlow([], "2026-01", 7), RangeError)
  assert.throws(() => getMonthlyCashFlow([], "2026-13"), RangeError)
  assert.throws(() => getMonthlyCashFlow([], "not a date"), RangeError)
})
