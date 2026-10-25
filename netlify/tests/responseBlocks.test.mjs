import test from "node:test"
import assert from "node:assert/strict"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { generateDevelopmentJson } from "../lib/geminiFinance.js"
import { validateDevelopmentResponse } from "../lib/developmentResponse.js"
import { createFinanceChatClient } from "../../src/services/financeChatClient.js"
import { answerFinanceQuestion } from "../../src/features/finance-ai/chatOrchestrator.js"
import { validateResponsePresentation } from "../../src/features/finance-ai/responseBlocks.js"

const uid = "PRIVATE-allowlisted-uid", token = "PRIVATE-id-token", now = new Date("2026-10-24T12:00:00Z")
const env = { GEMINI_API_KEY: "PRIVATE-key", GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid, FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const row = (id, amount, month, category) => ({ id, amount, datetime: `2026-${month}-02T10:00:00Z`, category, type: "expense", paymentMethod: "upi", person: "PRIVATE-person", note: "PRIVATE-note" })
const records = [row("PRIVATE-food", 3450, "10", "Food & Dining"), row("PRIVATE-shopping", 900, "10", "Shopping"), row("PRIVATE-previous", 2800, "09", "Food & Dining")]
const query = (extra = {}) => ({ intent: "expenses", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, task: "answer", targetPaise: null, ...extra })
const plan = (extra) => ({ status: "resolved", queries: [query(extra)] })
const output = (...blocks) => ({ blocks, cardIds: [] })

function app(steps, data = records) {
  const calls = [], reads = []
  const clientFactory = (options) => new GoogleGenAI({ ...options, httpOptions: { ...options.httpOptions, fetch: async (_, init) => {
    const body = JSON.parse(init.body), context = JSON.parse(body.contents[0].parts[0].text)
    calls.push({ body, context })
    const step = steps.shift()
    assert.ok(step, "Every provider call requires an explicit mock")
    const result = typeof step === "function" ? step(context) : step
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: JSON.stringify(result) }] } }] })
  } } })
  const handler = createChatHandler({ env, now: () => now.getTime(), verifyToken: async () => uid, retrieve: async (request) => { reads.push(request); return data }, development: (request) => runDevelopmentConversation({ ...request, generate: (args) => generateDevelopmentJson({ ...args, clientFactory, wait: async () => {} }) }) })
  const user = { uid, getIdToken: async () => token }
  const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: (path, init) => handler(new Request(`${env.AI_ALLOWED_ORIGIN}${path}`, { ...init, headers: { ...init.headers, origin: env.AI_ALLOWED_ORIGIN } })) })
  const index = { timezone: "UTC", get records() { throw new Error("Gemini-first routing was bypassed") }, get categoryNames() { throw new Error("Local recognition ran before Gemini") } }
  return { calls, reads, ask: (question, extra = {}) => answerFinanceQuestion({ question, index, now, consent: true, requestRoute: (request) => client.requestRoute({ user, ...request }), ...extra }) }
}

test("the real Gemini adapter selects prepared metric/category blocks without supplying financial amounts", async () => {
  const a = app([plan({ intent: "breakdown" }), (context) => {
    assert.equal(context.availableBlocks.q0_categories.type, "categories")
    assert.deepEqual(context.allowedActions, ["analytics", "transactions"])
    return output({ type: "paragraph", kind: "recommendation", text: "Here is your **recorded spending**." }, { type: "categories", id: "q0_categories" }, { type: "actions", ids: ["analytics"] }, { type: "followups", ids: ["reduce", "previous_month"] })
  }])
  const result = await a.ask("Where did my money go?")
  assert.equal(result.source, "gemini_development")
  assert.equal(result.presentation.blocks[1].totalPaise, 435000)
  assert.equal(result.presentation.blocks[1].items[0].amountPaise, 345000)
  assert.equal(validateResponsePresentation(result.presentation), result.presentation)
  assert.equal(a.calls.length, 2)
  assert.equal(a.reads.length, 1)
  assert.equal(a.reads[0].uid, uid)
  assert.equal(a.calls[1].body.generationConfig.responseJsonSchema.properties.answer.type, "string")
  assert.equal(Object.hasOwn(a.calls[1].body.generationConfig.responseJsonSchema, "anyOf"), false)
  for (const { context } of a.calls) assert.doesNotMatch(JSON.stringify(context), /PRIVATE-/)
})

