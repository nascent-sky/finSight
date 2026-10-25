import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { generateDevelopmentJson, explainWithGemini } from "../lib/geminiFinance.js"
import { createFinancialIndex, analyseFinancialQuery } from "../../src/features/finance-ai/financialEngine.js"
import { validateInterpretedIntent } from "../../src/features/finance-ai/questionPlanner.js"
import { createFinanceChatClient } from "../../src/services/financeChatClient.js"
import { financeSourceLabel, isVerifiedNarrativeRecovery, validateDevelopmentAnswer } from "../../src/features/finance-ai/financeRouting.js"
import { buildNarrativeEvidence, verifiedStatusFacts, assertNarrativeConsistent, verifiedEvidenceStatement } from "../lib/narrativeConsistency.js"
import { validateDevelopmentResponse } from "../lib/developmentResponse.js"

const uid = "PRIVATE-uid", token = "PRIVATE-token", now = new Date("2026-10-25T12:00:00Z")
const env = { GEMINI_API_KEY: "PRIVATE-key", GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid, FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const records = [[2000, "Education"], [1200, "Shopping"], [930, "Transport"], [840, "Food & Dining"], [360, "Entertainment"], ...[200, 150, 130, 120, 110, 90.3, 80, 43.7].map((amount) => [amount, "Other"])].map(([amount, category], i) => ({ id: `PRIVATE-record-${i}`, amount, category, datetime: `2026-10-${String(i + 1).padStart(2, "0")}T12:00:00Z`, type: "expense", paymentMethod: "upi", note: "PRIVATE-note", person: "PRIVATE-person" }))
records.push({ id: "PRIVATE-previous", amount: 400, category: "Food & Dining", datetime: "2026-09-03T12:00:00Z", type: "expense", paymentMethod: "upi" })
const index = createFinancialIndex(records, { now, timezone: "UTC" })
const query = (extra = {}) => ({ intent: "largest", start: "2026-10-01", end: "2026-11-01", comparisonStart: "", comparisonEnd: "", category: "", method: "", task: "answer", targetPaise: 0, reductionBps: -1, ...extra })
const plan = (extra) => ({ status: "resolved", guideId: "", queries: [query(extra)] })
function receipt(extra = {}) {
  const p = validateInterpretedIntent({ status: "resolved", intent: "largest", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, explain: true, reference: false, ...extra }, { now, timezone: "UTC" })
  const analysis = analyseFinancialQuery(index, p), evidence = [buildNarrativeEvidence(index, p, analysis)]
  const facts = { ...Object.fromEntries(Object.entries(analysis.facts).map(([key, value]) => [`q0_${key}`, { ...value, kind: "recorded" }])), ...verifiedStatusFacts(evidence) }
  return { p, analysis, evidence, facts }
}
const contradiction = "For the requested period, there are no recorded transactions available to display your largest expenses."

test("verified summaries use singular and plural record nouns with complete sentences", () => {
  const single = receipt({ intent: "expenses", category: "Education" })
  assert.equal(verifiedEvidenceStatement(single.evidence[0]), "I found 1 recorded expense for October 2026 · Education, totalling ₹2,000.")
  const plural = receipt()
  assert.match(verifiedEvidenceStatement(plural.evidence[0]), /^I found 13 recorded expenses for October 2026/)
})

function app(steps) {
  const calls = [], reads = [], responses = []
  const factory = (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (_, init) => {
    const body = JSON.parse(init.body), context = JSON.parse(body.contents[0].parts[0].text)
    calls.push({ body, context })
    if (context.authoritativeEvidence) {
      assert.deepEqual(body.generationConfig.responseJsonSchema.required, ["answer"])
      assert.deepEqual(Object.keys(body.generationConfig.responseJsonSchema.properties), ["answer", "blockIds"])
    }
    const step = steps.shift()
    assert.ok(step, "Every actual SDK request must be expected")
    if (step.http) return Response.json({ error: { code: step.http, status: "RESOURCE_EXHAUSTED", message: "PRIVATE-provider" } }, { status: step.http })
    const output = typeof step === "function" ? step(context) : step
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: output.raw ?? JSON.stringify(output) }] } }] })
  } } })
  const handler = createChatHandler({ env, now: () => now.getTime(), verifyToken: async () => uid, retrieve: async (args) => { reads.push(args); return records }, development: (args) => runDevelopmentConversation({ ...args, generate: (request) => generateDevelopmentJson({ ...request, clientFactory: factory, wait: async () => {} }) }) })
  const user = { uid, isAnonymous: false, getIdToken: async () => token }
  const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async (path, init) => {
    const response = await handler(new Request(`${env.AI_ALLOWED_ORIGIN}${path}`, { ...init, headers: { ...init.headers, origin: env.AI_ALLOWED_ORIGIN } }))
    responses.push(await response.clone().json()); return response
  } })
  return { calls, reads, responses, ask: (question = "Show my biggest expenses", extra = {}) => client.requestRoute({ user, consent: true, timezone: "UTC", messages: [{ role: "user", content: question }], ...extra }) }
}

