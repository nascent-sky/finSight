import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { generateDevelopmentJson } from "../lib/geminiFinance.js"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { validateDevelopmentPlan } from "../lib/developmentContract.js"
import { conversationContextFromPlan, planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner.js"
import { financeCapabilities } from "../lib/developmentPolicy.js"

const now = new Date("2026-10-25T12:00:00Z")
const uid = "allowlisted-test-uid"
const token = "signed-test-token"
const env = { GEMINI_API_KEY: "fake-api-key-never-in-prompts", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid, FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const timezone = "Asia/Kolkata"
const record = (id, amount, day, category = "Food & Dining", method = "upi", type = "expense") => ({ id, amount, datetime: `${day}T10:00:00Z`, category, paymentMethod: method, type, person: "PRIVATE-PERSON", note: "PRIVATE-NOTE" })
const records = [record("salary", 30000, "2026-10-01", "Income", "cash", "income"), record("food", 3450, "2026-10-03"), record("food-cash", 500, "2026-10-07", "Food & Dining", "cash"), record("rent", 6000, "2026-10-01", "Housing", "cash"), record("shopping", 900, "2026-10-05", "Shopping"), record("travel", 200, "2026-10-08", "Transport"), record("bus", 50, "2026-10-07", "Transport"), record("food-before", 2800, "2026-09-03"), record("rent-before", 6000, "2026-09-01", "Housing", "cash"), record("shopping-before", 450, "2026-09-05", "Shopping")]
const query = (extra = {}) => ({ intent: "expenses", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, task: "answer", targetPaise: null, ...extra })
const plan = (...queries) => ({ status: "resolved", queries })
const explain = (answer = "Recorded test expenses total {{q0_current_expenses}}.", cardIds = []) => ({ answer, cardIds })
const payload = (content = "Where did my money go?", extra = {}) => ({ mode: "development", consent: true, timezone, messages: [{ role: "user", content }], ...extra })
const request = (body, headers = {}) => new Request("https://finsight.example/api/finance-chat", { method: "POST", headers: { origin: env.AI_ALLOWED_ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) })

function harness({ responses = [], data = records, settings = env, account = uid, verify, retrieve } = {}) {
  const calls = [], reads = [], waits = []
  const clientFactory = (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (url, init) => {
    const body = JSON.parse(init.body)
    const context = JSON.parse(body.contents[0].parts[0].text)
    calls.push({ body, context, url: String(url), configuration })
    const next = responses.shift()
    assert.ok(next, "Every provider request must have an explicit mock response")
    if (next.http) return Response.json({ error: { code: next.http, status: "UNAVAILABLE", message: "PRIVATE provider failure" } }, { status: next.http })
    const output = typeof next === "function" ? await next(context, body) : next
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(output) }] } }] })
  } } })
  const run = createChatHandler({ env: settings, now: () => now.getTime(), verifyToken: verify || (async () => account),
    retrieve: async (args) => { reads.push(args); return retrieve ? retrieve(args) : data },
    development: (args) => runDevelopmentConversation({ ...args, generate: (options) => generateDevelopmentJson({ ...options, clientFactory, wait: async (ms) => { waits.push(ms) } }) }),
    interpretSafe: () => { throw new Error("No unmocked safe provider request") }, explain: () => { throw new Error("No unmocked paid provider request") },
  })
  return { run, calls, reads, waits }
}

test("development lets Gemini plan complete questions before any local keyword routing", async () => {
  const input = "last month biggest ec[penses — can you make sense of that?"
  const h = harness({ responses: [plan(query({ intent: "largest", start: "2026-09-01", end: "2026-10-01" })), explain("Here are the largest recorded test expenses for {{q0_period}}.")] })
  const response = await h.run(request(payload(input)))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.source, "gemini_development")
  assert.equal(body.fictionalDataOnly, true)
  assert.equal(h.calls[0].context.messages[0].content, input)
  assert.equal(h.calls.length, 2)
  assert.equal(h.reads.length, 1)
  assert.equal(h.reads[0].uid, uid)
  assert.equal(h.reads[0].range.start, "2026-09-01")
  assert.match(body.answer, /₹6,000/)
  assert.ok(!body.answer.includes("30,000"))
  assert.equal(h.calls[0].body.generationConfig.thinkingConfig.thinkingLevel, "LOW")
  assert.equal(h.calls[1].body.generationConfig.thinkingConfig.thinkingLevel, "LOW")
  assert.match(h.calls[0].url, /gemini-3\.8-flash:generateContent/)
  assert.equal(h.calls[0].configuration.httpOptions.timeout, 16000)
})

