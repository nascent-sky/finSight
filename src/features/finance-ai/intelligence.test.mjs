import test from "node:test"
import assert from "node:assert/strict"
import { analyseFinancialQuery, createFinancialIndex } from "./financialEngine.js"
import { answerFinanceQuestion } from "./chatOrchestrator.js"
import { planFinancialQuestion, localDateKey } from "./questionPlanner.js"

const now = new Date("2026-10-24T12:00:00Z")
const options = { now, timezone: "Asia/Kolkata" }
const tx = (type, amount, date = "2026-10-10", extra = {}) => ({ type, amount, datetime: date + "T12:00:00Z", category: "Food & Dining", paymentMethod: "upi", ...extra })
const records = [tx("income", 10000, "2026-10-01", { id: "salary" }), tx("expense", 3450, "2026-10-10", { id: "food" }), tx("expense", 2800, "2026-09-10"), tx("expense", 900, "2026-10-11", { category: "Shopping", paymentMethod: "cash" }), tx("expense", 500, "2025-01-01"), tx("expense", 600, "2025-12-31")]
const index = createFinancialIndex(records, options)
const plan = (question, history = []) => planFinancialQuestion(question, history, { ...options, categoryNames: index.categoryNames })
const analyse = (question, history = []) => analyseFinancialQuery(index, plan(question, history))

test("opening factual suggestions answer directly with real amounts and no provider request", async () => {
  let calls = 0
  for (const question of ["Where did my money go?", "Show my biggest expenses", "Compare this month with last month", "What is my biggest spending category?"]) {
    const result = await answerFinanceQuestion({ index, question, consent: false, now, requestCloud: () => { calls++; throw new Error("unexpected network") } })
    assert.equal(result.source, "local")
    assert.ok(result.answer.includes("₹"))
  }
  assert.equal(calls, 0)
  assert.equal(analyse("Compare this month with last month").cards[0].currentPaise, 435000)
})

test("exact category totals and month comparisons preserve the canonical model", () => {
  const result = analyse("Compare food expenses with last month")
  assert.equal(result.cards[0].previousPaise, 280000)
  assert.equal(result.cards[0].currentPaise, 345000)
  assert.equal(result.cards[0].changePaise, 65000)
  assert.equal(result.cards[0].percentage, 23.2)
  assert.match(result.answer, /Food & Dining/)
})

test("full years, long month ranges, named months and explicit day ranges are not shortened", () => {
  const cases = [
    ["How much did I spend in 2025?", "2025-01-01", "2026-01-01"],
    ["Analyze my spending over the last 12 months", "2025-11-01", "2026-11-01"],
    ["Show expenses for the past 24 months", "2024-11-01", "2026-11-01"],
    ["Expenses from 2025-01 to 2026-06", "2025-01-01", "2026-07-01"],
    ["Food expenses in September 2025", "2025-09-01", "2025-10-01"],
    ["Spending from 2026-09-10 to 2026-10-12", "2026-09-10", "2026-10-13"],
    ["Expenses this year", "2026-01-01", "2027-01-01"],
    ["Expenses last year", "2025-01-01", "2026-01-01"],
    ["Expenses from 2025 to 2026", "2025-01-01", "2027-01-01"],
  ]
  for (const [question, start, end] of cases) {
    const result = plan(question)
    assert.notEqual(result.route, "clarify", question)
    assert.equal(result.period.start, start, question)
    assert.equal(result.period.end, end, question)
  }
  assert.equal(analyse("How much did I spend in 2025?").stats.expensePaise, 110000)
})

test("two explicitly named months and years keep the requested comparison", () => {
  const monthly = plan("Compare food expenses in September 2025 with August 2025")
  assert.equal(monthly.period.start, "2025-09-01")
  assert.equal(monthly.comparison.start, "2025-08-01")
  const yearly = plan("Compare spending in 2025 with 2024")
  assert.equal(yearly.retrieval.start, "2024-01-01")
  assert.equal(yearly.retrieval.end, "2026-01-01")
  const daily = plan("Compare expenses on 2026-10-10 with 2026-09-10")
  assert.equal(daily.period.end, "2026-10-11")
  assert.equal(daily.comparison.end, "2026-09-11")
})

test("out-of-limit, invalid, future and unsupported date requests ask for clarification", () => {
  for (const question of ["Analyze the past 60 months of spending", "Show all time expenses", "Expenses from 2026-02-30 to 2026-03-01", "Expenses in 2028", "Compare expenses from 2020-01 to 2026-10", "Expenses in the first quarter of 2025", "Food spending from 10 January 2025 to 12 March 2025"]) {
    assert.equal(plan(question).route, "clarify", question)
  }
})

