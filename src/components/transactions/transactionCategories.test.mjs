import test from "node:test"
import assert from "node:assert/strict"

import {
  getTransactionCategoryOptions,
  normalizeTransactionCategory,
  TRANSACTION_CATEGORIES,
} from "./transactionCategories.js"

test("standard expense and income categories stay selectable without duplicates", () => {
  for (const category of TRANSACTION_CATEGORIES) {
    const options = getTransactionCategoryOptions(category)
    assert.equal(options.filter((option) => option === category).length, 1)
    assert.equal(options.length, TRANSACTION_CATEGORIES.length)
  }
  assert.ok(TRANSACTION_CATEGORIES.includes("Income"))
  assert.ok(Object.isFrozen(TRANSACTION_CATEGORIES))
})

test("editing an imported/custom category preserves the current value and all standard choices", () => {
  const category = "Household groceries & family celebrations 🛒"
  const options = getTransactionCategoryOptions(category)
  assert.ok(options.includes(category))
  assert.deepEqual(options.slice(0, -1), TRANSACTION_CATEGORIES)
  assert.equal(normalizeTransactionCategory(category), category)
  assert.ok(!TRANSACTION_CATEGORIES.includes(category))
})

test("add and edit normalize blank categories consistently and preserve custom names", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.equal(normalizeTransactionCategory(value), "Other")
    assert.deepEqual(getTransactionCategoryOptions(value), TRANSACTION_CATEGORIES)
  }
  assert.equal(normalizeTransactionCategory("  Healthcare  "), "Healthcare")
  assert.ok(getTransactionCategoryOptions("  Custom category  ").includes("Custom category"))
})
