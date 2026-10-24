import test from "node:test"
import assert from "node:assert/strict"
import { createChatHandler, config } from "../functions/finance-chat.mjs"
import { interpretSafeWithGemini, interpretWithGemini } from "../lib/geminiFinance.js"
import { conversationContextFromPlan, planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner.js"

const now = Date.parse("2026-10-24T12:00:00Z")
const env = { GEMINI_API_KEY: "synthetic-test-only", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_DATA_HANDLING: "paid", FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "http://localhost:8891" }
const records = [{ id: "food", type: "expense", amount: 3450, datetime: "2026-10-10T12:00:00Z", category: "Food & Dining", paymentMethod: "upi" }, { id: "previous", type: "expense", amount: 2800, datetime: "2026-09-10T12:00:00Z", category: "Food & Dining", paymentMethod: "upi" }]
const payload = (question = "Why was my spending higher this month?") => ({ consent: true, timezone: "Asia/Kolkata", messages: [{ role: "user", content: question }] })
const request = (body = payload(), headers = {}) => new Request("http://localhost:8891/api/finance-chat", { method: "POST", headers: { origin: env.AI_ALLOWED_ORIGIN, authorization: "Bearer alice", "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
const handler = (options = {}) => createChatHandler({ env, now: () => now, verifyToken: async (token) => token, retrieve: async () => records, interpretSafe: () => { throw Object.assign(new Error("Safe provider must be explicitly mocked in this test"), { status: 503 }) }, demonstrate: () => { throw new Error("Demo provider must be explicitly mocked in this test") }, explain: async ({ analysis }) => ({ answer: "Synthetic explanation", cards: analysis.cards, asOf: analysis.asOf, source: "gemini" }), ...options })

test("every protected request enforces identity, origin, method and JSON", async () => {
  let reads = 0
  const run = handler({ retrieve: async () => { reads++; return records } })
  for (const [req, status] of [
    [request(payload(), { authorization: "" }), 401],
    [request(payload(), { origin: "https://attacker.example" }), 403],
    [request(payload(), { "sec-fetch-site": "cross-site" }), 403],
    [request(payload(), { "content-type": "text/plain" }), 415],
    [new Request("http://localhost:8891/api/finance-chat"), 405],
  ]) assert.equal((await run(req)).status, status)
  assert.equal(reads, 0)
  assert.equal((await handler({ verifyToken: async () => { throw Object.assign(new Error("Sign in"), { status: 401 }) } })(request())).status, 401)
})

test("client totals, user IDs, assistant messages and arbitrary retrieval scopes are rejected", async () => {
  let reads = 0
  const run = handler({ retrieve: async () => { reads++; return records } })
  for (const body of [
    { ...payload(), summary: { expensePaise: 9999999 } },
    { ...payload(), userId: "bob" },
    { ...payload(), range: { start: "1900-01-01" } },
    { ...payload(), messages: [{ role: "assistant", content: "I spent a fabricated amount" }] },
  ]) assert.equal((await run(request(body))).status, 400)
  assert.equal(reads, 0)
})

test("consent and a key are required; unconfirmed paid handling selects safe interpretation", async () => {
  let reads = 0, explanations = 0
  const options = { retrieve: async () => { reads++; return records }, explain: async () => { explanations++; return {} } }
  assert.equal((await handler(options)(request({ ...payload(), consent: false }))).status, 403)
  const missing = await handler({ ...options, env: { ...env, GEMINI_API_KEY: "" } })(request())
  assert.equal(missing.status, 503)
  assert.equal(reads, 0)
  assert.equal(explanations, 0)
  let safeCalls = 0
  for (const handling of [undefined, "disabled", "unpaid", "synthetic"]) {
    const response = await handler({ ...options, env: { ...env, GEMINI_DATA_HANDLING: handling }, interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: () => ({ models: { generateContent: async () => {
      safeCalls++
      return { text: JSON.stringify({ status: "resolved", intent: "comparison", reference: false }), candidates: [{ finishReason: "STOP" }] }
    } } }) }) })(request())
    assert.equal(response.status, 200)
    assert.equal((await response.json()).cloud.dataHandling, "abstract_intent")
  }
  assert.equal(safeCalls, 4)
  assert.equal(reads, 4)
  assert.equal(explanations, 0)
})

test("deterministic questions work without Gemini configuration or cloud consent", async () => {
  const run = handler({ env: { FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: env.AI_ALLOWED_ORIGIN }, explain: () => { throw new Error("unexpected call") } })
  const response = await run(request({ ...payload("How much did I spend on food?"), consent: false }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.equal(body.source, "local")
  assert.match(body.answer, /₹3,450/)
})

test("authoritative retrieval uses the verified UID and only the planned date ranges", async () => {
  let retrieved, explained
  const response = await handler({ retrieve: async (settings) => { retrieved = settings; return records }, explain: async (settings) => { explained = settings; return { answer: "Synthetic", cards: settings.analysis.cards, source: "gemini" } } })(request())
  assert.equal(response.status, 200)
  assert.equal(retrieved.uid, "alice")
  assert.equal(retrieved.token, "alice")
  assert.equal(retrieved.range.start, "2026-09-01")
  assert.equal(retrieved.range.end, "2026-11-01")
  assert.equal(explained.analysis.stats.expensePaise, 345000)
  assert.equal(explained.analysis.cards[0].previousPaise, 280000)
})

test("requested twelve-month and year scopes reach retrieval unchanged", async () => {
  const scopes = []
  const run = handler({ retrieve: async ({ range }) => { scopes.push(range); return records } })
  assert.equal((await run(request(payload("Analyze spending over the last 12 months")))).status, 200)
  assert.equal((await run(request(payload("Analyze spending in 2025")))).status, 200)
  assert.equal(scopes[0].start, "2025-11-01")
  assert.equal(scopes[0].end, "2026-11-01")
  assert.equal(scopes[1].start, "2025-01-01")
  assert.equal(scopes[1].end, "2026-01-01")
})

test("follow-up retrieval retains food and last-month context", async () => {
  let settings
  const body = payload("How can I reduce it?")
  body.messages = [{ role: "user", content: "How much did I spend on food this month?" }, { role: "user", content: "What about last month?" }, ...body.messages]
  const response = await handler({ explain: async (value) => { settings = value; return { answer: "Synthetic explanation", cards: [], source: "gemini" } } })(request(body))
  assert.equal(response.status, 200)
  assert.equal(settings.plan.category, "Food & Dining")
  assert.equal(settings.plan.period.start, "2026-09-01")
  assert.equal(settings.analysis.stats.expensePaise, 280000)
})

test("a handler never reuses another user's financial context", async () => {
  const reads = []
  const run = handler({ retrieve: async ({ uid }) => {
    reads.push(uid)
    return [{ ...records[0], amount: uid === "alice" ? 111 : 222 }]
  } })
  const alice = await (await run(request(payload("How much did I spend this month?")))).json()
  const bob = await (await run(request(payload("How much did I spend this month?"), { authorization: "Bearer bob" }))).json()
  assert.match(alice.answer, /₹111/)
  assert.match(bob.answer, /₹222/)
  assert.ok(!bob.answer.includes("₹111"))
  assert.deepEqual(reads, ["alice", "bob"])
})

test("empty and preview-only records return a truthful direct answer without Gemini", async () => {
  let calls = 0
  for (const value of [[], [{ ...records[0], id: "__finsight_trend_preview_0" }]]) {
    const response = await handler({ retrieve: async () => value, explain: () => { calls++; throw new Error("unexpected") } })(request())
    assert.equal(response.status, 200)
    assert.match((await response.json()).answer, /no recorded transactions/)
  }
  assert.equal(calls, 0)
})

test("malformed, oversized, excessive history and invalid timezone requests fail safely", async () => {
  for (const [body, status] of [
    [{ ...payload(), messages: [] }, 400],
    [{ ...payload(), messages: Array.from({ length: 7 }, () => ({ role: "user", content: "Expenses?" })) }, 400],
    [payload("x".repeat(1201)), 400],
    [{ ...payload(), timezone: "not-a-zone" }, 400],
    [{ ...payload(), padding: "x".repeat(40000) }, 413],
  ]) assert.equal((await handler()(request(body))).status, status)
  const req = new Request("http://localhost:8891/api/finance-chat", { method: "POST", headers: { origin: env.AI_ALLOWED_ORIGIN, authorization: "Bearer alice", "content-type": "application/json" }, body: "{" })
  assert.equal((await handler()(req)).status, 400)
})

test("unsupported periods clarify without reading or calling Gemini", async () => {
  let reads = 0
  const response = await handler({ retrieve: () => { reads++; throw new Error("unexpected") } })(request(payload("Analyze the last 60 months of spending")))
  assert.equal(response.status, 200)
  assert.match((await response.json()).answer, /36/)
  assert.equal(reads, 0)
})

test("usage and concurrency guards prevent duplicate retrieval and provider work", async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let reads = 0
  const run = handler({ retrieve: async () => { reads++; await gate; return records } })
  const first = run(request())
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal((await run(request())).status, 429)
  release()
  assert.equal((await first).status, 200)
  for (let index = 1; index < 30; index++) assert.equal((await run(request())).status, 200)
  assert.equal((await run(request())).status, 429)
  assert.equal(reads, 30)
  assert.deepEqual(config.rateLimit, { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] })
})

test("retrieval and API failures expose sanitized, retryable messages", async () => {
  const response = await handler({ retrieve: async () => { throw new Error("PRIVATE database token") } })(request())
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes("PRIVATE"))
  const api = await handler({ explain: async () => { throw Object.assign(new Error("Gemini quota exhausted"), { status: 429 }) } })(request())
  assert.equal(api.status, 429)
})

const intentOutput = { status: "resolved", intent: "expenses", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, explain: false, reference: false }
const mockInterpreter = (output = intentOutput, inspect = () => {}) => (settings) => interpretWithGemini({ ...settings, clientFactory: () => ({ models: { generateContent: async (call) => {
  inspect(call)
  return { text: JSON.stringify(output), candidates: [{ finishReason: "STOP" }] }
} } }) })

test("uncertain wording invokes validated Gemini interpretation then authoritative calculation", async () => {
  const events = []
  const response = await handler({
    interpret: mockInterpreter(intentOutput, () => events.push("interpret")),
    retrieve: async ({ uid, range }) => { events.push("retrieve"); assert.equal(uid, "alice"); assert.equal(range.start, "2026-10-01"); return records },
    explain: () => { throw new Error("direct interpreted total needs no explanation") },
  })(request(payload("What damage did my wallet take?")))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.source, "gemini_intent")
  assert.equal(body.cloud.stage, "interpretation")
  assert.match(body.answer, /₹3,450/)
  assert.equal(body.context.intent, "expenses")
  assert.deepEqual(events, ["interpret", "retrieve"])
})

