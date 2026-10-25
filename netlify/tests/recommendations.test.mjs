import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { generateDevelopmentJson } from "../lib/geminiFinance.js"
import { calculateHypotheticalReduction, requestedReductions } from "../lib/developmentScenarios.js"
import { validateDevelopmentResponse } from "../lib/developmentResponse.js"
import { resolveAnswer, MAX_MONEY_PAISE } from "../../src/features/finance-ai/financialContext.js"
import { createFinanceChatClient } from "../../src/services/financeChatClient.js"
import { answerFinanceQuestion } from "../../src/features/finance-ai/chatOrchestrator.js"

const uid = "PRIVATE-test-alice", token = "PRIVATE-test-token"
const now = new Date("2026-10-25T10:00:00Z"), timezone = "Asia/Kolkata"
const env = { FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example", GEMINI_API_KEY: "PRIVATE-test-key", GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid }
const tx = (id, amount, category, month = "10") => ({ id, type: "expense", amount, category, paymentMethod: "upi", datetime: `2026-${month}-02T10:00:00Z`, person: "PRIVATE-person", note: "PRIVATE-note" })
const records = [tx("PRIVATE-food", 5454, "Food & Dining"), tx("PRIVATE-housing", 5000, "Housing"), tx("PRIVATE-shopping", 3500, "Shopping"), tx("PRIVATE-other", 300, "Other"), tx("PRIVATE-prior-food", 4600, "Food & Dining", "09"), tx("PRIVATE-prior-housing", 5000, "Housing", "09"), tx("PRIVATE-prior-shopping", 2000, "Shopping", "09"), tx("PRIVATE-prior-other", 400, "Other", "09")]
const query = (extra = {}) => ({ intent: "breakdown", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, task: "answer", targetPaise: null, ...extra })
const plan = (extra) => ({ status: "resolved", queries: [query(extra)] })
const answer = (text) => ({ answer: text, cardIds: [] })
const sections = (...items) => ({ sections: items.map(([kind, text]) => ({ kind, text })), cardIds: [] })
const advice = () => sections(["recommendation", "One practical change is to review optional purchases before committing. Which costs are flexible? Protect essential expenses."])
const hypothetical = () => sections(["recorded", "Recorded {{q0_category}} expenses were {{q0_current_expenses}} for {{q0_period}}."], ["hypothetical", "A {{q0_reduction_rate}} cut would free {{q0_reduction_amount}}, leaving {{q0_reduction_remaining}} in this scope. This is not guaranteed monthly savings."])

function app(steps, { retrieve, data = records } = {}) {
  const calls = [], reads = [], responses = []
  const clientFactory = (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (url, init) => {
    assert.match(String(url), /gemini-3\.1-flash-lite:generateContent/)
    const body = JSON.parse(init.body), context = JSON.parse(body.contents[0].parts[0].text)
    calls.push({ body, context })
    const step = steps.shift()
    assert.ok(step, "Every provider call requires an explicit mock")
    if (step.http) return Response.json({ error: { code: step.http, message: "PRIVATE-provider-message", status: "UNAVAILABLE" } }, { status: step.http })
    const output = typeof step === "function" ? step(context) : step
    const text = Object.hasOwn(output, "rawText") ? output.rawText : JSON.stringify(output)
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text }] } }] })
  } } })
  const handler = createChatHandler({ env, now: () => now.getTime(), verifyToken: async () => uid,
    retrieve: async (request) => { reads.push(request); return retrieve ? retrieve(request) : data },
    development: (request) => runDevelopmentConversation({ ...request, generate: (args) => generateDevelopmentJson({ ...args, clientFactory, wait: async () => {} }) }),
  })
  const user = { uid, isAnonymous: false, getIdToken: async () => token }
  const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async (path, init) => {
    const response = await handler(new Request(`${env.AI_ALLOWED_ORIGIN}${path}`, { ...init, headers: { ...init.headers, origin: env.AI_ALLOWED_ORIGIN } }))
    responses.push(await response.clone().json())
    return response
  } })
  const index = { timezone, get records() { throw new Error("Must not use a local answer") }, get categoryNames() { throw new Error("Must not run local intent recognition") } }
  return { calls, reads, responses, ask: (question, extra = {}) => answerFinanceQuestion({ question, now, index, consent: true, requestRoute: (request) => client.requestRoute({ user, ...request }), ...extra }) }
}

