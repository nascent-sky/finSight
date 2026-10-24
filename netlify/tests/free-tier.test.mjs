import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { explainSyntheticWithGemini, explainWithGemini, interpretSafeWithGemini, interpretWithGemini } from "../lib/geminiFinance.js"
import { analyseFinancialQuery, createFinancialIndex } from "../../src/features/finance-ai/financialEngine.js"
import { conversationContextFromPlan, planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner.js"
import { buildSafeIntentInput } from "../lib/safeFinancialIntent.js"

const now = new Date("2026-10-24T12:00:00Z")
const options = { now, timezone: "Asia/Kolkata" }
const env = { GEMINI_API_KEY: "fake-free-key", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_DATA_HANDLING: "disabled", FIREBASE_PROJECT_ID: "fake-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const privateRecords = [{ id: "PRIVATE-ID", type: "expense", amount: 18765.43, datetime: "2026-10-24T10:00:00Z", category: "Healthcare", paymentMethod: "upi", person: "PRIVATE-PERSON", note: "PRIVATE-NOTE" }, { id: "PRIVATE-SALARY", type: "income", amount: 98987.65, datetime: "2026-10-01T10:00:00Z", category: "Income", paymentMethod: "cash" }]
const personal = (question = "How can I save ₹2,000 this month?") => ({ consent: true, timezone: options.timezone, messages: [{ role: "user", content: question }] })
const demo = (questionId = "compare_food", history = []) => ({ mode: "synthetic", consent: true, questionId, history })
const request = (body, headers = {}) => new Request("https://finsight.example/api/finance-chat", { method: "POST", headers: { origin: env.AI_ALLOWED_ORIGIN, authorization: "Bearer PRIVATE-IDENTITY", "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
const intent = (selected = "expenses", reference = false) => ({ status: "resolved", intent: selected, reference })
const textResponse = { answer: "In this fictional example, food spending was {{current_expenses}}, compared with {{previous_expenses}}.", cardIds: ["expenses"] }
function mockSDK(output, inspect = () => {}) {
  return (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (url, init) => {
    const sent = JSON.parse(init.body)
    inspect(sent, url)
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(output) }] } }] })
  } } })
}
const handler = (overrides = {}) => createChatHandler({ env, now: () => now.getTime(), verifyToken: async () => "PRIVATE-IDENTITY", retrieve: async () => privateRecords,
  interpretSafe: () => { throw new Error("Safe SDK must be mocked") }, explain: () => { throw new Error("Private explanations must not run on the free path") }, demonstrate: () => { throw new Error("Demo SDK must be mocked") }, ...overrides })

test("free-tier SDK interpretation receives only abstract enums; all real scope and history stay in FinSight", async () => {
  let sent, calls = 0
  const body = personal()
  body.messages.unshift({ role: "user", content: "My private account identifier is PRIVATE-ACCOUNT and my salary is 98987.65" })
  const response = await handler({ interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: mockSDK(intent(), (value, url) => {
    sent = value; calls++
    assert.match(String(url), /gemini-3\.8-flash:generateContent/)
  }) }) })(request(body))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.source, "gemini_intent")
  assert.equal(result.cloud.dataHandling, "abstract_intent")
  assert.match(result.answer, /18,765.43/)
  assert.equal(result.context.targetPaise, 200000)
  assert.equal(calls, 1)
  const context = JSON.parse(sent.contents[0].parts[0].text)
  assert.deepEqual(Object.keys(context).sort(), ["continuation", "kind", "metric", "operators", "previousIntent"])
  assert.deepEqual(context.operators, ["reduce", "explain"])
  for (const privateValue of ["PRIVATE", "2000", "2,000", "18765", "18,765", "98987", "Healthcare", "2026-10", "Kolkata", "upi"]) assert.ok(!JSON.stringify(context).includes(privateValue), privateValue)
  assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, "LOW")
  assert.equal(sent.generationConfig.responseMimeType, "application/json")
  assert.deepEqual(sent.generationConfig.responseJsonSchema.required, ["status", "intent", "reference"])
})

test("safe uncertain wording reaches Gemini and retains exact local date and payment filters", async () => {
  let scope
  const result = await (await handler({ retrieve: async ({ range }) => { scope = range; return privateRecords }, interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: mockSDK(intent()) }) })(request(personal("What damage did my wallet take today via UPI?")))).json()
  assert.equal(result.source, "gemini_intent")
  assert.equal(result.context.method, "upi")
  assert.equal(scope.start, "2026-10-24")
  assert.equal(scope.end, "2026-10-25")
  assert.match(result.answer, /18,765.43/)
})

