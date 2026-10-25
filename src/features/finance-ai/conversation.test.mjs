import test from "node:test"
import assert from "node:assert/strict"
import { answerFinanceQuestion } from "./chatOrchestrator.js"
import { createFinancialIndex, analyseFinancialQuery } from "./financialEngine.js"
import { planFinancialQuestion, conversationContextFromPlan, validateConversationContext, validateInterpretedIntent } from "./questionPlanner.js"
import { getMonthlyExpenseStats } from "../../components/analytics/expenseChartUtils.js"
import { getMonthlyCashFlow } from "../../components/analytics/cashFlowTrendUtils.js"
import { answerDemoQuestion } from "./demoAnalysis.js"
import { resolveAnswer } from "./financialContext.js"

const now = new Date("2026-10-24T12:00:00Z")
const options = { now, timezone: "Asia/Kolkata" }
const tx = (id, amount, date, extra = {}) => ({ id, amount, datetime: date + "T10:00:00Z", type: "expense", category: "Food & Dining", paymentMethod: "upi", ...extra })
const records = [
  tx("income", 8000, "2026-10-16", { type: "income", category: "Income", paymentMethod: "cash", person: "Bookmarked source" }),
  tx("largest", 3000, "2026-10-16", { category: "Shopping", paymentMethod: "cash" }),
  tx("today1", 100.1, "2026-10-24"), tx("today2", 200.2, "2026-10-24", { category: "Transport", paymentMethod: "cash" }),
  tx("september", 4000, "2026-09-16"), tx("lastMonday", 10, "2026-10-12"), tx("lastSunday", 20, "2026-10-18"),
  tx("thisMonday", 50, "2026-10-19"), tx("beforeWeek", 60, "2026-10-11"),
]
const index = createFinancialIndex(records, options)
const plan = (question, context) => planFinancialQuestion(question, [], { ...options, categoryNames: index.categoryNames, context })
const query = (question, context) => analyseFinancialQuery(index, plan(question, context))
const ask = (question, context, extra = {}) => answerFinanceQuestion({ index, question, context, now, requestCloud: () => { throw new Error("unexpected cloud request") }, ...extra })

test("local casual intents never calculate finances or discard the last financial scope", async () => {
  const scope = (await ask("Show food spending via UPI", null)).context
  const noCalculations = { timezone: options.timezone, categoryNames: [], get records() { throw new Error("Casual chat must not calculate financial records") } }
  for (const question of ["hey how you doing", "How are you doing today?", "How about you?", "Thanks, that helped!", "My name is Alex", "I'm Alex", "Who are you?", "Good morning", "I'm good thanks"]) {
    const result = await ask(question, scope, { index: noCalculations })
    assert.deepEqual(result.cards, [], question)
    assert.equal(result.presentation, undefined)
    assert.deepEqual(result.context, scope)
    assert.doesNotMatch(result.answer, /₹|recorded expenses|spending breakdown|totalling/)
    assert.equal(result.cloud.status, "not_requested")
  }
  const social = await ask("How about you?", scope)
  const lastMonth = await ask("What about last month?", social.context)
  assert.equal(lastMonth.context.period.start, "2026-09-01")
  assert.equal(lastMonth.context.category, "Food & Dining")
  assert.equal(lastMonth.context.method, "upi")
  const higher = await ask("Why was it higher?", lastMonth.context)
  assert.equal(higher.cards.length, 1)
  assert.equal(higher.context.category, "Food & Dining")
  assert.equal(higher.context.period.start, "2026-09-01")
})

test("courtesies around a financial question do not turn it into small talk", async () => {
  for (const question of ["Hey, how much did I spend today?", "Show my expenses today, thanks!"]) {
    const result = await ask(question, null)
    assert.match(result.answer, /₹300.3/)
    assert.equal(result.context.period.start, "2026-10-24")
    assert.ok(result.presentation.blocks.some((block) => block.type === "metric"))
  }
  assert.notEqual(plan("I'm concerned about my subscriptions").route, "conversation")
})

test("guest casual replies stay brief and resume the same sample financial context", async () => {
  const initial = await answerDemoQuestion({ question: "Where did my money go?" })
  const social = await answerDemoQuestion({ question: "hey how you doing", context: initial.context })
  assert.deepEqual(social.context, initial.context)
  assert.deepEqual(social.cards, [])
  assert.equal(social.presentation, undefined)
  assert.doesNotMatch(social.answer, /₹|fictional finances|recorded/)
  const lastMonth = await answerDemoQuestion({ question: "What about last month?", context: social.context })
  assert.match(lastMonth.answer, /₹10,200/)
  assert.equal(lastMonth.context.scope.period.start, "2026-09-01")
})

