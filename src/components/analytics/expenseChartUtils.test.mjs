import test from "node:test"
import assert from "node:assert/strict"

import {
  formatExpenseAmount,
  formatExpensePercentage,
  getCategoryColor,
  getCategoryExpensePreview,
  getExpensePieLayout,
  getMonthKey,
  getMonthlyExpenseStats,
} from "./expenseChartUtils.js"

const expense = (amount, category = "Other", day = 1, overrides = {}) => ({
  amount,
  category,
  datetime: new Date(2026, 9, day, 12).toISOString(),
  type: "expense",
  ...overrides,
})

test("monthly totals include only expenses in the selected local month and year", () => {
  const transactions = [
    expense(100, "Food & Dining"),
    expense("50.25", "Food & Dining", 8),
    expense(49.75, "Transport", 31),
    expense(900, "Income", 2, { type: "income" }),
    expense(700, "Other", 3, { type: "transfer" }),
    expense(800, "Other", 4, { type: undefined }),
    expense(300, "Other", 1, { datetime: new Date(2026, 8, 30, 23, 59).toISOString() }),
    expense(400, "Other", 1, { datetime: new Date(2025, 9, 1, 12).toISOString() }),
    expense(500, "Other", 1, { datetime: new Date(2026, 10, 1, 0, 0).toISOString() }),
  ]
  const stats = getMonthlyExpenseStats(transactions, "2026-10")
  assert.equal(stats.totalExpenses, 200)
  assert.deepEqual(stats.categories.map(({ name, amount, percentage }) => ({ name, amount, percentage })), [
    { name: "Food & Dining", amount: 150.25, percentage: 75.125 },
    { name: "Transport", amount: 49.75, percentage: 24.875 },
  ])
  assert.equal(Object.values(stats.weeklyBreakdown).reduce((sum, amount) => sum + amount, 0), stats.totalExpenses)
  assert.equal(getMonthlyExpenseStats(transactions, "2026-09").totalExpenses, 300)
})

test("paise arithmetic stays exact, and all week boundaries match the monthly total", () => {
  const stats = getMonthlyExpenseStats([
    expense(0.1, "Food & Dining", 1),
    expense(0.2, "Food & Dining", 7),
    expense(0.3, "Food & Dining", 8),
    expense(0.4, "Food & Dining", 14),
    expense(0.5, "Food & Dining", 15),
    expense(0.6, "Food & Dining", 21),
    expense(0.7, "Food & Dining", 22),
    expense(0.8, "Food & Dining", 31),
  ], "2026-10")
  assert.equal(stats.totalExpenses, 3.6)
  assert.equal(stats.categories[0].percentage, 100)
  assert.deepEqual(Object.values(stats.weeklyBreakdown), [0.3, 0.7, 1.1, 1.5])
})

test("invalid records are ignored, missing categories use Other, and names are safe map keys", () => {
  const stats = getMonthlyExpenseStats([
    expense(0), expense(-1), expense(Infinity), expense("not a number"),
    expense(10, "Other", 1, { datetime: "invalid" }),
    expense(10, "Other", 1, { datetime: null }),
    expense(10, "  "), expense(20, null), expense(30, "__proto__"),
  ], "2026-10")
  assert.equal(stats.totalExpenses, 60)
  assert.equal(stats.categories.length, 2)
  assert.equal(stats.categories.find(({ name }) => name === "Other").amount, 30)
  assert.equal(stats.categories.find(({ name }) => name === "__proto__").amount, 30)
  assert.ok(stats.categories.every(({ percentage }) => percentage === 50))
})

test("empty months return no fabricated data or non-finite percentages", () => {
  const stats = getMonthlyExpenseStats([expense(10)], "2026-09")
  assert.equal(stats.totalExpenses, 0)
  assert.deepEqual(stats.categories, [])
  assert.ok(Object.values(stats.weeklyBreakdown).every((amount) => amount === 0))
})

test("sample chart data is varied, internally consistent, and exposes no transaction records", () => {
  const preview = getCategoryExpensePreview()
  assert.deepEqual(Object.keys(preview).sort(), ["categories", "totalExpenses"])
  assert.ok(preview.categories.length >= 6)
  assert.ok(preview.totalExpenses > 0)
  assert.ok(new Set(preview.categories.map(({ amount }) => amount)).size > 4)
  assert.equal(Math.round(preview.categories.reduce((sum, { amount }) => sum + amount, 0) * 100), Math.round(preview.totalExpenses * 100))
  assert.ok(Math.abs(preview.categories.reduce((sum, { percentage }) => sum + percentage, 0) - 100) < 1e-9)
})