test("personalized recommendation cards use backend-calculated savings and exact explicit scenarios retain context", async () => {
  const a = app([
    plan({ task: "reduce" }), { answer: "Review optional purchases without compromising essentials.", blockIds: ["q0_review0"] },
    plan({ task: "reduce", category: "Shopping", reductionBps: 2000 }), output({ type: "savings", id: "q0_reduction" }),
  ])
  const advice = await a.ask("How can I reduce spending?")
  const recommendation = advice.presentation.blocks[1]
  assert.equal(recommendation.title, "Review Shopping purchases")
  assert.equal(recommendation.estimate.savingPaise, 18000)
  assert.equal(recommendation.estimate.originalPaise, 90000)
  assert.equal(recommendation.estimate.hypothetical, true)
  const scenario = await a.ask("What if I reduce shopping by 20%?", { context: advice.context, history: [{ role: "user", content: "How can I reduce spending?" }, { role: "assistant", content: advice.answer }] })
  assert.equal(scenario.presentation.blocks[0].savingPaise, 18000)
  assert.equal(scenario.presentation.blocks[0].remainingPaise, 72000)
  assert.equal(scenario.context.queries[0].reductionBps, 2000)
  assert.match(scenario.answer, /Hypothetical estimate.*₹180 at 20%/)
  assert.equal(a.calls.length, 4)
})

test("financial block IDs, numbers and action relevance are validated before rendering", () => {
  const catalog = { verified: { block: { type: "metric", amountPaise: 345000, label: "Expenses", period: "October", semantic: "expense" }, factKeys: ["expenses"] } }
  const options = { facts: { expenses: { value: "₹3,450", kind: "recorded" } }, cardMap: {}, catalog, allowedActions: ["transactions"] }
  for (const [bad, rule] of [
    [output({ type: "metric", id: "verified", amountPaise: 999 }), "response_schema"],
    [output({ type: "metric", id: "made_up" }), "block_reference_unknown"],
    [output({ type: "metric", id: "verified" }, { type: "metric", id: "verified" }), "block_reference_unknown"],
    [output({ type: "savings", id: "verified" }), "block_reference_unknown"],
    [output({ type: "actions", ids: ["budget"] }), "action_forbidden"],
    [output({ type: "actions", ids: ["analytics"] }), "action_forbidden"],
    [output({ type: "actions", ids: ["transactions"], href: "javascript:bad()" }), "response_schema"],
    [output({ type: "html", html: "<img onerror='bad()'>" }), "response_schema"],
    [output({ type: "paragraph", kind: "recorded", text: "You spent ₹999." }), "figure_unverified"],
    [output({ type: "recommendation", title: "Unverified", text: "You saved {{expenses}}." }), "scenario_claim_unsupported"],
  ]) assert.throws(() => validateDevelopmentResponse(bad, options), (error) => error.origin === "model_output" && error.validation.rule === rule)
  const valid = validateDevelopmentResponse(output({ type: "metric", id: "verified" }), options)
  assert.equal(valid.presentation.blocks[0].amountPaise, 345000)
})

test("unsupported blocks get one safe correction with the same results and no duplicate retrieval", async () => {
  const a = app([plan(), output({ type: "metric", id: "q0_expenses", amountPaise: 999 }), (context) => {
    assert.equal(context.validationFeedback.rule, "response_schema")
    assert.equal(context.facts.q0_current_expenses.value, "₹4,350")
    return output({ type: "metric", id: "q0_expenses" }, { type: "actions", ids: ["transactions"] })
  }])
  const result = await a.ask("How much did I spend this month?")
  assert.equal(result.presentation.blocks[0].amountPaise, 435000)
  assert.equal(result.cloud.correctionAttempted, true)
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
})