test("example A preserves full multi-turn history, changes periods, explains drivers and grounds reductions", async () => {
  const comparison = { comparisonStart: "2026-09-01", comparisonEnd: "2026-10-01" }
  const h = harness({ responses: [
    plan(query({ intent: "breakdown" })), explain("The largest categories are {{q0_c0_name}} at {{q0_c0_amount}} and {{q0_c1_name}} at {{q0_c1_amount}}."),
    plan(query({ intent: "breakdown", start: "2026-09-01", end: "2026-10-01", comparisonStart: "2026-10-01", comparisonEnd: "2026-11-01" })), explain("For {{q0_period}}, test spending was {{q0_current_expenses}}.", ["q0_expenses"]),
    plan(query({ intent: "comparison", task: "analyse", ...comparison })), explain("The recorded increase was {{q0_expense_change}}. The largest category contribution was {{q0_driver0}}; records do not establish the cause.", ["q0_expenses"]),
    plan(query({ intent: "breakdown", task: "reduce", ...comparison })), explain("Review flexible costs in {{q0_c1_name}}. A hypothetical reduction could free {{q0_c1_cut10}} over the requested period; essential costs may be inflexible."),
  ] })
  let context = null
  const history = []
  for (const content of ["Where did my money go?", "What about last month?", "Why did I spend more?", "How can I reduce it?"]) {
    const response = await h.run(request(payload(content, { context, messages: [...history, { role: "user", content }] })))
    assert.equal(response.status, 200)
    const result = await response.json()
    context = result.context
    history.push({ role: "user", content }, { role: "assistant", content: result.answer })
  }
  assert.equal(h.calls.length, 8)
  assert.equal(h.calls[2].context.sessionScope.queries[0].intent, "breakdown")
  assert.equal(h.calls[4].context.messages[1].role, "assistant")
  assert.equal(h.calls[5].context.facts.q0_expense_change.value, "+₹1,850")
  assert.match(h.calls[5].context.facts.q0_driver0.value, /Food & Dining.*1,150/)
  assert.equal(h.calls[5].body.generationConfig.thinkingConfig.thinkingLevel, "MEDIUM")
  assert.equal(h.calls[7].body.generationConfig.thinkingConfig.thinkingLevel, "MEDIUM")
  assert.match(history.at(-1).content, /₹395/)
  assert.equal(context.queries[0].start, "2026-10-01")
})

test("example B retains October 1–7 for Total and Only UPI transactions", async () => {
  const firstWeek = { start: "2026-10-01", end: "2026-10-08" }
  const h = harness({ responses: [plan(query({ ...firstWeek, intent: "list" })), explain("These records match {{q0_period}}."), plan(query(firstWeek)), explain("The total is {{q0_current_expenses}}."), plan(query({ ...firstWeek, method: "upi", intent: "list" })), explain("These are the matching UPI expense records.")] })
  let context = null, result
  const history = []
  for (const content of ["Give all expenses from the first week of October 2026.", "Total?", "Only UPI transactions."]) {
    const response = await h.run(request(payload(content, { context, messages: [...history, { role: "user", content }] })))
    assert.equal(response.status, 200)
    result = await response.json()
    context = result.context
    history.push({ role: "user", content }, { role: "assistant", content: result.answer })
  }
  assert.match(history[1].content, /₹10,900 total across 5 matching expenses/)
  assert.match(history[3].content, /₹10,900/)
  assert.match(result.answer, /₹4,400 total across 3 matching expenses/)
  assert.ok(!result.answer.includes("2026-10-08 ·"))
  assert.ok(!result.answer.includes("CASH"))
  for (const read of h.reads) assert.deepEqual(read.range.ranges, [{ start: firstWeek.start, end: firstWeek.end }])
  assert.equal(context.queries[0].method, "upi")
})