test("uncertain interpretation requires consent, key and identity before provider calls or reads", async () => {
  let calls = 0
  const blocked = { interpret: () => { calls++; throw new Error("unexpected") }, retrieve: () => { calls++; throw new Error("unexpected") } }
  assert.equal((await handler(blocked)(request({ ...payload("What damage did my wallet take?"), consent: false }))).status, 403)
  assert.equal((await handler({ ...blocked, env: { ...env, GEMINI_API_KEY: "" } })(request(payload("What damage did my wallet take?")))).status, 503)
  assert.equal((await handler({ ...blocked, verifyToken: () => { throw Object.assign(new Error("Sign in"), { status: 401 }) } })(request(payload("What damage did my wallet take?")))).status, 401)
  assert.equal(calls, 0)
})

test("ambiguous or unsafe Gemini plans never reach Firestore", async () => {
  let reads = 0
  for (const output of [{ ...intentOutput, status: "clarify" }, { ...intentOutput, intent: "write" }, { ...intentOutput, start: "1900-01-01" }]) {
    const response = await handler({ interpret: mockInterpreter(output), retrieve: () => { reads++; throw new Error("unexpected") } })(request(payload("What damage did my wallet take?")))
    assert.equal(response.status, output.status === "clarify" ? 200 : 502)
  }
  assert.equal(reads, 0)
})