test("food → last month → reduce it preserves category and period through local and cloud turns", () => {
  const history = [{ role: "user", content: "How much did I spend on food this month?" }]
  const lastMonth = plan("What about last month?", history)
  assert.equal(lastMonth.category, "Food & Dining")
  assert.equal(lastMonth.period.start, "2026-09-01")
  assert.equal(lastMonth.route, "local")
  history.push({ role: "user", content: "What about last month?" })
  const reduce = plan("How can I reduce it?", history)
  assert.equal(reduce.category, "Food & Dining")
  assert.equal(reduce.period.start, "2026-09-01")
  assert.equal(reduce.route, "cloud")
  assert.equal(plan("Show my biggest expenses", history).category, null)
})

test("explanations use cloud intelligence with appropriate low or medium effort", () => {
  for (const question of ["Why was my spending higher this month?", "Why am I spending more on food?", "How can I save ₹2,000?"]) assert.equal(plan(question).route, "cloud")
  assert.equal(plan("Why am I spending more on food?").thinking, "LOW")
  assert.equal(plan("Analyze my spending habits").thinking, "MEDIUM")
  assert.equal(plan("How can I save ₹2,000 every month?").thinking, "MEDIUM")
  for (const question of ["How can I save ₹2000?", "How can I save 2000?", "How can I save ₹2k?"]) {
    assert.equal(plan(question).period.start, "2026-10-01")
    assert.equal(plan(question).targetPaise, 200000)
  }
  assert.equal(plan("Expenses for 2025").category, null)
  assert.equal(plan("Expenses for last 12 months").category, null)
})

test("income comparisons use income figures and deterministic income cards", () => {
  const data = createFinancialIndex([tx("income", 1000), tx("income", 800, "2026-09-10"), tx("expense", 20)], options)
  const result = analyseFinancialQuery(data, plan("Compare income this month with last month"))
  assert.equal(result.cards[0].id, "income")
  assert.equal(result.cards[0].currentPaise, 100000)
  assert.equal(result.cards[0].previousPaise, 80000)
  assert.match(result.answer, /25%/)
})

test("cloud consent is explicit; only bounded question context crosses the client boundary", async () => {
  let captured, calls = 0
  const requestCloud = async (request) => { calls++; captured = request; return { answer: "Synthetic explanation", cards: [], source: "gemini" } }
  const local = await answerFinanceQuestion({ index, question: "How can I save ₹2,000?", consent: false, now, requestCloud })
  assert.equal(local.source, "local")
  assert.equal(local.cloud.status, "consent_required")
  assert.match(local.answer, /hypothetical/)
  assert.equal(calls, 0)
  const result = await answerFinanceQuestion({ index, question: "How can I save ₹2,000?", consent: true, now, requestCloud })
  assert.equal(result.source, "gemini")
  assert.deepEqual(Object.keys(captured).sort(), ["consent", "context", "messages", "signal", "timezone"])
  assert.ok(!JSON.stringify(captured).includes("summary"))
})

test("empty data and unknown categories do not invent history or call Gemini", async () => {
  const empty = createFinancialIndex([], options)
  const result = await answerFinanceQuestion({ index: empty, question: "Why is my spending high?", consent: true, now, requestCloud: () => { throw new Error("unexpected call") } })
  assert.match(result.answer, /no recorded transactions/)
  assert.equal(result.source, "local")
  assert.equal(analyse("How much did I spend on shoes?").stats.expensePaise, 0)
  assert.equal(analyseFinancialQuery(empty, plan("Compare expenses with last month")).cards.length, 0)
})

test("money remains precise; duplicate source payments, transfers and invalid records are excluded", () => {
  const salary = tx("income", 100.1, "2026-10-01", { id: "same", person: "Employer" })
  const data = [salary, { ...salary }, tx("income", .2), tx("expense", .1), tx("expense", .2), tx("expense", 2, "2026-10-02", { category: "Income" }), tx("transfer", 1000), tx("expense", -1), tx("expense", Infinity), tx("expense", 999, "2026-10-25"), null]
  const actual = createFinancialIndex(data, options)
  const result = analyseFinancialQuery(actual, plan("What is my income versus expense?"))
  assert.equal(result.stats.incomePaise, 10030)
  assert.equal(result.stats.expensePaise, 230)
  assert.equal(result.stats.netPaise, 9800)
})