test("example C uses exact target and numerically consistent category savings scenarios", async () => {
  const h = harness({ responses: [plan(query({ task: "reduce", targetPaise: 200000 })), (context) => {
    assert.equal(context.facts.q0_saving0_amount.value, "₹1,200")
    assert.equal(context.facts.q0_saving1_amount.value, "₹790")
    assert.equal(context.facts.q0_saving2_amount.value, "₹10")
    assert.equal(context.facts.q0_scenario_total.value, "₹2,000")
    assert.equal(context.facts.q0_target_remaining.value, "₹0")
    return explain("If those costs are flexible, hypothetical cuts of {{q0_saving0_amount}}, {{q0_saving1_amount}} and {{q0_saving2_amount}} total {{q0_scenario_total}} over {{q0_period}}. These are not guaranteed monthly savings.")
  }] })
  const response = await h.run(request(payload("How can I save ₹2,000 every month?")))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.match(result.answer, /₹2,000/)
  assert.equal(result.context.queries[0].targetPaise, 200000)
  assert.equal(h.calls[1].body.generationConfig.thinkingConfig.thinkingLevel, "MEDIUM")
})

test("category comparisons and multi-part queries share one bounded retrieval and exact figures", async () => {
  const h = harness({ responses: [plan(query({ category: "Food & Dining" }), query({ category: "Transport" }), query({ intent: "income" })), explain("Food spending was {{q0_current_expenses}} and transport was {{q1_current_expenses}}, a difference of {{q0_q1_absolute_difference}}. Income was {{q2_current_income}}.", ["q0_q1"])] })
  const response = await h.run(request(payload("Compare food with transport this month, and show my income too.")))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.match(result.answer, /₹3,950.*₹250.*₹3,700.*₹30,000/)
  assert.equal(h.reads.length, 1)
  assert.equal(h.reads[0].range.ranges.length, 1)
  assert.equal(h.calls.length, 2)
  assert.equal(result.cards[0].previousPaise, 395000)
  assert.equal(result.cards[0].currentPaise, 25000)
  assert.equal(result.context.queries.length, 3)
})

test("development is explicitly configured and exact-UID allowlisted; ordinary accounts stay protected", async () => {
  for (const [settings, account, status, code] of [[{ ...env, GEMINI_DATA_HANDLING: "disabled" }, uid, 403, "DEVELOPMENT_ACCESS_DENIED"], [{ ...env, GEMINI_DATA_HANDLING: "paid" }, uid, 403, "DEVELOPMENT_ACCESS_DENIED"], [env, "ordinary-user", 403, "DEVELOPMENT_ACCESS_DENIED"], [env, uid + "-suffix", 403, "DEVELOPMENT_ACCESS_DENIED"], [{ ...env, GEMINI_DEVELOPMENT_DATA: "" }, uid, 503, "DEVELOPMENT_DATA_UNCONFIRMED"], [{ ...env, GEMINI_API_KEY: "" }, uid, 503, "GEMINI_KEY_MISSING"]]) {
    const h = harness({ settings, account })
    const response = await h.run(request(payload()))
    assert.equal(response.status, status)
    assert.equal((await response.json()).code, code)
    assert.equal(h.calls.length, 0)
    assert.equal(h.reads.length, 0)
  }
  const ordinary = harness({ account: "ordinary-user" })
  const caps = await (await ordinary.run(request({ action: "capabilities" }))).json()
  assert.equal(caps.mode, "protected")
  assert.ok(!JSON.stringify(caps).includes(uid))
  const local = await ordinary.run(request({ ...payload("How much did I spend this month?"), mode: "personal", consent: false }))
  assert.equal(local.status, 200)
  assert.equal((await local.json()).source, "local")
  assert.equal(ordinary.calls.length, 0)
})

test("authenticated capability discovery exposes no identities, allowlist, key or financial records", async () => {
  const h = harness()
  const response = await h.run(request({ action: "capabilities" }))
  assert.deepEqual(await response.json(), financeCapabilities(env, uid))
  assert.equal(h.calls.length, 0)
  assert.equal(h.reads.length, 0)
  assert.equal((await h.run(request({ action: "capabilities" }, { authorization: "" }))).status, 401)
  assert.equal((await h.run(request({ action: "capabilities", uid: "other" }))).status, 400)
})

