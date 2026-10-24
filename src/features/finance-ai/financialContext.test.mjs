import test from "node:test"
import assert from "node:assert/strict"
import { calculateComparison, resolveAnswer, INITIAL_QUESTIONS, MAX_MONEY_PAISE } from "./financialContext.js"

const facts = { current: { value: "₹3,450" }, previous: { value: "₹2,800" }, reduction: { value: "₹345" }, category: { value: "Category 2025" } }

test("comparisons retain exact paise change, rounded percentage and direction", () => {
  assert.deepEqual(calculateComparison(280000, 345000), { previousPaise: 280000, currentPaise: 345000, changePaise: 65000, percentage: 23.2, direction: "up" })
  assert.equal(calculateComparison(100, 0).percentage, -100)
  assert.equal(calculateComparison(0, 100).percentage, null)
  assert.equal(calculateComparison(0, 0).direction, "flat")
})

test("unsafe, negative and non-integer comparison amounts cannot produce cards", () => {
  for (const value of [NaN, Infinity, -1, .1, MAX_MONEY_PAISE + 1]) assert.throws(() => calculateComparison(value, 0))
})

test("fact references render exact amounts and numeric category labels without model arithmetic", () => {
  assert.equal(resolveAnswer("You recorded {{current}} compared with {{previous}}.", facts), "You recorded ₹3,450 compared with ₹2,800.")
  assert.equal(resolveAnswer("A hypothetical cut could save {{reduction}}.", facts), "A hypothetical cut could save ₹345.")
  assert.equal(resolveAnswer("The selected category is {{category}}.", facts), "The selected category is Category 2025.")
})

test("raw digits, written numeric amounts, invented keys and malformed placeholders fail closed", () => {
  for (const answer of ["You spent ₹999.", "Increase of 23%", "You spent １２３", "You spent two thousand rupees.", "{{unknown}}", "{{toString}}", "{{current}", "", "x".repeat(6001)]) assert.throws(() => resolveAnswer(answer, facts))
  assert.equal(resolveAnswer("There are no recorded expenses this month.", facts), "There are no recorded expenses this month.")
})

test("expanded facts cannot create oversized conversation history", () => {
  assert.throws(() => resolveAnswer("{{large}}".repeat(100), { large: { value: "x".repeat(100) } }), /too long/)
})

test("all five existing suggested questions are preserved verbatim", () => {
  assert.deepEqual(INITIAL_QUESTIONS, ["Where did my money go?", "How can I save ₹2,000?", "Show my biggest expenses", "Compare this month with last month", "What is my biggest spending category?"])
})

