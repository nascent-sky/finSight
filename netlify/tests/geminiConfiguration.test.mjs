import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { generateDevelopmentJson, DEFAULT_GEMINI_MODEL } from "../lib/geminiFinance.js"
import { GEMINI_RESPONSE_SCHEMA, GEMINI_PLAN_SCHEMA, normalizeGeminiPlan, assertSimpleResponseSchema } from "../lib/geminiRequestSchema.js"
import { validateDevelopmentPlan } from "../lib/developmentContract.js"
import { validateDevelopmentResponse } from "../lib/developmentResponse.js"
import { geminiProviderError, providerStatus } from "../lib/geminiErrors.js"
import { validateResponsePresentation } from "../../src/features/finance-ai/responseBlocks.js"

const uid = "PRIVATE-test-user", token = "PRIVATE-test-token"
const env = { GEMINI_API_KEY: "PRIVATE-key", GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid, FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const now = new Date("2026-10-24T12:00:00Z")
const records = [
  { id: "PRIVATE-food", amount: 3450, type: "expense", datetime: "2026-10-02T10:00:00Z", category: "Food & Dining", paymentMethod: "upi", note: "PRIVATE-note", person: "PRIVATE-person" },
  { id: "PRIVATE-shopping", amount: 900, type: "expense", datetime: "2026-10-03T10:00:00Z", category: "Shopping", paymentMethod: "upi" },
]
const query = (extra = {}) => ({ intent: "breakdown", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, task: "answer", targetPaise: null, ...extra })
const plan = (extra) => {
  const q = query(extra)
  return { status: "resolved", guideId: "", clarification: "", queries: [{ ...q, comparisonStart: q.comparisonStart || "", comparisonEnd: q.comparisonEnd || "", category: q.category || "", method: q.method || "", targetPaise: q.targetPaise || 0, reductionBps: q.reductionBps ?? -1 }] }
}
const flat = (type, values = {}) => ({ type, kind: "recommendation", text: "", title: "", id: "", estimateId: "", ordered: false, items: [], ...values })
const result = (...blocks) => ({ blocks, cardIds: [] })
const httpError = (status, message, extra = {}) => ({ http: status, message, ...extra })

function inspectRequest(url, body, options) {
  assert.match(String(url), /\/models\/gemini-3\.1-flash-lite:generateContent$/)
  assert.equal(options.httpOptions.retryOptions.attempts, 1)
  const config = body.generationConfig
  assert.equal(config.responseMimeType, "application/json")
  assert.ok(["LOW", "MEDIUM"].includes(config.thinkingConfig.thinkingLevel))
  assert.equal(Object.hasOwn(config.thinkingConfig, "thinkingBudget"), false)
  for (const key of ["tools", "toolConfig", "functionDeclarations"]) assert.equal(Object.hasOwn(body, key), false)
  for (const key of ["responseSchema", "temperature", "topP", "topK", "candidateCount"]) assert.equal(Object.hasOwn(config, key), false)
  if (config.responseJsonSchema.properties.answer) {
    assertSimpleResponseSchema(config.responseJsonSchema)
    assert.deepEqual(config.responseJsonSchema.required, ["answer"])
    assert.equal(config.responseJsonSchema.properties.answer.type, "string")
    assert.equal(config.responseJsonSchema.properties.blockIds.items.type, "string")
    assert.deepEqual(Object.keys(config.responseJsonSchema.properties), ["answer", "blockIds"])
    assert.equal(JSON.stringify(config.responseJsonSchema).includes("anyOf"), false)
    assert.ok(JSON.stringify(config.responseJsonSchema).length < 1200)
  } else {
    // Planning remains its own typed read-only query request, never mixed with
    // final formatting or SDK function-calling declarations.
    assertSimpleResponseSchema(config.responseJsonSchema)
    assert.deepEqual(config.responseJsonSchema.required, ["status", "guideId", "queries", "clarification", "reply"])
    assert.equal(config.responseJsonSchema.properties.queries.items.properties.targetPaise.type, "integer")
    for (const property of Object.values(config.responseJsonSchema.properties.queries.items.properties)) assert.equal(Array.isArray(property.type), false)
  }
}

function app(steps) {
  const calls = [], reads = [], waits = [], events = []
  const clientFactory = (options) => new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, fetch: async (url, init) => {
    const body = JSON.parse(init.body), context = JSON.parse(body.contents[0].parts[0].text)
    inspectRequest(url, body, options)
    const stage = context.facts || context.guide ? "explanation" : "planning"
    calls.push({ body, context, stage }); events.push(stage)
    const step = steps.shift()
    assert.ok(step, "Every SDK request must be explicitly expected")
    if (step.network) throw new Error("PRIVATE-network-detail")
    if (step.http) return Response.json({ error: { code: step.http, status: step.http === 400 ? "INVALID_ARGUMENT" : step.http === 429 ? "RESOURCE_EXHAUSTED" : "UNAVAILABLE", message: step.message, ...(step.details ? { details: step.details } : {}) } }, { status: step.http })
    const output = typeof step === "function" ? step(context) : step
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: output.rawJson ?? JSON.stringify(output) }] } }] })
  } } })
  const handler = createChatHandler({ env, now: () => now.getTime(), verifyToken: async () => uid,
    retrieve: async (request) => { reads.push(request); events.push("financial_tools"); return records },
    development: (request) => runDevelopmentConversation({ ...request, generate: (args) => generateDevelopmentJson({ ...args, clientFactory, wait: async (ms) => { waits.push(ms) } }) }),
  })
  return { calls, reads, waits, events, ask: async (question, extra = {}) => {
    const response = await handler(new Request(`${env.AI_ALLOWED_ORIGIN}/api/finance-chat`, { method: "POST", headers: { origin: env.AI_ALLOWED_ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "route", consent: true, timezone: "UTC", messages: [{ role: "user", content: question }], ...extra }) }))
    return { status: response.status, ...await response.json() }
  } }
}

