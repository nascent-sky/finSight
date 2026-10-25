import test from "node:test"
import assert from "node:assert/strict"
import { financeSessionIdentity, createAccountRecordSubscription, financePrivacyMessage } from "./financeSession.js"
import { AI_DEMO_RECORDS, DEMO_AS_OF, answerDemoQuestion, createDemoFinancialIndex } from "./demoAnalysis.js"
import { createFinancialIndex, analyseFinancialQuery } from "./financialEngine.js"
import { planFinancialQuestion } from "./questionPlanner.js"
import { financeSourceLabel } from "./financeRouting.js"
import { createFinanceChatClient } from "../../services/financeChatClient.js"

test("auth readiness, regular accounts, signed-out and anonymous guest identities select isolated session keys", () => {
  const alice = { uid: "alice" }, bob = { uid: "bob" }
  assert.equal(financeSessionIdentity({ user: alice }).mode, "loading")
  assert.equal(financeSessionIdentity({ user: alice, isAuthReady: false }).key, "auth-loading")
  assert.equal(financeSessionIdentity({ user: null, isAuthReady: true }).mode, "demo")
  assert.equal(financeSessionIdentity({ user: { uid: "guest", isAnonymous: true }, isAuthReady: true }).mode, "demo")
  const a = financeSessionIdentity({ user: alice, isAuthReady: true })
  assert.equal(a.mode, "personal")
  assert.notEqual(a.key, financeSessionIdentity({ user: bob, isAuthReady: true }).key)
  assert.notEqual(a.key, financeSessionIdentity({ user: { ...alice, isAnonymous: true }, isAuthReady: true }).key)
})

test("account subscriptions reject anonymous/signed-out/mismatched identities and discard callbacks after logout or unsubscribe", () => {
  const alice = { uid: "alice" }, bob = { uid: "bob" }
  let current = alice, queries = 0, unsubscribed = 0, publish
  const received = [], errors = []
  const subscribe = createAccountRecordSubscription({ getCurrentUser: () => current, subscribeRecords: (callback) => { queries++; publish = callback; return () => { unsubscribed++ } } })
  for (const user of [null, { uid: "guest", isAnonymous: true }, bob]) subscribe((records) => received.push(records), (error) => errors.push(error), { user })
  assert.equal(queries, 0)
  assert.equal(errors.length, 3)
  const stop = subscribe((records, meta) => received.push({ records, meta }), () => {}, { user: alice })
  publish([{ amount: 11 }], { isReady: true })
  assert.equal(received[0].meta.ownerUid, "alice")
  current = bob
  publish([{ amount: 999 }])
  current = null
  publish([{ amount: 888 }])
  current = alice
  stop()
  publish([{ amount: 777 }])
  assert.equal(received.length, 1)
  assert.equal(unsubscribed, 1)
})

test("AI sample data is immutable and excluded from ordinary financial totals and reports", () => {
  const options = { now: new Date(DEMO_AS_OF), timezone: "UTC" }
  const real = { id: "real-only", type: "expense", amount: 123.45, category: "Other", paymentMethod: "cash", datetime: "2026-10-02T10:00:00Z" }
  const before = JSON.stringify(AI_DEMO_RECORDS)
  const index = createFinancialIndex([real, ...AI_DEMO_RECORDS], options)
  assert.equal(index.records.length, 1)
  const plan = planFinancialQuestion("Total expenses this month", [], options)
  assert.equal(analyseFinancialQuery(index, plan).stats.expensePaise, 12345)
  assert.throws(() => { AI_DEMO_RECORDS[0].amount = 999 })
  assert.ok(createDemoFinancialIndex().records.length > 10)
  assert.equal(JSON.stringify(AI_DEMO_RECORDS), before)
  assert.deepEqual([...new Set(AI_DEMO_RECORDS.map((row) => row.datetime.slice(0, 7)))], ["2026-08", "2026-09", "2026-10"])
})

test("demo analysis retains financial scope across summaries, comparisons, recommendations and free-form questions", async () => {
  const overview = await answerDemoQuestion({ question: "Where did my money go?" })
  assert.equal(overview.source, "demo_local")
  assert.match(overview.answer, /₹11,700/)
  assert.equal(overview.cloud.status, "not_requested")
  const prior = await answerDemoQuestion({ question: "What about last month?", context: overview.context })
  assert.match(prior.answer, /₹10,200/)
  const advice = await answerDemoQuestion({ question: "How can I reduce it?", context: prior.context })
  assert.match(advice.answer, /September 2026.*₹10,200/)
  assert.match(advice.answer, /hypothetical.*reduction/)
  assert.match(advice.answer, /not guaranteed savings/)
  const compare = await answerDemoQuestion({ question: "Compare food expenses this month with last month" })
  assert.equal(compare.cards[0].previousPaise, 280000)
  assert.equal(compare.cards[0].currentPaise, 345000)
  assert.equal(compare.cards[0].changePaise, 65000)
  assert.match(compare.cards[0].title, /^Sample/)
  assert.match(compare.cards[0].note, /Fictional/)
  assert.equal(financeSourceLabel(overview.source), "Demo · Local sample analysis")
  const target = await answerDemoQuestion({ question: "How can I save ₹2,000?" })
  assert.match(target.answer, /₹2,000/)
  assert.match((await answerDemoQuestion({ question: "Income this month" })).answer, /₹32,000/)
})

test("demo rejects account scope, never consumes external records and respects cancellation", async () => {
  await assert.rejects(() => answerDemoQuestion({ question: "Total?", context: { version: 1, period: { start: "2026-10-01" } } }), /reset.*scope/)
  const fake = [{ amount: 9999999 }]
  const result = await answerDemoQuestion({ question: "Where did my money go?", records: fake, uid: "alice", context: null })
  assert.match(result.answer, /₹11,700/)
  assert.ok(!result.answer.includes("99,99,999"))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => answerDemoQuestion({ question: "Total?", signal: controller.signal }), { name: "AbortError" })
})

test("ordinary account notices explain local analysis without exposing development diagnostics", () => {
  const policy = { mode: "protected", cloudConfigured: true, reasons: [{ code: "TEST_UID_NOT_ALLOWLISTED", message: "GEMINI_DEVELOPMENT_UIDS test UID is not allowlisted" }] }
  assert.match(financePrivacyMessage(policy, true), /Local analysis remains available/)
  assert.doesNotMatch(financePrivacyMessage(policy, true), /GEMINI_|UID|allowlist|development/i)
  assert.match(financePrivacyMessage({ error: "PRIVATE-configuration" }, true), /Local financial analysis/)
})

test("a late authenticated cloud response cannot be delivered after logout or an account change", async () => {
  for (const replacement of [null, { uid: "bob" }, { uid: "alice", isAnonymous: true }]) {
    const alice = { uid: "alice", getIdToken: async () => "token" }
    let current = alice, finish
    const waiting = new Promise((resolve) => { finish = resolve })
    const client = createFinanceChatClient({ getCurrentUser: () => current, online: () => true, fetcher: () => waiting })
    const pending = client.requestChat({ user: alice, consent: true, messages: [{ role: "user", content: "Total?" }], timezone: "UTC" })
    await Promise.resolve()
    current = replacement
    finish(Response.json({ source: "gemini", answer: "PRIVATE-alice-result", cards: [] }))
    await assert.rejects(() => pending, /account changed/)
  }
})
