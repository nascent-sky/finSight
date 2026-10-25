import test from "node:test"
import assert from "node:assert/strict"
import { createFinancialIndex, analyseFinancialQuery } from "../../src/features/finance-ai/financialEngine.js"
import { validateInterpretedIntent } from "../../src/features/finance-ai/questionPlanner.js"
import { formatExpenseAmount } from "../../src/components/analytics/expenseChartUtils.js"
import { validateResponsePresentation } from "../../src/features/finance-ai/responseBlocks.js"
import { prepareCloudLayout, selectPreparedBlocks, narrativeFacts, uniqueNarrativeBlocks, purchaseDeferralRequested } from "../lib/responseComposition.js"
import { validateDevelopmentResponse } from "../lib/developmentResponse.js"

const now = new Date("2026-10-25T12:00:00Z"), options = { now, timezone: "UTC" }
const row = (id, amount, category, month = "10", method = "upi") => ({ id, amount, type: "expense", datetime: `2026-${month}-02T12:00:00Z`, category, paymentMethod: method })
const data = [row("shopping", 90.30, "Shopping"), row("shopping-small", 20, "Shopping"), row("movie", 81.27, "Entertainment"), row("health", 812.70, "Healthcare"), row("food", 500, "Food & Dining"), row("school", 600, "Education"), row("transport", 100, "Transport"), row("before", 50, "Shopping", "09")]
const index = createFinancialIndex(data, options)
const plan = (extra = {}) => {
  const { task = "answer", reductionBps = null, ...query } = extra
  return { ...validateInterpretedIntent({ status: "resolved", intent: "breakdown", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, explain: true, reference: false, ...query }, options), task, reductionBps }
}
const layout = (extra) => { const p = plan(extra); return prepareCloudLayout(analyseFinancialQuery(index, p), p) }
const compose = (prepared, output = { answer: "Here is the verified result." }) => validateDevelopmentResponse(output, { facts: {}, cardMap: {}, catalog: prepared.catalog, defaultBlocks: prepared.blocks, policies: [prepared.policy], allowedActions: prepared.allowedActions })

test("cloud defaults follow validated intent and reject irrelevant optional cards without changing the final contract", () => {
  const overview = layout()
  const answer = compose(overview, { answer: "Here is the spending breakdown.", blockIds: ["q0_categories", "q0_expenses", "q0_c0_cut10", "q0_categories"] })
  assert.deepEqual(answer.presentation.blocks.map((block) => block.type), ["paragraph", "categories", "actions"])
  const biggest = layout({ intent: "largest" })
  assert.equal(biggest.policy.mode, "records")
  assert.ok(Object.values(biggest.catalog).every(({ block }) => !["metric", "categories", "savings"].includes(block.type)))
  const total = compose(layout({ intent: "expenses" }))
  assert.deepEqual(total.presentation.blocks.map((block) => block.type), ["paragraph", "metric", "actions"])
  const comparison = compose(layout({ intent: "comparison", comparisonStart: "2026-09-01", comparisonEnd: "2026-10-01" }))
  assert.deepEqual(comparison.presentation.blocks.map((block) => block.type), ["paragraph", "comparison", "actions"])
  const c = comparison.cards[0]
  assert.equal(c.previousPaise, 5000)
  assert.equal(c.currentPaise, 220427)
  assert.equal(c.changePaise, 215427)
  validateResponsePresentation(answer.presentation)
})