test("monthly summary → grounded recommendations → shopping scenario → last month runs through the real client, handler and SDK", async () => {
  const a = app([
    plan(), sections(["recorded", "Your recorded spending for {{q0_period}} was {{q0_current_expenses}}. {{q0_c0_name}} accounted for {{q0_c0_amount}}." ]),
    plan({ task: "reduce" }), sections(["recorded", "Recorded spending remains {{q0_current_expenses}} for {{q0_period}}."], ["recommendation", "One practical change is to review optional {{q0_c2_name}} purchases before committing. Compare flexible costs with essentials; which could you change?"], ["recommendation", "Plan meals around what you already have and compare alternatives when practical. Protect essential costs."]),
    plan({ category: "Shopping", task: "reduce", reductionBps: 2000 }), hypothetical(),
    plan({ category: "Shopping", task: "reduce", reductionBps: 2000, start: "2026-09-01", end: "2026-10-01" }), hypothetical(),
  ])
  const questions = ["Where did my money go?", "How can I reduce it?", "What if I reduce shopping by 20%?", "What about last month?"]
  let context = null
  const history = [], results = []
  for (const question of questions) {
    const result = await a.ask(question, { history, context })
    assert.equal(result.source, "gemini_development")
    assert.equal(result.cloud.correctionAttempted, false)
    context = result.context
    results.push(result)
    history.push({ role: "user", content: question }, { role: "assistant", content: result.answer })
  }
  assert.match(results[0].answer, /₹14,254/)
  assert.match(results[1].answer, /One practical change.*Shopping/)
  assert.match(results[2].answer, /Hypothetical estimate.*not recorded savings/)
  assert.match(results[2].answer, /20%.*₹700.*₹2,800/)
  assert.match(results[3].answer, /20%.*₹400.*₹1,600/)
  assert.equal(context.queries[0].start, "2026-09-01")
  assert.equal(context.queries[0].category, "Shopping")
  assert.equal(context.queries[0].reductionBps, 2000)
  assert.equal(a.calls[6].context.sessionScope.queries[0].reductionBps, 2000)
  assert.equal(a.calls[2].context.messages[1].role, "assistant")
  assert.equal(a.calls[3].context.facts.q0_current_expenses.value, "₹14,254")
  assert.equal(a.calls[5].context.facts.q0_reduction_amount.kind, "hypothetical")
  assert.deepEqual(a.calls[1].body.generationConfig.responseJsonSchema.required, ["answer"])
  assert.equal(a.calls.length, 8)
  assert.equal(a.reads.length, 4)
  assert.ok(a.reads.every((read) => read.uid === uid && read.token === token))
  for (const call of a.calls) assert.equal(JSON.stringify(call.context).includes("PRIVATE-"), false)
})

test("qualitative recommendation language and counts of proposed improvements do not require transaction references", () => {
  assert.throws(() => resolveAnswer("One practical change is to review optional purchases.", {}), { validationRule: "figure_unverified" }) // original strict guard
  for (const text of ["One practical change is to review optional purchases.", "Here are three useful improvements to consider.", "Review your budget because comparing options can help you make a plan.", "Ask which costs are flexible before choosing reductions."]) {
    assert.equal(validateDevelopmentResponse(sections(["recommendation", text]), { facts: {}, cardMap: {} }).answer, text)
  }
  for (const text of ["You spent two thousand rupees.", "You recorded three purchases.", "You could save ₹2,000.", "Reduce spending by 20%.", "1. Review purchases."]) {
    assert.throws(() => validateDevelopmentResponse(sections(["recommendation", text]), { facts: {}, cardMap: {} }), { code: "GEMINI_NUMERIC_UNVERIFIED" })
  }
})

test("all requested recommendation questions can receive genuine pipeline explanations without an extra call", async () => {
  for (const question of ["How can I reduce it?", "Where can I save money?", "What spending should I cut?", "Suggest three improvements.", "Which expenses are unnecessary?"]) {
    const a = app([plan({ task: "reduce" }), advice()])
    const result = await a.ask(question, { context: { version: 2, queries: [query()] } })
    assert.equal(result.source, "gemini_development")
    assert.match(result.answer, /Which costs are flexible/)
    assert.equal(a.calls.length, 2)
    assert.equal(a.reads.length, 1)
  }
  const a = app([plan({ task: "reduce", targetPaise: 200000 }), (context) => {
    assert.equal(context.facts.q0_scenario_total.value, "₹2,000")
    return sections(["hypothetical", "If flexible costs permit these cuts, the proposed total is {{q0_scenario_total}} over {{q0_period}}. Feasibility is unknown; this is not guaranteed monthly savings."], ["recommendation", "Review optional costs before protecting a monthly target. Which expenses can change?"])
  }])
  const result = await a.ask("How can I save ₹2,000 every month?")
  assert.match(result.answer, /Hypothetical estimate.*not recorded savings/)
  assert.match(result.answer, /₹2,000/)
  assert.equal(result.context.queries[0].targetPaise, 200000)
})