test("consent, authentication and origin gates precede development SDK and financial access", async () => {
  const h = harness()
  assert.equal((await h.run(request({ ...payload(), consent: false }))).status, 403)
  assert.equal((await h.run(request(payload(), { authorization: "" }))).status, 401)
  assert.equal((await h.run(request(payload(), { origin: "https://attacker.example" }))).status, 403)
  const guest = harness({ verify: async () => { throw Object.assign(new Error("Guest accounts are not allowed"), { status: 401 }) } })
  assert.equal((await guest.run(request(payload()))).status, 401)
  assert.equal(h.calls.length, 0)
  assert.equal(h.reads.length, 0)
})

test("full development context strips credentials, Firebase identities, email, record names, notes and IDs", async () => {
  const input = `Where did my money go? uid=${uid}; email=fake@example.com; Bearer ${token}; api_key=${env.GEMINI_API_KEY}`
  const extra = record("PRIVATE-FIRESTORE-ID", 10, "2026-10-02", "category@example.com")
  const h = harness({ data: [...records, extra], responses: [plan(query({ intent: "breakdown" })), explain()] })
  const response = await h.run(request(payload(input)))
  assert.equal(response.status, 200)
  for (const call of h.calls) {
    const prompt = JSON.stringify(call.context)
    for (const forbidden of [uid, token, env.GEMINI_API_KEY, "fake@example.com", "category@example.com", "PRIVATE-PERSON", "PRIVATE-NOTE", "PRIVATE-FIRESTORE-ID"]) assert.ok(!prompt.includes(forbidden), forbidden)
  }
  assert.match(h.calls[0].context.messages[0].content, /Where did my money go/)
  assert.ok(h.calls[1].context.results[0].transactions.length > 0)
  assert.ok(h.calls[1].context.facts.q0_current_income)
  assert.ok(!Object.hasOwn(h.calls[1].context.results[0].transactions[0], "id"))
})

test("only verified UID controls retrieval, and client financial authority or database operations are rejected", async () => {
  const h = harness({ responses: [plan(query()), explain()], retrieve: async (args) => { assert.equal(args.uid, uid); assert.equal(args.token, token); return records } })
  assert.equal((await h.run(request(payload()))).status, 200)
  for (const extra of [{ uid: "other" }, { records }, { facts: { total: 999 } }, { query: "users/other" }]) assert.equal((await h.run(request({ ...payload(), ...extra }))).status, 400)
  for (const extra of [{ uid: "other" }, { path: "users/other" }, { method: "wire" }, { intent: "delete" }, { start: "2026-02-30" }, { start: "2020-01-01" }, { targetPaise: 1.1 }, { category: ["Food", "Transport"] }]) {
    const bad = harness({ responses: [plan(query(extra))] })
    assert.equal((await bad.run(request(payload()))).status, 502)
    assert.equal(bad.reads.length, 0)
  }
  const inventedTarget = harness({ responses: [plan(query({ task: "reduce", targetPaise: 300000 }))] })
  assert.equal((await inventedTarget.run(request(payload("How can I save ₹2,000?")))).status, 502)
  assert.equal(inventedTarget.reads.length, 0)
  assert.throws(() => validateDevelopmentPlan(plan(query(), query(), query(), query()), { now, timezone }))
})

test("development context accepts a local scope bridge and rejects client facts or identities", async () => {
  const context = conversationContextFromPlan(planFinancialQuestion("Food spending last month", [], { now, timezone }))
  const h = harness({ responses: [plan(query({ category: "Food & Dining", start: "2026-09-01", end: "2026-10-01", task: "reduce" })), explain()] })
  const response = await h.run(request(payload("How can I reduce it?", { context })))
  assert.equal(response.status, 200)
  assert.equal(h.calls[0].context.sessionScope.version, 2)
  assert.equal(h.calls[0].context.sessionScope.queries[0].category, "Food & Dining")
  const bad = harness()
  assert.equal((await bad.run(request(payload("Total?", { context: { version: 2, queries: [query()], facts: { expense: 999 } } })))).status, 400)
  assert.equal(bad.calls.length, 0)
})