test("recommendations use recorded optional-purchase evidence, exclude automatic essential-category cuts and combine only disjoint scenarios", () => {
  const prepared = layout({ task: "reduce" })
  const ids = Object.keys(prepared.catalog)
  const answer = compose(prepared, { answer: "Review flexibility before changing spending.", blockIds: [...ids, ...ids] })
  const recommendations = answer.presentation.blocks.filter((block) => block.type === "recommendation")
  assert.equal(recommendations.length, 3)
  assert.match(recommendations[0].title, /Shopping/)
  assert.match(recommendations[0].text, /2 recorded Shopping purchases.*10%.*₹11\.03/)
  assert.match(recommendations[1].title, /Entertainment/)
  assert.equal(recommendations[0].estimate.originalPaise, 11030)
  assert.equal(recommendations[0].estimate.savingPaise, 2206)
  assert.equal(recommendations[0].estimate.remainingPaise, 8824)
  assert.equal(recommendations[0].estimate.reductionBps, 2000)
  assert.ok(recommendations.every((block) => !block.estimate || !/healthcare|education|food|transport/i.test(block.title)))
  const summaries = answer.presentation.blocks.filter((block) => block.type === "savings")
  assert.equal(summaries.length, 1)
  assert.equal(summaries[0].savingPaise, 3831)
  assert.equal(summaries[0].originalPaise, 19157)
  assert.equal(summaries[0].remainingPaise, 15326)
  assert.match(summaries[0].period, /incomplete/)
  assert.equal(summaries[0].hypothetical, true)
  assert.ok(ids.every((id) => !/_cut(?:10|20)$/.test(id)))
  const protectedCategory = compose(layout({ task: "reduce", category: "Healthcare" }))
  assert.ok(protectedCategory.presentation.blocks.every((block) => block.type !== "savings" && !block.estimate))
  const selectedLargest = layout({ intent: "largest", task: "reduce" })
  assert.ok(selectedLargest.blocks.every((block) => !block.title?.includes("Entertainment"))) // not among these five largest records
})

test("financial identity includes scope and role; equal amounts across categories or payment scopes are not duplicates", () => {
  const metric = { type: "metric", label: "Recorded expenses", semantic: "expense", amountPaise: 10000, period: "October" }
  const cash = { block: metric, scope: "cash" }, upi = { block: { ...metric }, scope: "upi" }
  const selected = selectPreparedBlocks({ catalog: {}, defaultBlocks: [], suggested: [cash, { ...cash, block: { ...metric, label: "Expenses" } }, upi] })
  assert.equal(selected.length, 2)
  assert.deepEqual(selected.map((resource) => resource.scope), ["cash", "upi"])
  const categories = { type: "categories", period: "October", basis: "expenses", totalPaise: 10000, otherCount: 0, items: [{ label: "Shopping", amountPaise: 10000, share: 100 }] }
  const breakdown = selectPreparedBlocks({ catalog: {}, defaultBlocks: [], suggested: [cash, { block: categories, scope: "cash" }, upi] })
  assert.equal(breakdown.filter((resource) => resource.block.type === "metric").length, 1)
  assert.equal(breakdown.find((resource) => resource.block.type === "metric").scope, "upi")
})

test("embedded savings and comparison aliases are shown once, with different financial information retained", () => {
  const savings = { type: "savings", label: "Shopping", period: "October", originalPaise: 10000, savingPaise: 2000, remainingPaise: 8000, reductionBps: 2000, hypothetical: true }
  const recommendation = { type: "recommendation", title: "Review flexibility", text: "Consider the proposed cut only if suitable.", estimate: savings }
  const selected = selectPreparedBlocks({ catalog: {}, defaultBlocks: [recommendation], suggested: [{ block: { ...savings } }, { block: recommendation }] })
  assert.deepEqual(selected.map(({ block }) => block.type), ["recommendation"])
  const a = { type: "comparison", card: { id: "a", metric: "expense", previousStart: "2026-09-01", currentStart: "2026-10-01", previousPaise: 10, currentPaise: 20 } }
  assert.equal(selectPreparedBlocks({ catalog: {}, defaultBlocks: [], suggested: [{ block: a }, { block: { ...a, card: { ...a.card, id: "alias" } } }] }).length, 1)
})