test("financial summaries agree with singular records and income, and placeholder punctuation preserves decimals", async () => {
  const list = await ask("List food expenses last month", null)
  assert.match(list.answer, /^1 recorded expense for September/)
  const income = await ask("Compare income this month with last month", null)
  assert.match(income.answer, /^Recorded income was /)
  const facts = { statement: { value: "I found a recorded expense." }, amount: { value: "₹100.25" } }
  assert.equal(resolveAnswer("{{statement}}. The amount is {{amount}}.", facts), "I found a recorded expense. The amount is ₹100.25.")
  assert.equal(resolveAnswer("Is it {{amount}}?", facts), "Is it ₹100.25?")
})

test("reported biggest expenses and typo rank genuine expenses in the requested month", () => {
  const result = query("Show my biggest expenses")
  assert.equal(result.stats.largest[0].id, "largest")
  assert.ok(result.stats.largest.every((record) => record.type === "expense"))
  assert.ok(!result.answer.includes("8,000"))
  const previous = query("last month biggest ec[penses")
  assert.equal(previous.context.period.start, "2026-09-01")
  assert.equal(previous.stats.largest[0].id, "september")
  assert.match(previous.answer, /₹4,000/)
})

test("today total and every requested list wording use exactly October 24", () => {
  const total = query("today expenses")
  assert.equal(total.stats.expensePaise, 30030)
  assert.equal(total.context.intent, "expenses")
  for (const question of ["list today's all expenses", "Show today's expenses", "List everything I spent today", "What did I buy today?", "Give me all today’s transactions that were expenses"]) {
    const result = query(question)
    assert.equal(result.context.intent, "list", question)
    assert.equal(result.context.period.start, "2026-10-24", question)
    assert.equal(result.stats.expenses.length, 2, question)
    assert.equal((result.answer.match(/• /g) || []).length, 2, question)
    assert.match(result.answer, /₹100.1/)
    assert.match(result.answer, /₹200.2/)
    assert.ok(!result.answer.includes("3,000"))
  }
})

test("session context carries biggest → last month → contributors → reduce that without question replay", async () => {
  let result = await ask("Show my biggest expenses", null)
  result = await ask("What about last month?", result.context)
  assert.equal(result.context.intent, "largest")
  assert.equal(result.context.period.start, "2026-09-01")
  result = await ask("Which transactions contributed most?", result.context)
  assert.match(result.answer, /₹4,000/)
  assert.equal(result.context.period.start, "2026-09-01")
  result = await ask("How can I reduce that?", result.context)
  assert.equal(result.source, "local")
  assert.equal(result.cloud.status, "consent_required")
  assert.match(result.answer, /₹400 over this period/)
  assert.match(result.answer, /September/)
  assert.equal(result.context.selection.order, "amount_desc")
})

test("food → compare it → reduce it remains grounded in the same category", async () => {
  const food = await ask("Show my food spending", null)
  assert.equal(food.context.category, "Food & Dining")
  const compare = await ask("Compare it with last month", food.context)
  assert.equal(compare.cards[0].previousPaise, 400000)
  assert.equal(compare.cards[0].currentPaise, 24010)
  const reduce = await ask("How can I reduce it?", compare.context)
  assert.equal(reduce.context.category, "Food & Dining")
  assert.match(reduce.answer, /₹24.01/)
  assert.ok(!reduce.answer.includes("Shopping"))
})

test("last week uses Monday–Sunday and combines date, category and payment filters", () => {
  const result = query("Show all UPI expenses last week")
  assert.equal(result.context.intent, "list")
  assert.equal(result.context.period.start, "2026-10-12")
  assert.equal(result.context.period.end, "2026-10-19")
  assert.equal(result.stats.expensePaise, 3000)
  assert.deepEqual(result.stats.expenses.map((record) => record.id).sort(), ["lastMonday", "lastSunday"])
  const combined = query("List food expenses paid via UPI last week")
  assert.equal(combined.stats.expensePaise, 3000)
  assert.equal(combined.context.category, "Food & Dining")
  assert.match(combined.answer, /Monday–Sunday/)
  const possessive = query("How much did I spend last week’s food expenses?")
  assert.equal(possessive.context.period.start, "2026-10-12")
})

test("explicit new questions reset scope, explicit filters override continuations, null means New Chat", () => {
  const context = query("List food expenses paid via UPI last week").context
  const changed = query("What about cash this month?", context)
  assert.equal(changed.context.category, "Food & Dining")
  assert.equal(changed.context.method, "cash")
  assert.equal(changed.context.period.start, "2026-10-01")
  const unrelated = query("Show my biggest expenses", context)
  assert.equal(unrelated.context.category, null)
  assert.equal(unrelated.context.method, null)
  assert.equal(unrelated.context.period.start, "2026-10-01")
  const cleared = planFinancialQuestion("Compare it with last month", [{ role: "user", content: "Food spending last week" }], { ...options, context: null })
  assert.equal(cleared.route, "clarify")
  assert.equal(plan("Which transactions contributed most?", null).route, "clarify")
  const daily = query("today expenses").context
  const explicitComparison = plan("Compare it with last month", daily)
  assert.equal(explicitComparison.period.start, "2026-10-24")
  assert.equal(explicitComparison.comparison.start, "2026-09-01")
  assert.equal(explicitComparison.comparison.end, "2026-10-01")
  assert.equal(plan("Compare last month expenses").period.start, "2026-09-01")
})