test("generating or interacting with a sample dataset cannot change real monthly totals", () => {
  const records = [expense(1200, "Food & Dining"), expense(5000, "Income", 1, { type: "income" })]
  const original = structuredClone(records)
  const before = getMonthlyExpenseStats(records, "2026-10")
  const preview = getCategoryExpensePreview()
  preview.categories[0].amount = 0
  preview.categories.length = 0
  assert.deepEqual(records, original)
  assert.deepEqual(getMonthlyExpenseStats(records, "2026-10"), before)
  assert.equal(getMonthlyExpenseStats(records, "2026-09").totalExpenses, 0)
  assert.ok(getCategoryExpensePreview().categories.length >= 6)
})

test("ties, category colors, and custom category colors remain stable across input order and months", () => {
  const records = [expense(20, "Shopping"), expense(20, "Food & Dining"), expense(10, "Custom category 🪴")]
  const first = getMonthlyExpenseStats(records, "2026-10")
  assert.deepEqual(getMonthlyExpenseStats([...records].reverse(), "2026-10"), first)
  assert.equal(first.categories[0].name, "Food & Dining")
  assert.equal(getCategoryColor(" Shopping "), getCategoryColor("shopping"))
  assert.equal(getCategoryColor("Custom category 🪴"), first.categories[2].fill)
  const next = getMonthlyExpenseStats([expense(500, "Shopping")], "2026-10")
  assert.equal(next.categories[0].fill, first.categories[1].fill)
})

const assertLabelsFit = (layout, width) => {
  assert.ok(layout.cx - layout.radius >= 0)
  assert.ok(layout.cx + layout.radius <= width)
  assert.ok(layout.cy - layout.radius >= 0)
  assert.ok(layout.cy + layout.radius <= layout.height)
  for (const side of ["left", "right"]) {
    const labels = layout.labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y)
    labels.forEach((label, index) => {
      assert.ok(label.y - label.height / 2 >= 0)
      assert.ok(label.y + label.height / 2 <= layout.height)
      assert.ok(label.textX >= 0)
      assert.ok(label.textX + label.width <= width)
      assert.ok(!label.path.includes("NaN"))
      if (index) assert.ok(label.y - labels[index - 1].y >= label.height + 8)
    })
  }
}

test("narrow layouts preserve the full pie and defer labels to the breakdown", () => {
  const categories = getMonthlyExpenseStats([expense(100)], "2026-10").categories
  for (const width of [200, 240, 320, 480, 639]) {
    const layout = getExpensePieLayout(categories, width)
    assert.deepEqual(layout.labels, [])
    assertLabelsFit(layout, width)
  }
})

test("single-category and long-name labels stay inside a wide chart", () => {
  const categories = getMonthlyExpenseStats([expense(100, "An exceptionally long imported category ".repeat(10))], "2026-10").categories
  for (const width of [640, 768, 1200]) {
    const layout = getExpensePieLayout(categories, width)
    assert.equal(layout.labels.length, 1)
    assertLabelsFit(layout, width)
  }
})

test("dense label clusters cannot overlap, even with many categories or tiny slices", () => {
  for (const count of [2, 3, 8, 13, 20, 50, 100, 150]) {
    const balanced = Array.from({ length: count }, (_, index) => expense(100, `Category ${index}`))
    const clustered = [expense(5000, "Largest"), ...balanced]
    for (const records of [balanced, clustered]) {
      const stats = getMonthlyExpenseStats(records, "2026-10")
      for (const width of [640, 680, 900, 1440]) {
        const layout = getExpensePieLayout(stats.categories, width)
        assertLabelsFit(layout, width)
        assert.ok(layout.labels.length <= 10)
        assert.ok(layout.labels.every(({ index }) => stats.categories[index].percentage >= 1))
      }
      assert.equal(stats.categories.length, records.length)
      assert.ok(Math.abs(stats.categories.reduce((sum, category) => sum + category.percentage, 0) - 100) < 1e-9)
    }
  }
})

test("INR formatting and tiny percentages retain meaningful values", () => {
  assert.equal(formatExpenseAmount(123456.78), "₹1,23,456.78")
  assert.equal(formatExpenseAmount(0), "₹0")
  assert.equal(formatExpensePercentage(0.0001), "<0.1%")
  assert.equal(formatExpensePercentage(100), "100.0%")
  assert.equal(getMonthKey(new Date(2026, 0, 1)), "2026-01")
})