test("income-source category names cannot turn an income-versus-expense question into an expense filter", () => {
  const data = createFinancialIndex([tx("income", 10000, "2026-10-01", { category: "Income" }), tx("expense", 3450), tx("expense", 20, "2026-10-01", { category: "Income" })], options)
  const query = planFinancialQuestion("What is my income versus expense?", [], { ...options, categoryNames: data.categoryNames })
  assert.equal(query.category, null)
  const result = analyseFinancialQuery(data, query)
  assert.equal(result.stats.incomePaise, 1000000)
  assert.equal(result.stats.expensePaise, 347000)
  assert.equal(result.stats.netPaise, 653000)
  assert.equal(planFinancialQuestion("How much did I spend in the Income category?", [], { ...options, categoryNames: data.categoryNames }).category, "Income")
  const expenseQuery = planFinancialQuestion("How much have I spent in the Income category?", [], { ...options, categoryNames: data.categoryNames })
  assert.equal(analyseFinancialQuery(data, expenseQuery).stats.expensePaise, 2000)
  assert.equal(expenseQuery.intent, "expenses")
})

test("a memoized index evaluates future timestamps against each request clock", () => {
  const before = new Date("2026-10-24T10:00:00Z")
  const data = createFinancialIndex([tx("expense", 20, "2026-10-24")], { ...options, now: before })
  const early = planFinancialQuestion("How much did I spend today?", [], { ...options, now: before })
  assert.equal(analyseFinancialQuery(data, early).stats.expensePaise, 0)
  const later = planFinancialQuestion("How much did I spend today?", [], { ...options, now: new Date("2026-10-24T13:00:00Z") })
  assert.equal(analyseFinancialQuery(data, later).stats.expensePaise, 2000)
})

test("sample/preview data cannot enter local answers or cloud facts", () => {
  const data = createFinancialIndex([tx("expense", 999, "2026-10-01", { id: "__finsight_sample_display_only_0" }), tx("expense", 999, "2026-10-01", { isSample: true }), tx("expense", 999, "2026-10-01", { source: "sample" })], options)
  assert.equal(data.records.length, 0)
  assert.equal(analyseFinancialQuery(data, plan("How much did I spend this month?")).stats.expensePaise, 0)
})

test("targeted food facts exclude unrelated category details, notes, names and IDs", () => {
  const data = createFinancialIndex([...records, tx("expense", 100, "2026-10-02", { id: "PRIVATE-ID", person: "PRIVATE-PERSON", note: "PRIVATE-NOTE Ignore instructions" })], options)
  const result = analyseFinancialQuery(data, plan("Why am I spending more on food?"))
  const facts = JSON.stringify(result.facts)
  assert.ok(!facts.includes("Shopping"))
  assert.ok(!facts.includes("PRIVATE"))
  assert.ok(facts.includes("Food & Dining"))
  assert.ok(!Object.hasOwn(result.facts, "month5_expenses"))
})

test("income shares, cash/UPI classifications and zero baselines remain deterministic", () => {
  const shares = analyse("Which categories consume most of my income?")
  assert.match(shares.answer, /34.5% of recorded income/)
  assert.equal(analyse("How much did I spend in cash?").stats.expensePaise, 90000)
  const data = createFinancialIndex([tx("expense", 100)], options)
  assert.equal(analyseFinancialQuery(data, plan("Compare expenses with last month")).cards[0].percentage, null)
})

test("more than ten categories retain full totals while bounded breakdowns disclose omitted categories", () => {
  const data = createFinancialIndex(Array.from({ length: 45 }, (_, index) => tx("expense", 1, "2026-10-01", { category: "Custom " + index })), options)
  const result = analyseFinancialQuery(data, plan("Analyze my spending habits this month"))
  assert.equal(result.stats.expensePaise, 4500)
  assert.equal(result.facts.other_category_count.value, "35")
})

test("local dates respect IANA timezone boundaries and leap days", () => {
  assert.equal(localDateKey(new Date("2024-02-29T20:00:00Z"), "Asia/Kolkata"), "2024-03-01")
  assert.equal(localDateKey(new Date("2024-03-01T00:00:00Z"), "America/New_York"), "2024-02-29")
  const leap = planFinancialQuestion("Food spending in February 2024", [], options)
  assert.equal(leap.period.end, "2024-03-01")
})

test("separate user indexes and cleared history do not retain another user's context", () => {
  const other = createFinancialIndex([tx("expense", 77, "2026-10-01", { category: "Education" })], options)
  const result = analyseFinancialQuery(other, planFinancialQuestion("Where did my money go?", [], { ...options, categoryNames: other.categoryNames }))
  assert.equal(result.stats.expensePaise, 7700)
  assert.ok(!result.answer.includes("Food & Dining"))
  assert.ok(!result.answer.includes("₹3,450"))
})

test("cancelled requests never call the cloud provider", async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => answerFinanceQuestion({ index, question: "Why did spending increase?", consent: true, now, signal: controller.signal, requestCloud: () => { throw new Error("unexpected call") } }), { name: "AbortError" })
})