test("the provider schema is flat and bounded, unlike the captured rich-response regression", async () => {
  const old = JSON.parse(await readFile(new URL("./fixtures/rich-response-schema-before.json", import.meta.url), "utf8"))
  assert.equal(old.anyOf.length, 3)
  assert.equal(old.properties.blocks.items.anyOf.length, 7)
  assert.throws(() => assertSimpleResponseSchema(old), /flat compatibility contract/)
  assert.doesNotThrow(() => assertSimpleResponseSchema(GEMINI_RESPONSE_SCHEMA))
  assert.doesNotThrow(() => assertSimpleResponseSchema(GEMINI_PLAN_SCHEMA))
  const oldPlan = JSON.parse(await readFile(new URL("./fixtures/plan-schema-before.json", import.meta.url), "utf8"))
  assert.throws(() => assertSimpleResponseSchema(oldPlan), /flat compatibility contract/)
  assert.ok(JSON.stringify(GEMINI_RESPONSE_SCHEMA).length < JSON.stringify(old).length / 2)
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.1-flash-lite")
})

test("actual SDK requests support overview → recommendations → verified scenario with separate tool and formatting phases", async () => {
  const a = app([
    plan(), result(flat("categories", { id: "q0_categories" }), flat("actions", { items: ["analytics"] })),
    plan({ task: "reduce" }), (context) => {
      assert.ok(context.messages.some((message) => message.role === "assistant"))
      assert.equal(context.facts.q0_current_expenses.value, "₹4,350")
      return { answer: "Compare optional purchases before committing.", blockIds: ["q0_review0"] }
    },
    plan({ task: "reduce", category: "Shopping", reductionBps: 2000 }), result(flat("savings", { id: "q0_reduction" })),
  ])
  const history = []
  let context = null
  for (const question of ["Where did my money go?", "How can I reduce it?", "What if I reduce shopping by 20%?"]) {
    const response = await a.ask(question, { context, messages: [...history, { role: "user", content: question }] })
    assert.equal(response.status, 200)
    assert.equal(response.source, "gemini_development")
    assert.equal(response.cloud.correctionAttempted, false)
    validateResponsePresentation(response.presentation)
    context = response.context
    history.push({ role: "user", content: question }, { role: "assistant", content: response.answer })
  }
  assert.equal(a.calls[1].body.generationConfig.thinkingConfig.thinkingLevel, "LOW")
  assert.equal(a.calls[3].body.generationConfig.thinkingConfig.thinkingLevel, "MEDIUM")
  assert.deepEqual(a.events, ["planning", "financial_tools", "explanation", "planning", "financial_tools", "explanation", "planning", "financial_tools", "explanation"])
  assert.equal(a.reads.length, 3)
  assert.ok(a.reads.every((request) => request.uid === uid && request.token === token))
  assert.equal(context.queries[0].reductionBps, 2000)
  for (const call of a.calls) assert.doesNotMatch(JSON.stringify(call.context), /PRIVATE-/)
})

