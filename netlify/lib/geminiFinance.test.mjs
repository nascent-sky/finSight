import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { explainWithGemini, interpretWithGemini, requireGeminiConfiguration } from "./geminiFinance.js"
import { createFinancialIndex, analyseFinancialQuery } from "../../src/features/finance-ai/financialEngine.js"
import { planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner.js"

const env = { GEMINI_API_KEY: "synthetic-not-a-real-key", GEMINI_DATA_HANDLING: "paid" }
const now = new Date("2026-10-24T12:00:00Z")
const options = { now, timezone: "Asia/Kolkata" }
const records = [{ id: "PRIVATE-ID", person: "PRIVATE-PERSON", note: "PRIVATE-NOTE", type: "expense", amount: 3450, datetime: "2026-10-10T00:00:00Z", category: "Food & Dining", paymentMethod: "upi" }]
const index = createFinancialIndex(records, options)
const settings = (question = "Why am I spending more on food?") => {
  const plan = planFinancialQuestion(question, [], options)
  return { env, plan, analysis: analyseFinancialQuery(index, plan), questions: [question], signal: new AbortController().signal }
}
const response = (answer = "You recorded {{current_expenses}} on food.", cardIds = []) => ({ text: JSON.stringify({ answer, cardIds }), candidates: [{ finishReason: "STOP" }] })

test("official SDK serializes exact model, LOW thinking and structured output with a fully mocked transport", async () => {
  let sent, requests = 0
  const result = await explainWithGemini({ ...settings(), clientFactory: (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (url, init) => {
    requests++
    assert.match(String(url), /gemini-3\.1-flash-lite:generateContent/)
    sent = JSON.parse(init.body)
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify({ answer: "You recorded {{current_expenses}} on food.", cardIds: ["expenses"] }) }] } }] })
  } } }) })
  assert.equal(requests, 1)
  assert.equal(result.answer, "You recorded ₹3,450 on food.")
  assert.equal(result.source, "gemini")
  assert.equal(result.cards[0].currentPaise, 345000)
  assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, "LOW")
  assert.equal(sent.generationConfig.responseMimeType, "application/json")
  assert.deepEqual(sent.generationConfig.responseJsonSchema.required, ["answer"])
  assert.equal(sent.generationConfig.responseJsonSchema.properties.blockIds.items.type, "string")
  assert.equal(Object.hasOwn(sent.generationConfig.responseJsonSchema, "anyOf"), false)
  for (const field of ["temperature", "topP", "topK", "candidateCount"]) assert.ok(!Object.hasOwn(sent.generationConfig, field))
  assert.equal(sent.contents.length, 1)
  assert.equal(sent.contents[0].role, "user")
  assert.ok(!JSON.stringify(sent).includes("PRIVATE"))
  assert.ok(!JSON.stringify(sent).includes(env.GEMINI_API_KEY))
})

test("complex budgeting explanations select MEDIUM effort without changing the configured model", async () => {
  let call, config
  const result = await explainWithGemini({ ...settings("Analyze my spending habits this month"), env: { ...env, GEMINI_MODEL: "gemini-3.8-flash" }, clientFactory: (value) => {
    config = value
    return { models: { generateContent: async (value) => { call = value; return response() } } }
  } })
  assert.equal(result.source, "gemini")
  assert.equal(call.config.thinkingConfig.thinkingLevel, "MEDIUM")
  assert.equal(call.model, "gemini-3.8-flash")
  assert.equal(config.httpOptions.timeout, 32000)
  assert.equal(config.httpOptions.retryOptions.attempts, 1)
})

test("unpaid or unconfirmed handling prevents private financial SDK calls", async () => {
  assert.throws(() => requireGeminiConfiguration({ GEMINI_API_KEY: "test" }), /paid-service/)
  assert.throws(() => requireGeminiConfiguration({ GEMINI_DATA_HANDLING: "paid" }), /GEMINI_API_KEY/)
  await assert.rejects(() => explainWithGemini({ ...settings(), env: { ...env, GEMINI_DATA_HANDLING: "disabled" }, clientFactory: () => { throw new Error("unexpected provider call") } }), /paid-service/)
})

