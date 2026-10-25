import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { generateDevelopmentJson } from "../lib/geminiFinance.js"
import { financeCapabilities } from "../lib/developmentPolicy.js"
import { createFinanceChatClient } from "../../src/services/financeChatClient.js"
import { answerFinanceQuestion } from "../../src/features/finance-ai/chatOrchestrator.js"
import { createFinancialIndex } from "../../src/features/finance-ai/financialEngine.js"
import { FINANCE_ROUTING_VERSION, financeSourceLabel, validateFinancePolicy } from "../../src/features/finance-ai/financeRouting.js"

const now = new Date("2026-10-25T12:00:00Z")
const timezone = "Asia/Kolkata"
const uid = "routing-test-alice"
const other = "routing-test-bob"
const baseEnv = { GEMINI_API_KEY: "fake-only-key", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid, FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const tx = (id, amount, date, category = "Food & Dining") => ({ id, type: "expense", amount, datetime: `${date}T10:00:00Z`, category, paymentMethod: "upi", person: "PRIVATE-NAME", note: "PRIVATE-NOTE" })
const records = [tx("food", 3450, "2026-10-03"), tx("shopping", 900, "2026-10-05", "Shopping"), tx("previous", 2800, "2026-09-03")]
const query = (extra = {}) => ({ intent: "breakdown", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, task: "answer", targetPaise: null, ...extra })
const plan = (extra = {}) => ({ status: "resolved", queries: [query(extra)] })
const answer = (text = "Verified test spending is {{q0_current_expenses}}.") => ({ answer: text, cardIds: [] })
const conversation = (reply) => ({ status: "conversation", guideId: "", queries: [], clarification: "", reply })
const forbiddenLocalIndex = { timezone, get records() { throw new Error("Local financial answer generation ran before Gemini") }, get categoryNames() { throw new Error("Local intent recognition ran before Gemini") } }

function app({ steps = [], environment = {}, intercept, data = {} } = {}) {
  const env = { ...baseEnv, ...environment }
  const events = [], http = [], provider = [], reads = []
  const factory = (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (_, init) => {
    const body = JSON.parse(init.body)
    const context = JSON.parse(body.contents[0].parts[0].text)
    const phase = context.facts || context.results ? "explanation" : "interpretation"
    events.push(`provider:${phase}`)
    provider.push({ phase, context, body })
    const step = steps.shift()
    assert.ok(step, "Every SDK request must be mocked")
    if (step.http) return Response.json({ error: { code: step.http, message: "PRIVATE provider details", status: "UNAVAILABLE" } }, { status: step.http })
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(step) }] } }] })
  } } })
  const handler = createChatHandler({ env, now: () => now.getTime(), verifyToken: async (token) => token === "bob-token" ? other : uid,
    retrieve: async (request) => { reads.push(request); events.push(`records:${request.uid}`); return data[request.uid] || (request.uid === uid ? records : [tx("bob", 777, "2026-10-03", "Education")]) },
    development: (request) => runDevelopmentConversation({ ...request, generate: (args) => generateDevelopmentJson({ ...args, clientFactory: factory, wait: async () => {} }) }),
    interpretSafe: async () => { throw Object.assign(new Error("Mock protected Gemini failure"), { status: 503, code: "GEMINI_PROVIDER_FAILED", origin: "provider", providerStatus: 503 }) },
  })
  const makeClient = (account = uid, token = "alice-token") => {
    const user = { uid: account, isAnonymous: false, getIdToken: async () => token }
    const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async (path, init) => {
      assert.equal(path, "/api/finance-chat")
      const body = JSON.parse(init.body)
      http.push(body); events.push(`http:${body.action || body.mode || "personal"}`)
      const replacement = intercept?.(body, env)
      if (replacement) return replacement
      return handler(new Request(`https://finsight.example${path}`, { ...init, headers: { ...init.headers, origin: env.AI_ALLOWED_ORIGIN } }))
    } })
    return { user, client }
  }
  const { user, client } = makeClient()
  const ask = (question, extra = {}) => answerFinanceQuestion({ index: forbiddenLocalIndex, now, question, consent: true, development: false, context: null, requestRoute: (request) => client.requestRoute({ user, ...request }), requestCloud: (request) => client.requestChat({ user, ...request }), ...extra })
  return { env, events, http, provider, reads, user, client, handler, ask, makeClient }
}