test("flat selectors normalize into existing rich blocks and reject unused fields and malformed values", () => {
  const options = { facts: { value: { value: "₹900", kind: "recorded" } }, cardMap: {}, allowedActions: ["analytics"], catalog: { metric: { block: { type: "metric", label: "Shopping", semantic: "expense", amountPaise: 90000, period: "October" }, factKeys: ["value"] } } }
  const valid = validateDevelopmentResponse(result(flat("heading", { text: "A useful next step" }), flat("list", { ordered: true, items: ["Review optional purchases", "Protect essentials"] }), flat("metric", { id: "metric" }), flat("actions", { items: ["analytics"] }), flat("followups", { items: ["reduce"] })), options)
  assert.deepEqual(valid.presentation.blocks.map((block) => block.type), ["heading", "list", "metric", "actions", "followups"])
  assert.equal(valid.presentation.blocks[2].amountPaise, 90000)
  for (const block of [flat("metric", { id: "metric", text: "You spent ₹999" }), { ...flat("metric", { id: "metric" }), amountPaise: 999 }, flat("metric", { id: "unknown" }), flat("actions", { items: ["budget"] }), flat("list", { items: [{ text: "Object instead of string" }] }), Object.fromEntries(Object.entries(flat("metric", { id: "metric" })).filter(([key]) => key !== "title"))]) {
    assert.throws(() => validateDevelopmentResponse(result(block), options), { origin: "model_output" })
  }
})

test("wire-only plan sentinels normalize before tools without weakening canonical scope validation", () => {
  const normalized = normalizeGeminiPlan(plan({ task: "reduce", category: "Shopping", reductionBps: 0 }))
  assert.equal(normalized.guideId, null)
  assert.equal(normalized.queries[0].targetPaise, null)
  assert.equal(normalized.queries[0].reductionBps, 0)
  assert.equal(normalized.queries[0].comparisonStart, null)
  assert.equal(normalized.queries[0].category, "Shopping")
  const resolved = validateDevelopmentPlan(normalized, { now, timezone: "UTC" })
  assert.equal(resolved.plans[0].reductionBps, 0)
  assert.throws(() => validateDevelopmentPlan({ status: "resolved", queries: [query({ targetPaise: 0 })] }, { now, timezone: "UTC" }))
  for (const change of [{ method: "wire" }, { reductionBps: 10001 }, { targetPaise: 9000000000001 }, { uid: "other-user" }]) {
    assert.throws(() => validateDevelopmentPlan(normalizeGeminiPlan(plan(change)), { now, timezone: "UTC" }))
  }
})

test("400 schema errors retain stage/status/field diagnostics, never retry or pretend the model is unsupported", async () => {
  for (const [message, reason] of [["The response schema produces too many states. PRIVATE-prompt ₹123456", "schema_complexity"], ["This model does not support the supplied responseJsonSchema anyOf. PRIVATE-key", "schema_invalid"]]) {
    const a = app([plan(), httpError(400, message, { details: [{ fieldViolations: [{ field: "generation_config.response_json_schema.properties.blocks.items", description: "PRIVATE-record" }, { field: "PRIVATE-identifier", description: "PRIVATE-data" }] }] })])
    const response = await a.ask("Where did my money go?")
    assert.equal(response.status, 502)
    assert.equal(response.code, "GEMINI_REQUEST_REJECTED")
    assert.equal(response.providerStatus, 400)
    assert.equal(response.retryable, false)
    assert.equal(response.provider.stage, "explanation")
    assert.equal(response.provider.code, "INVALID_ARGUMENT")
    assert.equal(response.provider.reason, reason)
    assert.equal(response.provider.schemaVersion, "narrative-refs-v1")
    assert.equal(response.provider.field, "generationConfig.responseJsonSchema")
    assert.deepEqual(response.provider.fields, ["generation_config.response_json_schema.properties.blocks.items"])
    assert.equal(a.calls.length, 2)
    assert.equal(a.reads.length, 1)
    assert.equal(a.waits.length, 0)
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE-|123456|₹/)
  }
})