test("the exact reproduction is valid JSON but fails factual validation against 13 expenses totalling ₹6,254", () => {
  const { evidence, facts } = receipt()
  assert.equal(evidence[0].current.recordCount, 13)
  assert.equal(evidence[0].current.expenseTotalPaise, 625400)
  assert.equal(evidence[0].rankedTransactions.length, 5)
  assert.deepEqual(evidence[0].rankedTransactions.map((row) => row.amountPaise), [200000, 120000, 93000, 84000, 36000])
  assert.throws(() => validateDevelopmentResponse({ answer: contradiction }, { facts, cardMap: {}, evidence }), (error) => error.code === "GEMINI_NARRATIVE_CONTRADICTION" && error.validation.rule === "narrative_records_contradiction" && error.validation.field === "answer")
})

test("targeted predicates validate record presence, category scopes, zero amounts and individual-versus-total references", () => {
  const { evidence, facts } = receipt()
  for (const [text, rule] of [
    [contradiction, "narrative_records_contradiction"], ["You spent nothing in this period.", "narrative_records_contradiction"],
    ["Your expenses were zero.", "narrative_records_contradiction"], ["No Shopping expenses were recorded.", "narrative_records_contradiction"],
    ["There is no spending in {{q0_c0_name}}.", "narrative_records_contradiction"], ["Your expenses were {{q0_current_income}}.", "narrative_metric_contradiction"],
    ["Your biggest expense was {{q0_c0_amount}}.", "narrative_role_contradiction"], ["November spending was {{q0_current_expenses}}.", "narrative_scope_contradiction"],
    ["No {{q0_record_status}}", "narrative_records_contradiction"],
  ]) assert.throws(() => assertNarrativeConsistent(text, evidence, facts), (error) => error.validation.rule === rule, text)
  for (const text of ["Review optional purchases before choosing a limit.", "Consider alternatives without cutting essential costs.", "If there are no transactions, check whether the selected period is correct.", "Expenses could be lower if suitable alternatives exist.", "{{q0_record_status}}", "There is no recorded income, but expenses were {{q0_current_expenses}}."]) assert.doesNotThrow(() => assertNarrativeConsistent(text, evidence, facts), text)
})

test("empty periods and empty categories remain valid, but fabricated presence is rejected", () => {
  for (const extra of [{ start: "2026-08-01", end: "2026-09-01" }, { category: "Healthcare" }]) {
    const { evidence, facts } = receipt(extra)
    assert.equal(evidence[0].current.recordCount, 0)
    assert.doesNotThrow(() => assertNarrativeConsistent("No recorded expenses match this scope.", evidence, facts))
    assert.throws(() => assertNarrativeConsistent("Here are your largest recorded expenses.", evidence, facts), (error) => error.validation.rule === "narrative_records_contradiction")
  }
})