test("the real client → orchestrator → Netlify → SDK path runs before local parsing despite a stale protected flag", async () => {
  const a = app({ steps: [plan(), answer()] })
  const cached = financeCapabilities({ ...a.env, GEMINI_DATA_HANDLING: "disabled" }, uid)
  const result = await a.ask("Where did my money go?", { policy: cached })
  assert.equal(result.source, "gemini_development")
  assert.equal(result.policy.mode, "development")
  assert.match(result.answer, /₹4,350/)
  assert.deepEqual(a.events, ["http:route", "provider:interpretation", `records:${uid}`, "provider:explanation"])
  assert.equal(a.provider[0].context.messages[0].content, "Where did my money go?")
  assert.equal(a.provider[1].context.facts.q0_current_expenses.value, "₹4,350")
  assert.equal(a.provider[1].context.results[0].transactions[0].type, "expense")
  assert.match(financeSourceLabel(result.source), /Gemini-generated answer/)
})

test("all requested conversational follow-ups retain complete messages and backend-validated scope", async () => {
  const questions = ["Where did my money go?", "What about last month?", "Why?", "List my expenses", "What can I improve?", "Explain that again", "How can I save more?"]
  const scopes = [{}, { start: "2026-09-01", end: "2026-10-01" }, { start: "2026-09-01", end: "2026-10-01", comparisonStart: "2026-10-01", comparisonEnd: "2026-11-01", task: "analyse" }, { intent: "list" }, { task: "analyse" }, { task: "analyse" }, { task: "reduce" }]
  const a = app({ steps: scopes.flatMap((scope) => [plan(scope), answer()]) })
  let context = null
  const history = []
  for (let i = 0; i < questions.length; i++) {
    const result = await a.ask(questions[i], { history, context })
    assert.equal(result.source, "gemini_development")
    assert.equal(a.provider[i * 2].context.messages.at(-1).content, questions[i])
    if (i) {
      assert.equal(a.provider[i * 2].context.sessionScope.version, 2)
      assert.ok(a.provider[i * 2].context.messages.some((message) => message.role === "assistant"))
    }
    context = result.context
    history.push({ role: "user", content: questions[i] }, { role: "assistant", content: result.answer })
  }
  assert.equal(a.http.length, questions.length)
  assert.equal(a.provider.length, questions.length * 2)
  assert.equal(a.reads[1].range.start, "2026-09-01")
  assert.deepEqual(a.reads[2].range.ranges, [{ start: "2026-09-01", end: "2026-11-01" }])
  assert.equal(a.http.at(-1).messages.length, 11)
})

test("provider failure after validated retrieval is a retryable error, never a local answer", async () => {
  const a = app({ steps: [plan(), { http: 503 }, { http: 503 }] })
  await assert.rejects(() => a.ask("Explain that again"), (error) => error.origin === "provider" && error.providerStatus === 503 && error.retryable === true && /Gemini provider/.test(error.message))
  assert.equal(a.reads.length, 1)
  assert.equal(a.provider.length, 3)
  assert.equal(a.http.length, 1)
})

test("a deterministic Gemini 400 reaches the client with its stage and cannot trigger retry or local fallback", async () => {
  const a = app({ steps: [plan(), { http: 400 }] })
  await assert.rejects(() => a.ask("Explain that again"), (error) => {
    assert.equal(error.code, "GEMINI_REQUEST_REJECTED")
    assert.equal(error.origin, "provider")
    assert.equal(error.providerStatus, 400)
    assert.equal(error.retryable, false)
    assert.equal(error.provider.stage, "explanation")
    assert.equal(error.provider.reason, "request_configuration")
    assert.doesNotMatch(error.message, /PRIVATE|unsupported model/)
    return true
  })
  assert.equal(a.reads.length, 1)
  assert.equal(a.provider.length, 2)
  assert.equal(a.http.length, 1)
})