test("free follow-ups use abstract previous intent without exporting category, period or financial values", async () => {
  const context = conversationContextFromPlan(planFinancialQuestion("Food spending last month", [], options))
  let sent, retrieved
  const result = await (await handler({ retrieve: async ({ range }) => { retrieved = range; return [{ ...privateRecords[0], category: "Food & Dining", amount: 2800, datetime: "2026-09-15T12:00:00Z" }] }, interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: mockSDK(intent("expenses", true), (call) => { sent = JSON.parse(call.contents[0].parts[0].text) }) }) })(request({ ...personal("How can I reduce it?"), context }))).json()
  assert.equal(result.context.category, "Food & Dining")
  assert.equal(retrieved.start, "2026-09-01")
  assert.match(result.answer, /₹280 over this period/)
  assert.equal(sent.previousIntent, "expenses")
  assert.equal(sent.continuation, true)
  for (const value of ["Food", "2026", "2800", "September"]) assert.ok(!JSON.stringify(sent).includes(value))
})

test("unrecognised private wording and unsupported semantics fail closed before any free-tier SDK call", async () => {
  let calls = 0, reads = 0
  const run = handler({ retrieve: () => { reads++; throw new Error("unexpected") }, interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: () => { calls++; throw new Error("unexpected") } }) })
  for (const question of ["Show Alex expenses today", "My bank account is 123456789 and email is private@example.com", "Show my median expenses"]) {
    const response = await run(request(personal(question)))
    assert.equal(response.status, 422)
    const error = await response.json()
    assert.equal(error.origin, "privacy")
    assert.equal(error.code, "SAFE_INTENT_NEEDS_CLARIFICATION")
    assert.ok(!JSON.stringify(error).includes("123456789"))
  }
  assert.equal(calls, 0)
  assert.equal(reads, 0)
})

test("personal adapter calls cannot bypass the paid gate by declaring real facts synthetic or safe", async () => {
  let calls = 0
  const plan = planFinancialQuestion("Why was spending higher this month?", [], options)
  const analysis = analyseFinancialQuery(createFinancialIndex(privateRecords, options), plan)
  const clientFactory = () => { calls++; throw new Error("unexpected") }
  for (const override of [{}, { privateContext: false }, { synthetic: true }, { dataHandling: "synthetic" }]) {
    await assert.rejects(() => explainWithGemini({ env, plan, analysis, questions: ["PRIVATE question"], clientFactory, ...override }), (error) => error.code === "GEMINI_PRIVATE_CONTEXT_DISABLED" && error.origin === "privacy")
  }
  await assert.rejects(() => interpretWithGemini({ env, ...options, questions: ["PRIVATE question"], clientFactory }), { code: "GEMINI_PRIVATE_CONTEXT_DISABLED" })
  assert.equal(calls, 0)
})

test("synthetic demo uses the official SDK and fixed fictional data without any financial retrieval", async () => {
  let reads = 0, sent, calls = 0
  const response = await handler({ retrieve: () => { reads++; throw new Error("unexpected private read") }, demonstrate: (settings) => explainSyntheticWithGemini({ ...settings, clientFactory: mockSDK(textResponse, (value, url) => { sent = value; calls++; assert.match(String(url), /gemini-3\.8-flash:generateContent/) }) }) })(request(demo()))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.source, "gemini_demo")
  assert.equal(result.mode, "synthetic")
  assert.equal(result.cloud.stage, "synthetic")
  assert.match(result.answer, /Synthetic demonstration/)
  assert.match(result.answer, /₹3,450/)
  assert.match(result.answer, /₹2,800/)
  assert.match(result.cards[0].title, /Synthetic demo/)
  assert.equal(reads, 0)
  assert.equal(calls, 1)
  assert.ok(!JSON.stringify(sent).includes("PRIVATE"))
  assert.deepEqual(result.demoHistory, ["compare_food"])
})

test("synthetic conversation history consists only of fixed question IDs and preserves follow-up scope", async () => {
  let scope
  const history = ["compare_food", "last_month", ...Array(10).fill("reduce")]
  const response = await handler({ demonstrate: (settings) => explainSyntheticWithGemini({ ...settings, clientFactory: mockSDK({ answer: "The fictional category total is {{current_expenses}} for {{period}}.", cardIds: [] }, (value) => { scope = JSON.parse(value.contents[0].parts[0].text).scope }) }) })(request(demo("reduce", history)))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(scope.category, "Food & Dining")
  assert.equal(scope.period.start, "2026-09-01")
  assert.match(body.answer, /₹2,800/)
  assert.deepEqual(body.demoHistory, [...history, "reduce"])
})