test("Gemini-first GPay guidance has real allowlisted navigation and never retrieves financial records", async () => {
  const a = app([{ status: "guide", guideId: "gpay_import", queries: [] }, (context) => {
    assert.ok(context.guide.steps[0].includes("PDF"))
    assert.deepEqual(context.allowedActions, ["gpay_import"])
    return output({ type: "heading", text: "Import a Google Pay statement" }, { type: "list", ordered: true, items: context.guide.steps.map((text) => ({ kind: "recommendation", text })) }, { type: "actions", ids: ["gpay_import"] })
  }])
  const result = await a.ask("How do I import GPay transactions?")
  assert.equal(result.source, "gemini_development")
  assert.equal(result.presentation.blocks[1].ordered, true)
  assert.deepEqual(result.presentation.blocks[2].ids, ["gpay_import"])
  assert.equal(a.calls.length, 2)
  assert.equal(a.reads.length, 0)
  assert.equal(result.asOf, undefined)
})

test("validated transaction lists remain visible with structured model replies and disclose omissions", async () => {
  const a = app([plan({ intent: "list" }), output({ type: "paragraph", kind: "recommendation", text: "Here are the matching expense records." })])
  const result = await a.ask("List my expenses this month")
  const list = result.presentation.blocks.find((block) => block.type === "transaction_list")
  assert.equal(list.items.length, 2)
  assert.ok([90000, 345000].includes(list.items[0].amountPaise))
  assert.doesNotMatch(JSON.stringify(result.presentation), /PRIVATE-/)
  assert.match(result.answer, /₹4,350 total/)
})

test("multi-part lists preserve the shared record bound and reserve space for verified records", async () => {
  const data = ["10", "09"].flatMap((month) => Array.from({ length: 40 }, (_, i) => row(`row-${month}-${i}`, 1, month, "Other")))
  const a = app([{ status: "resolved", queries: [query({ intent: "list" }), query({ intent: "list", start: "2026-09-01", end: "2026-10-01" })] },
    output(...Array.from({ length: 15 }, () => ({ type: "paragraph", kind: "recommendation", text: "The relevant records follow." }))),
    (context) => { assert.equal(context.responseBlockLimit, 12); assert.equal(context.validationFeedback.rule, "response_schema"); return output({ type: "paragraph", kind: "recommendation", text: "Here are the records for each requested period." }) },
  ], data)
  const result = await a.ask("List expenses for this month and last month separately")
  const lists = result.presentation.blocks.filter((block) => block.type === "transaction_list")
  assert.equal(lists.length, 2)
  assert.equal(lists.reduce((total, block) => total + block.items.length, 0), 50)
  assert.ok(result.presentation.blocks.length <= 16)
  assert.ok(lists.every((block) => block.totalCount === 40 && block.items.length === 25 && block.totalPaise === 4000))
  assert.deepEqual(a.calls[1].body.generationConfig.responseJsonSchema.required, ["answer"])
  assert.equal(a.calls.length, 3)
  assert.equal(a.reads.length, 1)
})