test("eligible legacy personal-mode requests are also upgraded by the server before keyword parsing", async () => {
  const a = app({ steps: [plan(), answer()] })
  const result = await a.client.requestChat({ user: a.user, messages: [{ role: "user", content: "Where did my money go?" }], consent: true, timezone })
  assert.equal(a.http[0].mode, undefined)
  assert.equal(result.route, "development")
  assert.equal(result.source, "gemini_development")
  assert.equal(a.provider.length, 2)
})

test("capability lookup failures and old deployed routing protocols are not accepted as protected mode", async () => {
  const a = app({ steps: [plan(), answer()], intercept: (body) => body.action === "capabilities" ? Response.json({ error: "Send questions only" }, { status: 400 }) : null })
  await assert.rejects(() => a.client.requestCapabilities({ user: a.user }), { code: "AI_ROUTING_VERSION_MISMATCH", retryable: true })
  assert.throws(() => validateFinancePolicy({ error: "lookup failed" }), { code: "AI_ROUTING_VERSION_MISMATCH" })
  // A subsequent routing request can recover using current server authority.
  const recovered = await a.ask("Where did my money go?", { policy: { error: "lookup failed" } })
  assert.equal(recovered.source, "gemini_development")
  const old = app({ intercept: () => Response.json({ source: "local", answer: "Old monthly total", cards: [] }) })
  await assert.rejects(() => old.ask("Where did my money go?"), { code: "AI_ROUTING_VERSION_MISMATCH" })
})

test("missing Gemini configuration cannot silently turn an eligible session into local answers", async () => {
  const a = app({ environment: { GEMINI_API_KEY: "" } })
  const policy = await a.client.requestCapabilities({ user: a.user })
  assert.equal(policy.mode, "development")
  assert.equal(policy.cloudConfigured, false)
  assert.equal(policy.reasons[0].code, "GEMINI_KEY_MISSING")
  await assert.rejects(() => a.ask("Where did my money go?"), { code: "GEMINI_KEY_MISSING", origin: "configuration", retryable: true })
  assert.equal(a.provider.length, 0)
  assert.equal(a.reads.length, 0)
})

test("disabled mode, UID mismatch, unconfirmed data and disabled consent have distinct visible reasons", async () => {
  const cases = [[{ GEMINI_DATA_HANDLING: "disabled" }, "DEVELOPMENT_DISABLED"], [{ GEMINI_DEVELOPMENT_UIDS: "different-test-user" }, "TEST_UID_NOT_ALLOWLISTED"], [{ GEMINI_DEVELOPMENT_DATA: "" }, "DEVELOPMENT_DATA_UNCONFIRMED"]]
  const localIndex = createFinancialIndex(records, { now, timezone })
  for (const [environment, code] of cases) {
    const a = app({ environment })
    const result = await a.ask("Where did my money go?", { index: localIndex })
    assert.equal(result.source, "local")
    assert.equal(result.routing.code, code)
    assert.equal(result.policy.mode, "protected")
    assert.ok(result.routing.message.length > 0)
    assert.equal(a.provider.length, 0)
    assert.equal(a.reads.length, 0)
  }
  const off = app()
  const result = await off.ask("Where did my money go?", { index: localIndex, consent: false })
  assert.equal(result.source, "local")
  assert.equal(result.routing.code, "CLOUD_SHARING_DISABLED")
  assert.equal(off.http.length, 0)
})