test("prompt facts follow presentation ownership and chronological card facts without deleting unique explanatory prose", () => {
  const facts = { q0_record0: { value: "a full verified record" }, q0_current_expenses: { value: "₹2,000" }, q0_c0_amount: { value: "₹1,000" }, q1_c0_cut10: { value: "₹10" }, q1_current_expenses: { value: "₹100" }, q2_expense_change_percentage: { value: "-50%" }, q2_comparison_percentage: { value: "+100%" }, q2_comparison_previous_period: { value: "September" } }
  const filtered = narrativeFacts(facts, [{ mode: "records", defaultIds: ["q0_detail0"] }, { mode: "recommendations", defaultIds: ["q1_review0"] }, { mode: "comparison", defaultIds: ["q2_comparison_expenses"] }])
  assert.deepEqual(Object.keys(filtered), ["q0_current_expenses", "q1_current_expenses", "q2_comparison_percentage", "q2_comparison_previous_period"])
  const unique = uniqueNarrativeBlocks([{ type: "paragraph", text: "The list suggests reviewing flexibility; the amount alone proves no cause." }, { type: "list", ordered: false, items: ["a full verified record", "A distinct suggestion remains"] }], [], ["a full verified record"])
  assert.equal(unique.length, 2)
  assert.deepEqual(unique[1].items, ["A distinct suggestion remains"])
})

test("central INR formatting retains whole rupees and two paise digits consistently", () => {
  for (const [value, expected] of [[90.30, "₹90.30"], [812.70, "₹812.70"], [2000, "₹2,000"], [-90.3, "-₹90.30"], [.01, "₹0.01"], [0, "₹0"]]) assert.equal(formatExpenseAmount(value), expected)
})

test("explicit reduction requests retain their authoritative rate and zero-data estimate", () => {
  const prepared = layout({ task: "reduce", category: "Healthcare", reductionBps: 2000 })
  const saving = prepared.blocks.find((block) => block.type === "savings")
  assert.equal(saving.reductionBps, 2000)
  assert.equal(saving.originalPaise, 81270)
  assert.equal(saving.savingPaise, 16254)
  const p = plan({ task: "reduce", category: "Travel", reductionBps: 2000 })
  const zero = prepareCloudLayout(analyseFinancialQuery(index, p), p)
  assert.equal(zero.policy.mode, "scenario")
  assert.equal(zero.blocks.find((block) => block.type === "savings").savingPaise, 0)
})

test("ordinary Shopping advice uses verified 10–20% alternatives and retains most of a single purchase", () => {
  const shoppingIndex = createFinancialIndex([row("one-purchase", 1200, "Shopping")], options)
  const p = plan({ task: "reduce", category: "Shopping" })
  const analysis = analyseFinancialQuery(shoppingIndex, p)
  const prepared = prepareCloudLayout(analysis, p)
  const recommendation = prepared.blocks.find((block) => block.type === "recommendation" && block.estimate)
  assert.match(recommendation.text, /10% scenario would save ₹120/)
  assert.match(recommendation.text, /If part of this spending is flexible/)
  assert.equal(recommendation.estimate.reductionBps, 2000)
  assert.equal(recommendation.estimate.savingPaise, 24000)
  assert.equal(recommendation.estimate.remainingPaise, 96000)
  assert.equal(recommendation.estimate.hypothetical, true)
  assert.doesNotThrow(() => validateResponsePresentation({ version: 1, blocks: prepared.blocks }))
})

test("explicit purchase-deferral requests retain the optional full-purchase scenario; ordinary or negated requests do not", () => {
  for (const question of ["What if I defer that optional shopping purchase?", "Could I postpone this purchase?", "Explain that deferral option"]) assert.equal(purchaseDeferralRequested(question), true)
  for (const question of ["How can I reduce my shopping expenses?", "How can I reduce shopping without cancelling my purchase?", "I do not want to defer this purchase"]) assert.equal(purchaseDeferralRequested(question), false)
  const p = plan({ task: "reduce", category: "Shopping" })
  const analysis = analyseFinancialQuery(index, p)
  const prepared = prepareCloudLayout(analysis, p, "q0", {}, { allowPurchaseDeferral: true })
  const estimate = prepared.blocks.find((block) => block.type === "recommendation" && block.estimate).estimate
  assert.equal(estimate.savingPaise, 9030)
  assert.equal(estimate.remainingPaise, 2000)
  assert.equal(estimate.reductionBps, null)
  assert.match(estimate.label, /One optional Shopping purchase/)
  const full = layout({ task: "reduce", category: "Shopping", reductionBps: 10000 }).blocks.find((block) => block.type === "savings")
  assert.equal(full.savingPaise, 11030)
  assert.equal(full.remainingPaise, 0)
})