test("first-week Gemini narrative and payment follow-up render verified shared cards without sending row identity to the provider", async () => {
  const data = [["Entertainment", 360, "06"], ["Utilities", 156, "05"], ["Food & Dining", 63, "02"]].map(([category, amount, day], i) => ({ ...row(`PRIVATE-record-${i}`, amount, "10", category), datetime: `2026-10-${day}T10:00:00Z`, paymentMethod: "cash" }))
  data.push(row("PRIVATE-next-week", 999, "10", "Shopping"))
  data.at(-1).datetime = "2026-10-08T12:00:00Z"
  const a = app([
    plan({ intent: "list", end: "2026-10-08" }),
    (context) => {
      assert.equal(context.results[0].recordCount, 3)
      assert.deepEqual(context.results[0].transactions.map((record) => record.amount), ["₹360", "₹156", "₹63"])
      assert.doesNotMatch(JSON.stringify(context), /PRIVATE-|rowKey|tx-50-52/)
      return { answer: "Here are the matching expenses for the requested week." }
    },
    (context) => {
      assert.equal(context.messages.length, 3)
      assert.equal(context.sessionScope.queries[0].end, "2026-10-08")
      return plan({ intent: "list", end: "2026-10-08", method: "cash", category: "Utilities" })
    },
    { answer: "Here are the matching cash expenses in that category." },
  ], data)
  const question = "Show first week expenses of this month"
  const first = await a.ask(question)
  const block = first.presentation.blocks.find((block) => block.type === "transaction_list")
  assert.equal(first.source, "gemini_development")
  assert.equal(block.period, "1–7 October 2026")
  assert.equal(block.label, "First Week Expenses")
  assert.equal(block.totalPaise, 57900)
  assert.equal(block.totalCount, 3)
  assert.equal(new Set(block.items.map((item) => item.rowKey)).size, 3)
  assert.equal(first.presentation.blocks.at(-1).type, "actions")
  assert.deepEqual(first.presentation.blocks.at(-1).ids, ["transactions"])
  const next = "Only cash Utilities expenses"
  const second = await a.ask(next, { context: first.context, history: [{ role: "user", content: question }, { role: "assistant", content: first.answer }] })
  const filtered = second.presentation.blocks.find((block) => block.type === "transaction_list")
  assert.equal(filtered.totalPaise, 15600)
  assert.equal(filtered.items.length, 1)
  assert.equal(filtered.method, "cash")
  assert.equal(filtered.category, "Utilities")
  assert.equal(filtered.items[0].rowKey, block.items[1].rowKey)
  assert.equal(a.reads.length, 2)
  assert.ok(a.reads.every((request) => request.uid === uid))
  assert.equal(a.calls.length, 4)
  a.calls.filter(({ context }) => context.facts).forEach(({ body }) => {
    assert.deepEqual(body.generationConfig.responseJsonSchema.required, ["answer"])
    assert.deepEqual(Object.keys(body.generationConfig.responseJsonSchema.properties), ["answer", "blockIds"])
  })
})

test("a contradictory list narrative recovers with the same authoritative rich card and navigation after records", async () => {
  const a = app([plan({ intent: "list" }), { answer: "There are no recorded expenses." }, { answer: "No transactions were recorded." }])
  const result = await a.ask("List my expenses")
  assert.equal(result.source, "local_verified")
  assert.equal(result.presentation.blocks.filter((block) => block.type === "transaction_list").length, 1)
  const block = result.presentation.blocks.find((block) => block.type === "transaction_list")
  assert.equal(block.totalPaise, 435000)
  assert.equal(result.presentation.blocks.at(-1).type, "actions")
  assert.doesNotMatch(result.answer, /no recorded|no transactions/i)
  assert.equal(a.reads.length, 1)
  assert.equal(a.calls.length, 3)
})

test("verified category-comparison cards are available to the block selector without inventing a timeline", async () => {
  const a = app([{ status: "resolved", queries: [query({ category: "Food & Dining" }), query({ category: "Shopping" })] }, (context) => {
    assert.equal(context.availableBlocks.q0_q1_comparison.type, "comparison")
    return output({ type: "comparison", id: "q0_q1_comparison" })
  }])
  const result = await a.ask("Compare food spending with shopping this month")
  const card = result.presentation.blocks[0].card
  assert.equal(card.metric, "category")
  assert.equal(card.previousLabel, "Food & Dining")
  assert.equal(card.currentLabel, "Shopping")
  assert.equal(card.changePaise, -255000)
})