test("unsupported model errors identify the exact configured model and never fall back", async () => {
  const models = []
  const run = explainWithGemini({ ...settings(), env: { ...env, GEMINI_MODEL: "gemini-3.8-flash" }, clientFactory: () => ({ models: { generateContent: async (value) => { models.push(value.model); throw Object.assign(new Error("PRIVATE unavailable model"), { status: 404 }) } } }) })
  await assert.rejects(() => run, (error) => error.status === 503 && /gemini-3.8-flash/.test(error.message) && !/PRIVATE/.test(error.message))
  assert.deepEqual(models, ["gemini-3.8-flash"])
})

test("raw numeric hallucinations, unknown facts, invalid JSON and unfinished output fail closed", async () => {
  for (const output of [response("You spent ₹999."), response("{{unknown}}"), { text: "not-json", candidates: [{ finishReason: "STOP" }] }, { text: "", candidates: [{ finishReason: "SAFETY" }] }]) {
    await assert.rejects(() => explainWithGemini({ ...settings(), clientFactory: () => ({ models: { generateContent: async () => output } }) }), { status: 502 })
  }
})

test("API quota, authorization and network failures are sanitized without a simulated answer", async () => {
  for (const [status, expected] of [[429, 429], [401, 503], [403, 503], [500, 503]]) {
    await assert.rejects(() => explainWithGemini({ ...settings(), clientFactory: () => ({ models: { generateContent: async () => { throw Object.assign(new Error("PRIVATE-ERROR"), { status }) } } }) }), (error) => error.status === expected && !error.message.includes("PRIVATE"))
  }
})

const intent = { status: "resolved", intent: "list", start: "2026-10-24", end: "2026-10-25", comparisonStart: null, comparisonEnd: null, category: null, method: "upi", explain: false, reference: false }
const interpretation = (output = intent) => ({ text: JSON.stringify(output), candidates: [{ finishReason: "STOP" }] })
test("official SDK structured interpretation sends only questions and scope, never financial records", async () => {
  let sent, calls = 0
  const result = await interpretWithGemini({ env, ...options, questions: ["What damage did my wallet take today via UPI?"], clientFactory: (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (url, init) => {
    calls++
    assert.match(String(url), /gemini-3\.1-flash-lite:generateContent/)
    sent = JSON.parse(init.body)
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(intent) }] } }] })
  } } }) })
  assert.equal(calls, 1)
  assert.equal(result.intent, "list")
  assert.equal(result.retrieval.start, "2026-10-24")
  assert.equal(result.method, "upi")
  assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, "LOW")
  assert.deepEqual(sent.generationConfig.responseJsonSchema.properties.intent.enum, ["expenses", "income", "cashflow", "list", "largest", "categories", "breakdown", "percentages", "comparison"])
  const context = JSON.parse(sent.contents[0].parts[0].text)
  assert.equal(context.asOf, "2026-10-24")
  assert.deepEqual(Object.keys(context).sort(), ["asOf", "question", "recentQuestions", "sessionScope", "timezone"])
  assert.ok(!JSON.stringify(sent).includes("PRIVATE"))
})

test("interpretation validates dates, operations, context references and filter types before retrieval", async () => {
  for (const invalid of [{ intent: "mutate" }, { start: "2026-02-30" }, { start: "2020-01-01" }, { method: "SQL" }, { category: ["Food", "Shopping"] }, { query: "users/bob" }, { reference: true }, { explain: "yes" }]) {
    await assert.rejects(() => interpretWithGemini({ env, ...options, questions: ["Uncertain spending question"], clientFactory: () => ({ models: { generateContent: async () => interpretation({ ...intent, ...invalid }) } }) }), { status: 502 })
  }
  const result = await interpretWithGemini({ env, ...options, questions: ["Something ambiguous"], clientFactory: () => ({ models: { generateContent: async () => interpretation({ ...intent, status: "clarify" }) } }) })
  assert.equal(result.route, "clarify")
  assert.equal(result.retrieval, undefined)
})

test("raw-question interpretation cannot bypass paid handling and surfaces provider failures without a fake plan", async () => {
  let calls = 0
  await assert.rejects(() => interpretWithGemini({ env: { ...env, GEMINI_DATA_HANDLING: "disabled" }, ...options, questions: ["Uncertain question"], clientFactory: () => { calls++; throw new Error("unexpected") } }), /paid-service/)
  assert.equal(calls, 0)
  await assert.rejects(() => interpretWithGemini({ env, ...options, questions: ["Uncertain question"], clientFactory: () => ({ models: { generateContent: async () => { throw Object.assign(new Error("PRIVATE quota"), { status: 429 }) } } }) }), (error) => error.status === 429 && !error.message.includes("PRIVATE"))
})