test("percentage reductions use exact integer paise with consistent remaining amounts", () => {
  for (const [paise, bps, saving] of [[350000, 2000, 70000], [200000, 2000, 40000], [101, 5000, 51], [1, 5000, 1], [999, 0, 0], [999, 10000, 999], [123456, 1250, 15432], [MAX_MONEY_PAISE, 3333, 2999700000000]]) {
    const result = calculateHypotheticalReduction(paise, bps)
    assert.equal(result.savingPaise, saving)
    assert.equal(result.savingPaise + result.remainingPaise, paise)
  }
  for (const [paise, bps] of [[-1, 2000], [1.1, 2000], [MAX_MONEY_PAISE + 1, 2000], [100, -1], [100, 10001], [100, 2.5]]) assert.throws(() => calculateHypotheticalReduction(paise, bps))
  const messages = [{ role: "user", content: "What if I reduce it by 12.50%?" }]
  assert.deepEqual([...requestedReductions(messages, { queries: [{ reductionBps: 2000 }] })], [2000, 1250])
  for (const content of ["Cut by -20%", "Cut by 20.123%", "Cut by 200%", "Cut by 1,000% "]) assert.equal(requestedReductions([{ content }], null).size, 0)
})

test("one correction gets precise numeric feedback and the same facts, without another retrieval or leaked rejected text", async () => {
  const a = app([plan({ task: "reduce" }), answer("PRIVATE-rejected-answer claims ₹999."), (context) => {
    assert.equal(context.validationFeedback.rule, "figure_unverified")
    assert.equal(context.facts.q0_current_expenses.value, "₹14,254")
    assert.equal(JSON.stringify(context).includes("PRIVATE-rejected-answer"), false)
    return advice()
  }])
  const result = await a.ask("How can I reduce it?")
  assert.equal(result.cloud.correctionAttempted, true)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
  const { validationFeedback, ...correctedContext } = a.calls[2].context
  assert.equal(validationFeedback.stage, "explanation")
  assert.deepEqual(correctedContext, a.calls[1].context)
})

test("invalid JSON and invalid response schema each get one bounded correction", async () => {
  for (const [invalid, rule] of [[{ rawText: "PRIVATE-malformed-JSON" }, "json_invalid"], [{ answer: [] }, "narrative_type"], [answer("{{unknown}}"), "fact_unknown"]]) {
    const a = app([plan(), invalid, (context) => { assert.equal(context.validationFeedback.rule, rule); return answer("Recorded expenses were {{q0_current_expenses}}.") }])
    assert.equal((await a.ask("Where did my money go?")).cloud.correctionAttempted, true)
    assert.equal(a.reads.length, 1)
    assert.equal(a.calls.length, 3)
  }
})

test("exhausted corrections surface the exact safe rule through the actual client, not a provider error or local answer", async () => {
  const bad = sections(["recommendation", "You spent ₹999 because PRIVATE-motivation."])
  const a = app([plan(), bad, bad])
  await assert.rejects(() => a.ask("How can I reduce it?"), (error) => {
    assert.equal(error.origin, "model_output")
    assert.equal(error.code, "GEMINI_NUMERIC_UNVERIFIED")
    assert.equal(error.retryable, true)
    assert.match(error.message, /^Response validation:/)
    assert.deepEqual(error.validation, { stage: "explanation", rule: "figure_unverified", correctionAttempted: true })
    assert.equal(error.providerStatus, undefined)
    return true
  })
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
  assert.equal(Object.hasOwn(a.responses[0], "answer"), false)
  assert.equal(JSON.stringify(a.responses[0]).includes("PRIVATE-"), false)
})