test("period/category-qualified claims and month-comparison direction follow the verified chronological frame", () => {
  const { evidence, facts } = receipt({ intent: "comparison", comparisonStart: "2026-09-01", comparisonEnd: "2026-10-01" })
  assert.doesNotThrow(() => assertNarrativeConsistent("There are no Shopping expenses in September.", evidence, facts))
  assert.throws(() => assertNarrativeConsistent("There are no Food & Dining expenses in September.", evidence, facts), (error) => error.validation.rule === "narrative_records_contradiction")
  assert.doesNotThrow(() => assertNarrativeConsistent("Recorded expenses increased.", evidence, facts))
  assert.doesNotThrow(() => assertNarrativeConsistent("A review may help you understand {{q0_current_expenses}} in recorded expenses.", evidence, facts))
  assert.doesNotThrow(() => assertNarrativeConsistent("Spending was {{q0_current_expenses}}, compared with {{q0_previous_expenses}}.", evidence, facts))
  assert.throws(() => assertNarrativeConsistent("Recorded expenses decreased.", evidence, facts), (error) => error.validation.rule === "narrative_direction_contradiction")
  assert.doesNotThrow(() => assertNarrativeConsistent("September 2026 expenses were lower than October 2026.", evidence, facts))
  assert.throws(() => assertNarrativeConsistent("September spending was {{q0_current_expenses}}.", evidence, facts), (error) => error.validation.rule === "narrative_scope_contradiction")
  assert.throws(() => assertNarrativeConsistent("September had {{q0_expense_count}} recorded expenses.", evidence, facts), (error) => error.validation.rule === "narrative_scope_contradiction")
  const reversed = receipt({ intent: "comparison", start: "2026-09-01", end: "2026-10-01", comparisonStart: "2026-10-01", comparisonEnd: "2026-11-01" })
  assert.throws(() => assertNarrativeConsistent("The increase was {{q0_expense_change}}.", reversed.evidence, reversed.facts), (error) => error.validation.rule === "narrative_direction_contradiction")
  const changedIndex = createFinancialIndex(records.map((row) => row.id === "PRIVATE-previous" ? { ...row, amount: 1000 } : row), { now, timezone: "UTC" })
  const categoryPlan = receipt({ intent: "comparison", comparisonStart: "2026-09-01", comparisonEnd: "2026-10-01" }).p
  const categoryEvidence = [buildNarrativeEvidence(changedIndex, categoryPlan, analyseFinancialQuery(changedIndex, categoryPlan))]
  assert.doesNotThrow(() => assertNarrativeConsistent("Food & Dining spending decreased.", categoryEvidence, facts))
  assert.throws(() => assertNarrativeConsistent("Food & Dining spending increased.", categoryEvidence, facts), (error) => error.validation.rule === "narrative_direction_contradiction")
  const missingCurrent = receipt({ intent: "comparison", start: "2026-08-01", end: "2026-09-01", comparisonStart: "2026-10-01", comparisonEnd: "2026-11-01" })
  assert.throws(() => assertNarrativeConsistent("There are no recorded transactions available.", missingCurrent.evidence, missingCurrent.facts), (error) => error.validation.rule === "narrative_records_contradiction")
  assert.doesNotThrow(() => assertNarrativeConsistent("There are no recorded transactions for the requested period.", missingCurrent.evidence, missingCurrent.facts))
})

test("conditional purchase-deferral estimates cannot become guaranteed recurring savings", () => {
  const { evidence, facts } = receipt()
  evidence[0].task = "reduce"
  const scenario = { ...facts, q0_scenario: { value: "₹360", kind: "hypothetical" } }
  for (const text of ["You will save {{q0_scenario}} every month.", "If a purchase is optional, you will save {{q0_scenario}} every month."]) assert.throws(() => assertNarrativeConsistent(text, evidence, scenario), (error) => error.validation.rule === "narrative_savings_contradiction")
  for (const text of ["If a similar purchase is optional, the hypothetical cut is {{q0_scenario}} for this scope.", "This is not guaranteed monthly savings.", "Consider building a regular savings habit."]) assert.doesNotThrow(() => assertNarrativeConsistent(text, evidence, scenario))
})