test("a rejected planning/thinking request is identified before financial tools run", async () => {
  const a = app([httpError(400, "thinkingConfig.thinkingLevel is not supported by this model. PRIVATE")])
  const response = await a.ask("Where did my money go?")
  assert.equal(response.code, "GEMINI_REQUEST_REJECTED")
  assert.equal(response.provider.stage, "planning")
  assert.equal(response.provider.reason, "thinking_configuration")
  assert.equal(response.provider.field, "generationConfig.thinkingConfig")
  assert.equal(response.retryable, false)
  assert.equal(a.calls.length, 1)
  assert.equal(a.reads.length, 0)
})

test("429, exhausted 503, 504 and transport failures remain distinct with bounded request counts", async () => {
  for (const [steps, status, code, reason, calls, waits] of [
    [[httpError(429, "PRIVATE quota")], 429, "GEMINI_RATE_LIMITED", "rate_limit", 1, 0],
    [[httpError(503, "PRIVATE unavailable"), httpError(503, "PRIVATE unavailable")], 503, "GEMINI_PROVIDER_FAILED", "unavailable", 2, 1],
    [[httpError(504, "PRIVATE deadline")], 504, "GEMINI_TIMEOUT", "timeout", 1, 0],
    [[{ network: true }], 503, "GEMINI_TRANSPORT_FAILED", "transport_failure", 1, 0],
  ]) {
    const a = app(steps)
    const response = await a.ask("Where did my money go?")
    assert.equal(response.status, status)
    assert.equal(response.code, code)
    assert.equal(response.provider.reason, reason)
    assert.equal(response.provider.stage, "planning")
    assert.equal(response.provider.attempts, calls)
    assert.equal(a.calls.length, calls)
    assert.equal(a.waits.length, waits)
    assert.equal(a.reads.length, 0)
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE/)
  }
})

test("a planning deadline keeps sanitized timeout diagnostics without retrying or changing configuration", async () => {
  const controller = new AbortController()
  let calls = 0
  await assert.rejects(() => generateDevelopmentJson({ env, uid, token, stage: "planning", schema: GEMINI_PLAN_SCHEMA, instructions: "Synthetic test", context: {}, signal: controller.signal,
    clientFactory: (options) => {
      assert.equal(options.httpOptions.timeout, 16000)
      assert.equal(options.httpOptions.retryOptions.attempts, 1)
      return { models: { generateContent: async () => { calls++; controller.abort(new DOMException("PRIVATE deadline detail", "TimeoutError")); throw controller.signal.reason } } }
    },
  }), (error) => {
    assert.equal(error.code, "GEMINI_TIMEOUT")
    assert.equal(error.status, 504)
    assert.equal(error.origin, "provider")
    assert.equal(error.provider.stage, "planning")
    assert.equal(error.provider.reason, "timeout")
    assert.equal(error.provider.status, null) // A local deadline has no provider HTTP status.
    assert.equal(error.provider.attempts, 1)
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE/)
    assert.doesNotMatch(error.message, /PRIVATE/)
    return true
  })
  assert.equal(calls, 1)
})

test("clarification is written in the planning response with no extra narrative request or financial retrieval", async () => {
  const question = "Which spending period would you like to explore?"
  const a = app([{ status: "clarify", guideId: "", queries: [], clarification: question }])
  const response = await a.ask("Why?")
  assert.equal(response.status, 200)
  assert.equal(response.answer, question)
  assert.equal(response.source, "gemini_development")
  assert.deepEqual(response.cards, [])
  assert.equal(response.cloud.stage, "planning")
  assert.deepEqual(a.events, ["planning"])
  assert.equal(a.calls.length, 1)
  assert.equal(a.reads.length, 0)
})

test("straightforward financial totals use planning and explanation without a clarification request", async () => {
  for (const [question, intent] of [["How much did I spend this month?", "expenses"], ["What is my income this month?", "income"]]) {
    const a = app([plan({ intent }), { answer: "{{q0_record_status}}" }])
    const response = await a.ask(question)
    assert.equal(response.status, 200)
    assert.deepEqual(a.events, ["planning", "financial_tools", "explanation"])
    assert.equal(a.calls.length, 2)
    assert.equal(a.reads.length, 1)
  }
})