test("invented causes, achieved savings and scenario values masquerading as recorded facts are rejected", () => {
  const facts = { total: { value: "₹3,500", kind: "recorded" }, cut: { value: "₹700", kind: "hypothetical", period: "October 2026" } }
  for (const [output, rule] of [
    [sections(["recorded", "Your spending of {{total}} increased because you bought impulsively."]), "personal_cause_unsupported"],
    [sections(["recommendation", "Your shopping is unnecessary."]), "personal_classification_unsupported"],
    [sections(["recorded", "Your recorded savings are {{cut}}."]), "scenario_claim_unsupported"],
    [sections(["recorded", "Your recorded expenses are {{cut}}."]), "fact_kind_mismatch"],
    [sections(["hypothetical", "You already saved {{cut}}."]), "scenario_claim_unsupported"],
    [sections(["hypothetical", "You saved {{total}}."]), "scenario_claim_unsupported"],
    [sections(["hypothetical", "Spending was {{total}}."]), "fact_required"],
    [sections(["recorded", "You spend too much on leisure."]), "fact_required"],
    [sections(["recommendation", "Try a cut of {{cut}}."]), "fact_kind_mismatch"],
  ]) assert.throws(() => validateDevelopmentResponse(output, { facts, cardMap: {} }), (error) => error.validation.rule === rule && error.origin === "model_output")
  const result = validateDevelopmentResponse(sections(["hypothetical", "This could free {{cut}}; these are not recorded savings."]), { facts, cardMap: {} })
  assert.match(result.answer, /Hypothetical estimate for October 2026/)
})

test("the single correction budget is shared by planning and explanation", async () => {
  const a = app([{ status: "resolved" }, plan(), answer("You spent ₹999.")])
  await assert.rejects(() => a.ask("Where did my money go?"), (error) => error.validation.rule === "figure_unverified" && error.validation.correctionAttempted)
  assert.equal(a.calls.length, 3)
  assert.equal(a.calls[1].context.validationFeedback.stage, "planning")
  assert.equal(a.reads.length, 1)
})

test("provider failures, tool failures and conversation failures never trigger output correction", async () => {
  for (const [status, steps, calls] of [[429, [{ http: 429 }], 1], [503, [{ http: 503 }, { http: 503 }], 2]]) {
    const a = app(steps)
    await assert.rejects(() => a.ask("Where did my money go?"), (error) => error.origin === "provider" && error.providerStatus === status && /Gemini provider:/.test(error.message))
    assert.equal(a.calls.length, calls)
    assert.equal(a.reads.length, 0)
    assert.ok(a.calls.every((call) => !call.context.validationFeedback))
  }
  const tools = app([plan()], { retrieve: async () => { throw new Error("PRIVATE-tool-data") } })
  await assert.rejects(() => tools.ask("Where did my money go?"), (error) => error.origin === "tool" && error.code === "FINANCIAL_TOOL_FAILED" && !error.message.includes("PRIVATE"))
  assert.equal(tools.calls.length, 1)
  const state = app([])
  await assert.rejects(() => state.ask("What about last month?", { context: { version: 2, queries: [], privateTotal: 999 } }), { origin: "conversation", code: "DEVELOPMENT_CONTEXT_INVALID" })
  assert.equal(state.calls.length, 0)
})

test("invented scenario percentages and targets cannot reach financial tools", async () => {
  for (const [extra, question, rule] of [[{ reductionBps: 3000 }, "What if I reduce shopping by 20%?", "unrequested_reduction"], [{ targetPaise: 300000 }, "How can I save ₹2,000?", "unrequested_target"]]) {
    const a = app([plan({ category: "Shopping", task: "reduce", ...extra })])
    await assert.rejects(() => a.ask(question), (error) => error.origin === "model_output" && error.validation.rule === rule && !error.validation.correctionAttempted)
    assert.equal(a.calls.length, 1)
    assert.equal(a.reads.length, 0)
  }
})

test("an empty category produces a labelled zero scenario, never an invented recorded saving", async () => {
  const a = app([plan({ category: "Shopping", task: "reduce", reductionBps: 2000 }), hypothetical()], { data: [] })
  const result = await a.ask("What if I reduce shopping by 20%?")
  assert.match(result.answer, /20%.*₹0.*₹0/)
  assert.match(result.answer, /Hypothetical estimate/)
  assert.equal(a.calls[1].context.results[0].empty, true)
})

test("a requested percentage scenario cannot be replaced with generic advice or a different default cut", async () => {
  const a = app([plan({ category: "Shopping", task: "reduce", reductionBps: 1250 }), advice(), (context) => {
    assert.equal(context.validationFeedback.rule, "scenario_result_missing")
    assert.deepEqual(context.requiredFactKeys, ["q0_reduction_rate", "q0_reduction_amount"])
    assert.equal(Object.hasOwn(context.facts, "q0_c0_cut10"), false)
    assert.equal(Object.hasOwn(context.facts, "q0_cut20_rate"), false)
    return hypothetical()
  }])
  const result = await a.ask("What if I reduce shopping by 12.5%?")
  assert.match(result.answer, /12\.5%.*₹437\.50\b.*₹3,062\.50\b/)
  assert.equal(result.cloud.correctionAttempted, true)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
})