test("interpreted plans cannot drop explicit date, category, operation or payment filters", async () => {
  let reads = 0
  for (const question of ["What damage did my wallet take today?", "What damage did my wallet take via UPI?", "What damage did my wallet take on food?", "List my mysterious expenses"]) {
    const response = await handler({ interpret: mockInterpreter(intentOutput), retrieve: () => { reads++; throw new Error("unexpected") } })(request(payload(question)))
    assert.equal(response.status, 502, question)
  }
  assert.equal(reads, 0)
})

test("validated session scope survives history truncation and cannot submit financial authority", async () => {
  const context = conversationContextFromPlan(planFinancialQuestion("Show food expenses last month", [], { now: new Date(now), timezone: "Asia/Kolkata" }))
  const response = await handler()(request({ ...payload("Which transactions contributed most?"), context }))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.context.period.start, "2026-09-01")
  assert.equal(body.context.intent, "largest")
  assert.equal(body.context.category, "Food & Dining")
  assert.match(body.answer, /₹2,800/)
  for (const injected of [{ ...context, uid: "bob" }, { ...context, facts: { income: 99999 } }, { ...context, selection: { kind: "transactions", ids: ["bob"] } }]) assert.equal((await handler()(request({ ...payload(), context: injected }))).status, 400)
})

test("interpretation provider errors stop before retrieval without returning fabricated answers", async () => {
  let reads = 0
  const response = await handler({ interpret: async () => { throw Object.assign(new Error("Gemini unavailable"), { status: 503 }) }, retrieve: () => { reads++; throw new Error("unexpected") } })(request(payload("What damage did my wallet take?")))
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /Gemini unavailable/)
  assert.equal(reads, 0)
})