test("ordinary users retain local calculations, and intended protected Gemini errors stay visible", async () => {
  const a = app({ environment: { GEMINI_DEVELOPMENT_UIDS: "someone-else" } })
  const index = createFinancialIndex(records, { now, timezone })
  const result = await a.ask("Where did my money go?", { index })
  assert.equal(result.source, "local")
  assert.match(result.answer, /₹4,350/)
  await assert.rejects(() => a.ask("Why did spending increase?", { index }), { code: "GEMINI_PROVIDER_FAILED", origin: "provider", retryable: true })
  assert.equal(a.provider.length, 0)
})

test("tool requests still reject arbitrary paths and invalid filters before any financial retrieval", async () => {
  for (const change of [{ path: `users/${other}/transactions` }, { method: "wire" }, { start: "2020-01-01" }, { intent: "delete" }]) {
    const malformed = plan()
    Object.assign(malformed.queries[0], change)
    const a = app({ steps: [malformed] })
    await assert.rejects(() => a.ask("List my expenses"), { code: "GEMINI_TOOL_REQUEST_INVALID", origin: "model_output" })
    assert.equal(a.reads.length, 0)
    assert.equal(a.provider.length, 1)
  }
})

test("verified token identity controls every user's records, with no cross-user cache or asserted UID", async () => {
  const a = app({ steps: [plan(), answer(), plan(), answer()], environment: { GEMINI_DEVELOPMENT_UIDS: `${uid},${other}` } })
  const alice = await a.ask("Where did my money go?")
  const bobClient = a.makeClient(other, "bob-token")
  const bob = await answerFinanceQuestion({ index: forbiddenLocalIndex, now, question: "Where did my money go?", consent: true, requestRoute: (args) => bobClient.client.requestRoute({ user: bobClient.user, ...args }) })
  assert.match(alice.answer, /₹4,350/)
  assert.match(bob.answer, /₹777/)
  assert.ok(!bob.answer.includes("4,350"))
  assert.deepEqual(a.reads.map((read) => read.uid), [uid, other])
  assert.ok(a.http.every((body) => !Object.hasOwn(body, "uid")))
  const rejected = await a.handler(new Request("https://finsight.example/api/finance-chat", { method: "POST", headers: { origin: a.env.AI_ALLOWED_ORIGIN, authorization: "Bearer bob-token", "content-type": "application/json" }, body: JSON.stringify({ action: "route", consent: true, timezone, uid, messages: [{ role: "user", content: "Where did my money go?" }] }) }))
  assert.equal(rejected.status, 400)
})

test("a development response cannot be labelled Gemini-generated if the backend returned a local result", async () => {
  const a = app({ intercept: (body, env) => body.action === "route" ? Response.json({ routingVersion: FINANCE_ROUTING_VERSION, route: "development", policy: financeCapabilities(env, uid), source: "local", answer: "Local answer", cards: [], fictionalDataOnly: true, cloud: { status: "used", dataHandling: "development" } }) : null })
  await assert.rejects(() => a.ask("List my expenses"), { code: "DEVELOPMENT_RESPONSE_MISMATCH", retryable: true })
  assert.equal(a.provider.length, 0)
})

test("Gemini generates clarification prose in the plan without a second cloud call", async () => {
  const a = app({ steps: [{ status: "clarify", queries: [], clarification: "Which spending period would you like me to explain?" }] })
  const result = await a.ask("Why?")
  assert.equal(result.source, "gemini_development")
  assert.equal(result.answer, "Which spending period would you like me to explain?")
  assert.equal(a.provider.length, 1)
  assert.equal(a.reads.length, 0)
})