test("ambiguous and unsupported requests clarify instead of dropping their meaning", async () => {
  for (const question of ["Show all transactions", "Expenses under ₹500", "Food expenses except groceries", "Show food and transport expenses", "Expenses in cash and UPI", "Expenses with note rent"]) {
    const result = await ask(question, null)
    assert.equal(result.source, "local")
    assert.equal(result.context, null)
    assert.ok(!result.answer.includes("You recorded"), question)
  }
  for (const question of ["What damage did my wallet take?", "Show my median expenses", "Show Alex expenses today"]) {
    const result = await ask(question, null)
    assert.equal(result.cloud.status, "consent_required")
    assert.equal(result.context, null)
    assert.ok(!result.answer.includes("You recorded"), question)
  }
  const unrelated = await ask("What about the weather?", query("Show food spending last month").context)
  assert.equal(unrelated.context, null)
  assert.ok(!unrelated.answer.includes("September"))
})

test("cloud routing returns distinct interpretation/explanation sources and reports failures honestly", async () => {
  let sent
  const result = await ask("What damage did my wallet take today?", null, { consent: true, requestCloud: async (value) => {
    sent = value
    return { answer: "Synthetic interpreted result", cards: [], source: "gemini_intent", cloud: { status: "used", stage: "interpretation" } }
  } })
  assert.equal(result.source, "gemini_intent")
  assert.deepEqual(Object.keys(sent).sort(), ["consent", "context", "messages", "signal", "timezone"])
  assert.ok(!JSON.stringify(sent).includes("today1"))
  await assert.rejects(() => ask("Why did spending increase?", null, { consent: true, requestCloud: async () => { throw new Error("Gemini key missing") } }), /key missing/)
})

test("expense-category Income remains an expense, and duplicates/source bookmarks do not count twice", () => {
  const genuine = tx("genuineExpense", 250, "2026-10-16", { category: "Income", person: "Bookmarked source" })
  const data = createFinancialIndex([...records, records[0], genuine, { type: "incomeSource", person: "Bookmarked source", amount: 8000 }], options)
  const result = analyseFinancialQuery(data, plan("Show my biggest expenses"))
  assert.ok(result.stats.largest.some((record) => record.id === "genuineExpense"))
  assert.ok(!result.stats.largest.some((record) => record.id === "income"))
  assert.match(result.answer, /Income \(expense category\)/)
  assert.equal(result.stats.incomePaise, 800000)
})

test("bounded lists disclose omitted entries while totals include all matches", () => {
  const data = createFinancialIndex(Array.from({ length: 55 }, (_, i) => tx(String(i), 1, "2026-10-24")), options)
  const result = analyseFinancialQuery(data, plan("List today's expenses"))
  assert.equal((result.answer.match(/• /g) || []).length, 50)
  assert.match(result.answer, /latest 50 of 55/)
  assert.equal(result.stats.expensePaise, 5500)
})

test("equivalent canonical month calculations reconcile with Dashboard/Analytics utilities", () => {
  const data = records.filter((record) => record.datetime.startsWith("2026-10"))
  const expenseStats = getMonthlyExpenseStats(data, "2026-10")
  const flow = getMonthlyCashFlow(data, "2026-10", 6)
  const answer = query("Income versus expenses this month")
  assert.equal(answer.stats.expensePaise, Math.round(expenseStats.totalExpenses * 100))
  assert.equal(answer.stats.incomePaise, Math.round(flow.totalIncome * 100))
  assert.equal(answer.stats.netPaise, Math.round(flow.netCashFlow * 100))
})

test("scope contracts reject injected identities, totals, unsafe dates and model queries", () => {
  const context = conversationContextFromPlan(plan("Show my biggest expenses"))
  assert.ok(JSON.stringify(context).length < 1000)
  assert.throws(() => validateConversationContext({ ...context, uid: "other" }, { asOf: "2026-10-24" }))
  assert.throws(() => validateConversationContext({ ...context, expensePaise: 999 }, { asOf: "2026-10-24" }))
  assert.throws(() => validateConversationContext({ ...context, period: { start: "2020-01-01", end: "2026-10-01" } }, { asOf: "2026-10-24" }))
  const output = { status: "resolved", intent: "list", start: "2026-10-24", end: "2026-10-25", comparisonStart: null, comparisonEnd: null, category: null, method: "upi", explain: false, reference: false }
  const safe = validateInterpretedIntent(output, options)
  assert.equal(safe.retrieval.start, "2026-10-24")
  for (const invalid of [{ query: "users/other" }, { intent: "delete" }, { start: "2026-02-30" }, { end: "2030-01-01" }, { method: "anySql" }, { reference: true }]) assert.throws(() => validateInterpretedIntent({ ...output, ...invalid }, options))
})