test("inline clarification keeps validation, a single correction budget, and the original conversation scope", async () => {
  const scope = { version: 2, queries: [query()] }
  const valid = { status: "clarify", guideId: "", queries: [], clarification: "Which spending period do you mean?" }
  for (const clarification of [undefined, null, 42, "", " ", "x".repeat(1201), "You spent ₹999.", "<script>unsafe()</script>", "See https://untrusted.example"]) {
    const a = app([{ ...valid, clarification }, valid])
    const response = await a.ask("Why?", { context: scope })
    assert.equal(response.status, 200)
    assert.equal(response.answer, valid.clarification)
    assert.deepEqual(response.context, scope)
    assert.equal(response.cloud.correctionAttempted, true)
    assert.deepEqual(a.events, ["planning", "planning"])
    assert.equal(a.reads.length, 0)
  }
  const invalid = { ...valid, clarification: "You spent ₹999." }
  const a = app([invalid, invalid])
  const response = await a.ask("Why?")
  assert.equal(response.status, 502)
  assert.equal(response.origin, "model_output")
  assert.equal(response.validation.stage, "planning")
  assert.equal(response.validation.field, "clarification")
  assert.equal(response.validation.correctionAttempted, true)
  assert.equal(a.calls.length, 2)
  assert.equal(a.reads.length, 0)
})

test("a transient planning 503 retries once before an inline clarification without nested SDK retries", async () => {
  const a = app([httpError(503, "PRIVATE unavailable"), { status: "clarify", guideId: "", queries: [], clarification: "Which spending period do you mean?" }])
  const response = await a.ask("Why?")
  assert.equal(response.status, 200)
  assert.equal(a.calls.length, 2)
  assert.deepEqual(a.calls[0].body, a.calls[1].body)
  assert.equal(a.waits.length, 1)
  assert.ok(a.waits[0] >= 250 && a.waits[0] < 400)
  assert.equal(a.reads.length, 0)
})

test("a transient final-stage 503 retries once with unchanged configuration and no duplicate financial retrieval", async () => {
  const a = app([plan({ intent: "expenses" }), httpError(503, "Service unavailable"), result(flat("metric", { id: "q0_expenses" }))])
  const response = await a.ask("Where did my money go?")
  assert.equal(response.status, 200)
  assert.equal(response.presentation.blocks[0].amountPaise, 435000)
  assert.deepEqual(a.calls[1].body, a.calls[2].body)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
  assert.equal(a.waits.length, 1)
})

test("malformed JSON and invalid financial claims use the correction budget, not provider-error retries", async () => {
  for (const [invalid, rule] of [[{ rawJson: "{PRIVATE-not-JSON" }, "json_invalid"], [result(flat("paragraph", { kind: "recorded", text: "You spent ₹999." })), "figure_unverified"]]) {
    const a = app([plan(), invalid, invalid])
    const response = await a.ask("Where did my money go?")
    assert.equal(response.status, 502)
    assert.equal(response.origin, "model_output")
    assert.equal(response.validation.stage, "explanation")
    assert.equal(response.validation.rule, rule)
    assert.equal(response.validation.correctionAttempted, true)
    assert.equal(response.provider, undefined)
    assert.equal(a.calls.length, 3)
    assert.equal(a.waits.length, 0)
    assert.equal(a.reads.length, 1)
  }
})

test("the prior branched rich schema cannot accidentally be sent again", async () => {
  const schema = JSON.parse(await readFile(new URL("./fixtures/rich-response-schema-before.json", import.meta.url), "utf8"))
  let requests = 0
  await assert.rejects(() => generateDevelopmentJson({ env, uid, token, stage: "explanation", schema, instructions: "Synthetic test", context: {}, clientFactory: () => { requests++; throw new Error("Must fail before constructing the SDK client") } }), { code: "GEMINI_SCHEMA_CONFIGURATION_INVALID", origin: "configuration", retryable: false })
  assert.equal(requests, 0)
})

test("HTTP status has precedence over contradictory error bodies, and API key errors are not schema errors", () => {
  const error = Object.assign(new Error(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "responseJsonSchema is invalid; a model timeout field is unsupported" } })), { status: 400 })
  assert.equal(providerStatus(error), 400)
  const mapped = geminiProviderError(error, { stage: "explanation", model: env.GEMINI_MODEL, schemaVersion: "flat-blocks-v1" })
  assert.equal(mapped.code, "GEMINI_REQUEST_REJECTED")
  assert.equal(mapped.retryable, false)
  const key = geminiProviderError(Object.assign(new Error("API key not valid. PRIVATE"), { status: 400 }), { stage: "planning", model: env.GEMINI_MODEL, schemaVersion: "planning-v1" })
  assert.equal(key.code, "GEMINI_AUTH_FAILED")
  assert.equal(key.provider.reason, "api_key_invalid")
  assert.equal(key.retryable, false)
})