test("the SDK receives current counts, exact scope and actual bounded rankings; one repair reuses identical evidence", async () => {
  const a = app([plan(), (context) => {
    const current = context.authoritativeEvidence[0].current
    assert.equal(current.recordCount, 13)
    assert.equal(current.hasRecords, true)
    assert.equal(current.expenseTotalPaise, 625400)
    assert.equal(current.start, "2026-10-01")
    assert.equal(current.end, "2026-11-01")
    assert.equal(context.results[0].transactions.length, 5)
    assert.equal(context.results[0].recordCount, 13)
    assert.equal(context.results[0].omittedCount, 8)
    assert.equal(context.facts.q0_expense_count.value, "13")
    return { answer: contradiction }
  }, { answer: "{{q0_record_status}}" }])
  const result = await a.ask(undefined, { messages: [{ role: "assistant", content: "Old history incorrectly said no records were available." }, { role: "user", content: "Show my biggest expenses" }] })
  assert.equal(result.source, "gemini_development")
  assert.match(result.answer, /13 recorded expenses.*₹6,254/)
  assert.equal(result.cloud.correctionAttempted, true)
  assert.equal(a.calls[2].context.validationFeedback.rule, "narrative_records_contradiction")
  const { validationFeedback, ...repairContext } = a.calls[2].context
  assert.equal(validationFeedback.field, "answer")
  assert.deepEqual(repairContext, a.calls[1].context)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
  for (const call of a.calls) assert.doesNotMatch(JSON.stringify(call.context), /PRIVATE-/)
})

test("exhausted factual repair returns verified blocks with an honest local label and retained scope", async () => {
  const a = app([plan(), { answer: contradiction }, { answer: contradiction }])
  const result = await a.ask()
  assert.equal(result.source, "local_verified")
  assert.equal(isVerifiedNarrativeRecovery(result), true)
  assert.doesNotMatch(financeSourceLabel(result.source), /Gemini-generated/)
  assert.equal(result.cloud.status, "unavailable")
  assert.equal(result.recovery.repairAttempted, true)
  assert.equal(result.recovery.retryable, true)
  assert.equal(result.context.queries[0].start, "2026-10-01")
  assert.match(result.answer, /13 recorded expenses.*₹6,254/)
  assert.doesNotMatch(result.answer, /no recorded transactions/)
  const list = result.presentation.blocks.find((block) => block.type === "ranked_expenses")
  assert.equal(list.items.length, 5)
  assert.equal(list.totalCount, 13)
  assert.equal(list.totalPaise, 625400)
  assert.equal(list.items[0].category, "Education")
  assert.equal(list.items[0].amountPaise, 200000)
  assert.equal(list.items[4].category, "Entertainment")
  assert.equal(list.items[4].amountPaise, 36000)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
  validateDevelopmentAnswer(result)
  assert.throws(() => validateDevelopmentAnswer({ ...result, recovery: undefined }), { code: "DEVELOPMENT_RESPONSE_MISMATCH" })
})

test("a failed repair can recover, but provider failures without a contradiction remain visible errors", async () => {
  for (const repair of [{ answer: "" }, { raw: "PRIVATE-broken-json" }, { http: 429 }]) {
    const a = app([plan(), { answer: contradiction }, repair])
    const result = await a.ask()
    assert.equal(result.source, "local_verified")
    assert.equal(result.recovery.repairAttempted, true)
    assert.equal(a.calls.length, 3)
    assert.equal(a.reads.length, 1)
    assert.doesNotMatch(JSON.stringify(a.responses), /PRIVATE-/)
  }
  const failed = app([{ http: 429 }])
  await assert.rejects(() => failed.ask(), { code: "GEMINI_RATE_LIMITED", origin: "provider" })
  assert.equal(failed.reads.length, 0)
})

test("a spent planning correction budget prevents another repair and falls back to the same verified results", async () => {
  const a = app([{ status: "resolved", queries: [] }, plan(), { answer: contradiction }])
  const result = await a.ask()
  assert.equal(result.source, "local_verified")
  assert.equal(result.recovery.repairAttempted, false)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
})

test("paid explanations use the same consistency recovery with no provider configuration changes", async () => {
  const { p, analysis } = receipt()
  let calls = 0
  const result = await explainWithGemini({ env: { ...env, GEMINI_DATA_HANDLING: "paid" }, plan: p, analysis, financialIndex: index, questions: ["Show my biggest expenses"], clientFactory: () => ({ models: { generateContent: async (request) => {
    calls++
    assert.equal(request.model, "gemini-3.1-flash-lite")
    assert.deepEqual(request.config.responseJsonSchema.required, ["answer"])
    return { text: JSON.stringify({ answer: contradiction }), candidates: [{ finishReason: "STOP" }] }
  } } }) })
  assert.equal(result.source, "local_verified")
  assert.equal(result.cloud.status, "unavailable")
  assert.equal(calls, 2)
})