test("transient Gemini 503 gets exactly one bounded retry, then succeeds without duplicate retrieval", async () => {
  const h = harness({ responses: [{ http: 503 }, plan(query()), { http: 503 }, explain()] })
  const response = await h.run(request(payload()))
  assert.equal(response.status, 200)
  assert.equal(h.calls.length, 4)
  assert.equal(h.waits.length, 2)
  assert.ok(h.waits.every((ms) => ms >= 250 && ms < 400))
  assert.equal(h.reads.length, 1)
  assert.equal(h.calls[0].configuration.httpOptions.retryOptions.attempts, 1)
})

test("exhausted 503 and non-transient failures surface sanitized provider errors with bounded attempts", async () => {
  const exhausted = harness({ responses: [{ http: 503 }, { http: 503 }] })
  const response = await exhausted.run(request(payload()))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.origin, "provider")
  assert.equal(body.providerStatus, 503)
  assert.ok(!body.error.includes("PRIVATE"))
  assert.equal(exhausted.calls.length, 2)
  assert.equal(exhausted.reads.length, 0)
  for (const status of [400, 403, 429]) {
    const h = harness({ responses: [{ http: status }] })
    const failed = await h.run(request(payload()))
    assert.equal((await failed.json()).origin, "provider")
    assert.equal(h.calls.length, 1)
    assert.equal(h.waits.length, 0)
  }
})

test("cancellation during retry backoff prevents another SDK request", async () => {
  let calls = 0
  const controller = new AbortController()
  await assert.rejects(() => generateDevelopmentJson({ env, uid, token, context: { question: "Test expenses" }, instructions: "Test", schema: { type: "object" }, signal: controller.signal,
    clientFactory: () => ({ models: { generateContent: async () => { calls++; throw Object.assign(new Error("temporary"), { status: 503 }) } } }), wait: async () => controller.abort(),
  }), { name: "AbortError" })
  assert.equal(calls, 1)
})

test("invented financial figures, malformed cards and unknown facts fail closed after calculation", async () => {
  for (const output of [explain("You spent ₹999."), explain("{{q0_fabricated}}"), explain("Recorded expenses changed.", ["unknown"]), { ...explain(), records: [] }]) {
    const h = harness({ responses: [plan(query()), output] })
    const response = await h.run(request(payload()))
    assert.equal(response.status, 502)
    assert.equal((await response.json()).code, "GEMINI_OUTPUT_INVALID")
    assert.equal(h.calls.length, 2)
    assert.equal(h.reads.length, 1)
  }
})

test("empty data remains empty, bounded lists disclose omissions, and no cross-user financial cache exists", async () => {
  const empty = harness({ data: [], responses: [plan(query()), explain("There are no recorded test expenses in the requested scope.")] })
  assert.equal((await empty.run(request(payload()))).status, 200)
  assert.equal(empty.calls[1].context.results[0].empty, true)
  const many = harness({ data: Array.from({ length: 60 }, (_, i) => record(`row-${i}`, 1, "2026-10-02")), responses: [plan(query({ intent: "list" })), explain("Here are the matching test expense records.")] })
  const result = await (await many.run(request(payload("List all expenses this month")))).json()
  assert.match(result.answer, /Showing 50 of 60/)
  assert.match(result.answer, /₹60 total/)
  const another = harness({ account: "another-test", settings: { ...env, GEMINI_DEVELOPMENT_UIDS: uid + ",another-test" }, data: [record("other", 77, "2026-10-01")], responses: [plan(query()), explain()] })
  const other = await (await another.run(request(payload()))).json()
  assert.match(other.answer, /₹77/)
  assert.ok(!other.answer.includes("11,100"))
  assert.equal(another.reads[0].uid, "another-test")
})

test("development uses the existing per-UID concurrency guard before another provider request", async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ responses: [async () => { await gate; return plan(query()) }, explain()] })
  const first = h.run(request(payload()))
  await new Promise((resolve) => setTimeout(resolve, 10))
  const duplicate = await h.run(request(payload()))
  assert.equal(duplicate.status, 429)
  assert.equal((await duplicate.json()).code, "AI_REQUEST_BUSY")
  assert.equal(h.calls.length, 1)
  assert.equal(h.reads.length, 0)
  release()
  assert.equal((await first).status, 200)
  assert.equal(h.calls.length, 2)
  assert.equal(h.reads.length, 1)
})