test("Gemini social intents bypass retrieval and verified cards while financial follow-ups retain scope", async () => {
  const socials = [
    ["hey how you doing", "I'm here and ready to help. How are you doing?"],
    ["Thanks, that helped!", "You're welcome!"],
    ["My name is Alex", "Nice to meet you!"],
    ["Tell me a joke", "Why did the notebook blush? It had too many personal notes."],
  ]
  const financial = (extra = {}) => plan({ category: "Food & Dining", method: "upi", ...extra })
  const a = app({ steps: [financial(), answer(), ...socials.map(([, reply]) => conversation(reply)), financial({ start: "2026-09-01", end: "2026-10-01" }), answer(), financial({ start: "2026-09-01", end: "2026-10-01", comparisonStart: "2026-08-01", comparisonEnd: "2026-09-01", task: "analyse" }), { answer: "{{q0_record_status}}." }] })
  const initial = await a.ask("Where did my money go?")
  assert.ok(initial.presentation.blocks.some((block) => block.type === "categories"))
  let context = initial.context
  const history = [{ role: "user", content: "Where did my money go?" }, { role: "assistant", content: initial.answer }]
  for (const [question, reply] of socials) {
    const before = a.provider.length
    const result = await a.ask(question, { context, history })
    assert.equal(result.answer, reply)
    assert.equal(result.source, "gemini_development")
    assert.deepEqual(result.cards, [])
    assert.ok(result.presentation.blocks.every((block) => block.type === "paragraph"))
    assert.deepEqual(result.context, initial.context)
    assert.equal(a.reads.length, 1)
    assert.equal(a.provider.length, before + 1)
    context = result.context
    history.push({ role: "user", content: question }, { role: "assistant", content: reply })
  }
  const lastMonth = await a.ask("What about last month?", { context, history })
  assert.equal(lastMonth.context.queries[0].start, "2026-09-01")
  assert.equal(lastMonth.context.queries[0].category, "Food & Dining")
  assert.match(lastMonth.answer, /₹2,800/)
  const higher = await a.ask("Why was it higher?", { context: lastMonth.context })
  assert.equal(higher.cards.length, 1)
  assert.equal(higher.cards[0].currentPaise, 280000)
  assert.equal(higher.cards[0].previousPaise, 0)
  assert.doesNotMatch(higher.answer, /\.\./)
  assert.equal(a.reads.length, 3)
})

test("a stale financial plan for a social message is corrected before any records or cards are built", async () => {
  const a = app({ steps: [plan(), conversation("I'm here and happy to help!")] })
  const result = await a.ask("hey how you doing", { context: { version: 2, queries: [query()] } })
  assert.equal(result.answer, "I'm here and happy to help!")
  assert.deepEqual(result.cards, [])
  assert.equal(a.provider.length, 2)
  assert.equal(a.provider[1].context.validationFeedback.rule, "conversation_intent")
  assert.equal(a.reads.length, 0)
  assert.equal(result.cloud.correctionAttempted, true)
})

test("conversation output cannot smuggle financial queries, unverified figures or display blocks", async () => {
  for (const invalid of [
    { ...conversation("Hello!"), queries: [query()] },
    conversation("You spent ₹999."),
    { ...conversation("Hello!"), blockIds: ["q0_categories"] },
    conversation("<script>unsafe()</script>"),
  ]) {
    const a = app({ steps: [invalid, invalid] })
    await assert.rejects(() => a.ask("hey how you doing"), { status: 502, origin: "model_output" })
    assert.equal(a.reads.length, 0)
    assert.equal(a.provider.length, 2)
  }
})

test("eligibility is evaluated again per message instead of trusting a permanent page cache", async () => {
  const a = app({ environment: { GEMINI_DATA_HANDLING: "disabled" }, steps: [plan(), answer()] })
  const cached = await a.client.requestCapabilities({ user: a.user })
  assert.equal(cached.mode, "protected")
  a.env.GEMINI_DATA_HANDLING = "development"
  const result = await a.ask("Where did my money go?", { policy: cached })
  assert.equal(result.source, "gemini_development")
  a.env.GEMINI_DATA_HANDLING = "disabled"
  await assert.rejects(() => a.ask("Why?", { context: result.context, development: true }), { code: "DEVELOPMENT_SESSION_CHANGED", retryable: true })
  assert.equal(a.provider.length, 2)
})