test("synthetic mode rejects client records, free text, private context and fake synthetic flags", async () => {
  let calls = 0
  const run = handler({ demonstrate: (settings) => explainSyntheticWithGemini({ ...settings, clientFactory: () => { calls++; throw new Error("unexpected") } }) })
  for (const body of [{ ...demo(), records: privateRecords }, { ...demo(), messages: personal().messages }, { ...demo(), context: {} }, { ...demo(), synthetic: true }, demo("PRIVATE-NOTE"), demo("compare_food", ["PRIVATE-QUESTION"]), demo("compare_food", {}), { ...personal(), synthetic: true }]) {
    const response = await run(request(body))
    assert.equal(response.status, 400)
  }
  assert.equal(calls, 0)
})

test("configuration and provider failures are distinguishable and never expose raw provider details", async () => {
  const missing = await handler({ env: { ...env, GEMINI_API_KEY: "" } })(request(personal()))
  assert.equal(missing.status, 503)
  assert.deepEqual(((body) => [body.origin, body.code])(await missing.json()), ["configuration", "GEMINI_KEY_MISSING"])
  for (const [status, code, responseStatus] of [[429, "GEMINI_RATE_LIMITED", 429], [403, "GEMINI_AUTH_FAILED", 503], [404, "GEMINI_MODEL_UNAVAILABLE", 503], [400, "GEMINI_REQUEST_REJECTED", 502], [500, "GEMINI_PROVIDER_FAILED", 503]]) {
    const response = await handler({ interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: () => ({ models: { generateContent: async () => { throw Object.assign(new Error("PRIVATE provider details"), { status }) } } }) }) })(request(personal()))
    const body = await response.json()
    assert.equal(response.status, responseStatus)
    assert.equal(body.origin, "provider")
    assert.equal(body.code, code)
    assert.equal(body.providerStatus, status)
    assert.ok(!body.error.includes("PRIVATE"))
  }
})

test("free-tier output cannot invent dates, financial values or unsupported operations", async () => {
  let reads = 0
  for (const output of [{ ...intent(), amount: 999 }, { ...intent(), start: "1900-01-01" }, intent("delete"), { ...intent(), reference: true }]) {
    const response = await handler({ retrieve: () => { reads++; throw new Error("unexpected") }, interpretSafe: (settings) => interpretSafeWithGemini({ ...settings, clientFactory: mockSDK(output) }) })(request(personal()))
    assert.equal(response.status, 502)
    assert.equal((await response.json()).origin, "provider")
  }
  assert.equal(reads, 0)
  const response = await handler({ demonstrate: (settings) => explainSyntheticWithGemini({ ...settings, clientFactory: mockSDK({ answer: "You spent ₹999.", cardIds: [] }) }) })(request(demo()))
  assert.equal(response.status, 502)
  assert.equal((await response.json()).code, "GEMINI_OUTPUT_INVALID")
})

test("local financial answers still work with no key, consent or provider call", async () => {
  const response = await handler({ env: { ...env, GEMINI_API_KEY: "" } })(request({ ...personal("today expenses"), consent: false }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.source, "local")
  assert.match(result.answer, /18,765.43/)
  assert.equal(result.cloud.status, "not_requested")
})

test("synthetic calls preserve authentication, origin checks, consent and shared account limits", async () => {
  const run = handler({ demonstrate: (settings) => explainSyntheticWithGemini({ ...settings, clientFactory: mockSDK(textResponse) }) })
  assert.equal((await run(request(demo(), { authorization: "" }))).status, 401)
  assert.equal((await run(request(demo(), { origin: "https://other.example" }))).status, 403)
  assert.equal((await run(request({ ...demo(), consent: false }))).status, 403)
  assert.equal((await handler({ verifyToken: () => { throw Object.assign(new Error("Anonymous account not allowed"), { status: 401 }) } })(request(demo()))).status, 401)
  // Local backend requests and synthetic requests use the same per-UID guard.
  for (let i = 0; i < 29; i++) assert.equal((await run(request({ ...personal("today expenses"), consent: false }))).status, 200)
  assert.equal((await run(request(demo()))).status, 200)
  const limited = await run(request(demo()))
  assert.equal(limited.status, 429)
  const body = await limited.json()
  assert.equal(body.code, "AI_RATE_LIMITED")
  assert.equal(body.origin, "application")
})

test("safe projection contains only generic operator semantics even for private labels and amounts", () => {
  const result = buildSafeIntentInput("How can I reduce it?", { context: { intent: "expenses", category: "PRIVATE-MEDICAL", targetPaise: 12345678, period: { start: "2001-01-01" } } })
  assert.ok(!JSON.stringify(result).includes("PRIVATE"))
  assert.ok(!JSON.stringify(result).includes("12345678"))
  assert.ok(!JSON.stringify(result).includes("2001"))
  assert.equal(result.previousIntent, "expenses")
})
