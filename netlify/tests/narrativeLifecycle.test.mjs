import test, { after } from "node:test"
import assert from "node:assert/strict"
import { writeFile, unlink, mkdir } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { GoogleGenAI } from "@google/genai"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { runDevelopmentConversation } from "../lib/developmentConversation.js"
import { generateDevelopmentJson } from "../lib/geminiFinance.js"
import { validateDevelopmentResponse } from "../lib/developmentResponse.js"
import { safeValidationDetails } from "../lib/modelValidation.js"
import { createFinanceChatClient } from "../../src/services/financeChatClient.js"
import { validateResponsePresentation } from "../../src/features/finance-ai/responseBlocks.js"
import { financeSourceLabel } from "../../src/features/finance-ai/financeRouting.js"

// Compile only the existing response component for server rendering in tests.
// This starts no application, development server or browser.
const root = fileURLToPath(new URL("../../", import.meta.url))
const temporary = fileURLToPath(new URL(`../../tmp/narrative-renderer-${process.pid}.mjs`, import.meta.url))
await mkdir(fileURLToPath(new URL("../../tmp/", import.meta.url)), { recursive: true })
const compiled = await build({ absWorkingDir: root, entryPoints: ["src/features/finance-ai/AssistantResponse.jsx"], bundle: true, platform: "node", format: "esm", packages: "external", write: false, jsx: "automatic" })
await writeFile(temporary, compiled.outputFiles[0].text)
const { default: AssistantResponse } = await import(pathToFileURL(temporary).href)
after(() => unlink(temporary))
const render = (result) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(AssistantResponse, result)))

const uid = "PRIVATE-user", token = "PRIVATE-token"
const env = { GEMINI_API_KEY: "PRIVATE-key", GEMINI_MODEL: "gemini-3.1-flash-lite", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: uid, FIREBASE_PROJECT_ID: "test-project", AI_ALLOWED_ORIGIN: "https://finsight.example" }
const now = new Date("2026-10-25T12:00:00Z")
const records = [
  { id: "PRIVATE-food", amount: 3450, type: "expense", datetime: "2026-10-02T12:00:00Z", category: "Food & Dining", paymentMethod: "upi", note: "PRIVATE-note" },
  { id: "PRIVATE-shopping", amount: 900, type: "expense", datetime: "2026-10-03T12:00:00Z", category: "Shopping", paymentMethod: "upi" },
  { id: "PRIVATE-before", amount: 2800, type: "expense", datetime: "2026-09-03T12:00:00Z", category: "Food & Dining", paymentMethod: "upi" },
]
const plan = (extra = {}) => ({ status: "resolved", guideId: "", queries: [{ intent: "breakdown", start: "2026-10-01", end: "2026-11-01", comparisonStart: "", comparisonEnd: "", category: "", method: "", task: "answer", targetPaise: 0, reductionBps: -1, ...extra }] })

function app(steps) {
  const calls = [], reads = [], responses = []
  const clientFactory = (configuration) => new GoogleGenAI({ ...configuration, httpOptions: { ...configuration.httpOptions, fetch: async (url, init) => {
    assert.match(String(url), /gemini-3\.1-flash-lite:generateContent$/)
    const body = JSON.parse(init.body), context = JSON.parse(body.contents[0].parts[0].text)
    calls.push({ body, context })
    assert.equal(body.generationConfig.responseMimeType, "application/json")
    assert.equal(Object.hasOwn(body, "tools"), false)
    if (context.facts) {
      assert.deepEqual(body.generationConfig.responseJsonSchema.required, ["answer"])
      assert.deepEqual(Object.keys(body.generationConfig.responseJsonSchema.properties), ["answer", "blockIds"])
    }
    const step = steps.shift()
    assert.ok(step, "Every SDK request must have an explicit expected response")
    const output = typeof step === "function" ? step(context) : step
    if (output.providerBody) return Response.json(output.providerBody)
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: output.raw ?? JSON.stringify(output) }] } }] })
  } } })
  const handler = createChatHandler({ env, now: () => now.getTime(), verifyToken: async () => uid,
    retrieve: async (request) => { reads.push(request); return records },
    development: (request) => runDevelopmentConversation({ ...request, generate: (args) => generateDevelopmentJson({ ...args, clientFactory, wait: async () => {} }) }),
  })
  const user = { uid, isAnonymous: false, getIdToken: async () => token }
  const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async (path, init) => {
    const response = await handler(new Request(`${env.AI_ALLOWED_ORIGIN}${path}`, { ...init, headers: { ...init.headers, origin: env.AI_ALLOWED_ORIGIN } }))
    responses.push(await response.clone().json())
    return response
  } })
  return { calls, reads, responses, ask: (question, extra = {}) => client.requestRoute({ user, consent: true, timezone: "UTC", messages: [{ role: "user", content: question }], ...extra }) }
}

test("the old flat block's missing title is diagnosed exactly, while narrative needs no presentation fields", () => {
  const missingTitle = { type: "paragraph", kind: "recommendation", text: "Here are the biggest recorded expenses.", id: "", estimateId: "", ordered: false, items: [] }
  assert.throws(() => validateDevelopmentResponse({ blocks: [missingTitle], cardIds: [] }, { facts: {}, cardMap: {} }), (error) => {
    assert.deepEqual(safeValidationDetails(error), { stage: "explanation", rule: "response_schema", correctionAttempted: false, validator: "legacy_block", field: "blocks[0].title", expected: "string", receivedType: "missing" })
    return true
  })
  const result = validateDevelopmentResponse({ answer: missingTitle.text }, { facts: {}, cardMap: {} })
  assert.equal(result.answer, missingTitle.text)
  assert.doesNotMatch(render(result), /could not be verified/)
})

test("all requested questions traverse SDK → parsing → tools → verified rich renderer with multi-turn memory", async () => {
  const a = app([
    plan({ intent: "largest" }), { answer: "Here are your biggest recorded expenses." },
    plan(), { answer: "Recorded spending was {{q0_current_expenses}}.", blockIds: ["q0_categories", "PRIVATE-unknown-id", null] },
    plan({ task: "reduce" }), { answer: "Review flexible costs before choosing a smaller limit.\n\n- Compare alternatives.\n- Protect essentials.", blockIds: "PRIVATE-wrong-type" },
    plan({ intent: "comparison", comparisonStart: "2026-09-01", comparisonEnd: "2026-10-01" }), (context) => ({ answer: "Recorded spending changed from {{q0_comparison_previous_amount}} to {{q0_comparison_current_amount}}.", blockIds: [Object.keys(context.availableBlocks).find((id) => context.availableBlocks[id].type === "comparison")] }),
    { status: "guide", guideId: "gpay_import", queries: [] }, { answer: "Import a statement PDF, review its transactions, then confirm the import." },
  ])
  const questions = ["Show my biggest expenses", "Where did my money go?", "How can I reduce it?", "Compare this month with last month", "How do I import GPay transactions?"]
  const history = [], results = []
  let context = null
  for (const question of questions) {
    const result = await a.ask(question, { context, messages: [...history, { role: "user", content: question }] })
    assert.equal(result.source, "gemini_development")
    assert.match(financeSourceLabel(result.source), /^Gemini-generated answer/)
    assert.equal(result.cloud.correctionAttempted, false)
    validateResponsePresentation(result.presentation)
    assert.doesNotMatch(render(result), /could not be verified|PRIVATE-/)
    results.push(result)
    context = result.context
    history.push({ role: "user", content: question }, { role: "assistant", content: result.answer })
  }
  const list = results[0].presentation.blocks.find((block) => block.type === "ranked_expenses")
  assert.equal(list.items[0].amountPaise, 345000)
  assert.equal(list.items[1].amountPaise, 90000)
  assert.match(render(results[0]), /<ol/)
  assert.equal(results[1].presentation.blocks.find((block) => block.type === "categories").totalPaise, 435000)
  assert.ok(results[2].presentation.blocks.some((block) => block.type === "recommendation" && block.estimate?.hypothetical && block.estimate.savingPaise === 18000))
  assert.match(render(results[2]), /Recommended next steps|Hypothetical/)
  assert.equal(results[3].cards[0].previousPaise, 280000)
  assert.equal(results[3].cards[0].currentPaise, 435000)
  assert.equal(results[3].cards[0].percentage, 55.4)
  assert.match(render(results[4]), /href="\/transactions-import"/)
  assert.match(render(results[4]), /<ol/)
  assert.equal(a.calls.length, 10)
  assert.equal(a.reads.length, 4)
  assert.ok(a.reads.every((request) => request.uid === uid && request.token === token))
  assert.ok(a.calls[2].context.messages.some((message) => message.role === "assistant"))
  for (const call of a.calls) assert.doesNotMatch(JSON.stringify(call.context), /PRIVATE-/)
})

test("optional metadata is discarded without repairs, fabricated amounts or arbitrary navigation entering the UI", async () => {
  for (const metadata of [{}, { blockIds: null }, { blockIds: {} }, { blockIds: ["PRIVATE-unknown", {}, 999, "q0_expenses", "q0_expenses"] }, { cardIds: "PRIVATE-wrong", blocks: [{ type: "metric", amountPaise: 999 }], actions: [{ href: "javascript:PRIVATE()" }], version: "PRIVATE-old" }]) {
    const a = app([plan({ intent: "expenses" }), { answer: "Recorded spending is {{q0_current_expenses}}.", ...metadata }])
    const result = await a.ask("Show my biggest expenses")
    assert.equal(result.source, "gemini_development")
    assert.equal(result.cloud.correctionAttempted, false)
    assert.equal(a.calls.length, 2)
    const metrics = result.presentation.blocks.filter((block) => block.type === "metric")
    assert.equal(metrics.length, 1)
    assert.equal(metrics[0].amountPaise, 435000)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|javascript:|999/)
    assert.doesNotMatch(render(result), /could not be verified/)
  }
})

test("SDK extraction distinguishes empty, truncated, thought-only and tool-call responses without repeated repairs", async () => {
  for (const [candidate, code, field, receivedType] of [
    [{ finishReason: "STOP", content: { parts: [] } }, "GEMINI_OUTPUT_EMPTY", "candidates[0].content.parts", "empty"],
    [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "PRIVATE-thought" }] } }, "GEMINI_OUTPUT_EMPTY", "candidates[0].content.parts", "empty"],
    [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"answer":"PRIVATE-truncated' }] } }, "GEMINI_OUTPUT_TRUNCATED", "candidates[0].finishReason", "truncated"],
    [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "PRIVATE-tool", args: {} } }] } }, "GEMINI_RESPONSE_STAGE_MISMATCH", "candidates[0].content.parts", "tool_call"],
    [{ finishReason: "STOP", content: { parts: [{ functionResponse: { name: "PRIVATE-tool", response: {} } }] } }, "GEMINI_RESPONSE_STAGE_MISMATCH", "candidates[0].content.parts", "tool_call"],
  ]) {
    const a = app([plan(), { providerBody: { candidates: [candidate] } }])
    await assert.rejects(() => a.ask("Show my biggest expenses"), (error) => {
      assert.equal(error.code, code)
      assert.equal(error.validation.validator, "sdk_extraction")
      assert.equal(error.validation.stage, "explanation")
      assert.equal(error.validation.field, field)
      assert.equal(error.validation.receivedType, receivedType)
      assert.equal(error.validation.correctionAttempted, false)
      return true
    })
    assert.equal(a.calls.length, 2)
    assert.equal(a.reads.length, 1)
    assert.doesNotMatch(JSON.stringify(a.responses), /PRIVATE-/)
  }
})

test("malformed JSON, missing/empty narrative and unsupported claims retain precise safe errors and one correction at most", async () => {
  for (const [output, code, field, expected, receivedType] of [
    [{ raw: "PRIVATE-invalid-json" }, "GEMINI_OUTPUT_INVALID", "$", "valid_json", "string"],
    [{ blockIds: [] }, "GEMINI_NARRATIVE_MISSING", "answer", "string", "missing"],
    [{ answer: 999 }, "GEMINI_NARRATIVE_TYPE_INVALID", "answer", "string", "number"],
    [{ answer: " " }, "GEMINI_NARRATIVE_EMPTY", "answer", "nonempty_string", "empty"],
    [{ status: "resolved", queries: [] }, "GEMINI_RESPONSE_STAGE_MISMATCH", "answer", "final_text", "tool_call"],
    [{ answer: "You spent ₹999." }, "GEMINI_NUMERIC_UNVERIFIED", "answer", "verified_financial_claim", "string"],
    [{ answer: "You saved {{q0_current_expenses}}." }, "GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "answer", "verified_financial_claim", "string"],
    [{ answer: "You spent more because of your habits." }, "GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "answer", "verified_financial_claim", "string"],
    [{ answer: "<script>PRIVATE()</script>" }, "GEMINI_UNSAFE_CONTENT", "answer", "string", "string"],
    [{ answer: "Open [this](javascript:PRIVATE())." }, "GEMINI_UNSAFE_CONTENT", "answer", "string", "string"],
  ]) {
    const a = app([plan(), output, output])
    await assert.rejects(() => a.ask("Show my biggest expenses"), (error) => {
      assert.equal(error.code, code)
      assert.equal(error.origin, "model_output")
      assert.equal(error.retryable, true)
      assert.equal(error.validation.field, field)
      assert.equal(error.validation.expected, expected)
      assert.equal(error.validation.receivedType, receivedType)
      assert.equal(error.validation.stage, "explanation")
      assert.equal(error.validation.correctionAttempted, true)
      return true
    })
    assert.equal(a.calls.length, 3)
    assert.equal(a.reads.length, 1)
    assert.doesNotMatch(JSON.stringify(a.responses), /PRIVATE-|₹999/)
    assert.equal(a.responses[0].answer, undefined)
  }
})

test("thought parts are excluded and split final JSON text is joined before parsing", async () => {
  const a = app([plan(), { providerBody: { candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "PRIVATE-thought" }, { text: '{"answer":"Recorded ' }, { text: 'spending is {{q0_current_expenses}}."}' }] } }] } }])
  const result = await a.ask("Where did my money go?")
  assert.match(result.answer, /₹4,350/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-/)
  assert.equal(a.calls.length, 2)
})

test("explicit scenario numbers still come from backend cards when narrative omits optional metadata", async () => {
  const a = app([plan({ category: "Shopping", task: "reduce", reductionBps: 2000 }), { answer: "Here is the requested hypothetical estimate; flexibility is unknown." }])
  const result = await a.ask("What if I reduce shopping by 20%?")
  const savings = result.presentation.blocks.find((block) => block.type === "savings")
  assert.equal(savings.savingPaise, 18000)
  assert.equal(savings.remainingPaise, 72000)
  assert.equal(savings.hypothetical, true)
  assert.equal(result.cloud.correctionAttempted, false)
  assert.match(render(result), /₹180/)
  assert.equal(a.calls.length, 2)
})

test("biggest expenses render once with relevant actions, even if Gemini repeats owned rows or suggests unrelated reports", async () => {
  const a = app([plan({ intent: "largest" }), (context) => {
    assert.equal(context.results[0].transactions.length, 2)
    assert.equal(context.results[0].recordCount, 2)
    assert.equal(context.authoritativeEvidence[0].current.hasRecords, true)
    assert.equal(context.facts.q0_expense_count.value, "2")
    assert.equal(context.presentationPolicy[0].mode, "records")
    assert.equal(context.availableBlocks.q0_categories, undefined)
    return { answer: "Here are the selected expenses.\n\n• {{q0_record0}}\n• {{q0_record1}}", blockIds: ["q0_categories", "q0_expenses"] }
  }])
  const result = await a.ask("Show my biggest expenses")
  const lists = result.presentation.blocks.filter((block) => block.type === "ranked_expenses")
  assert.equal(lists.length, 1)
  assert.equal(lists[0].items.length, 2)
  assert.ok(result.presentation.blocks.every((block) => !["metric", "categories", "savings"].includes(block.type)))
  assert.equal((result.answer.match(/₹3,450/g) || []).length, 1)
  assert.equal((render(result).match(/₹3,450/g) || []).length, 1)
  assert.ok(result.presentation.blocks.findIndex((block) => block.type === "actions") > result.presentation.blocks.findIndex((block) => block.type === "ranked_expenses"))
  assert.equal(a.calls.length, 2)
  assert.equal(result.cloud.correctionAttempted, false)
})

test("GPay instructions appear as one numbered guide when the model repeats the prepared steps", async () => {
  const a = app([{ status: "guide", guideId: "gpay_import", queries: [] }, (context) => ({ answer: `Review your statement before importing.\n\n${context.guide.steps.map((step) => `• ${step}`).join("\n")}` })])
  const result = await a.ask("How do I import GPay?")
  assert.equal(result.presentation.blocks.filter((block) => block.type === "list").length, 1)
  assert.equal((render(result).match(/<ol/g) || []).length, 1)
  assert.match(render(result), /href="\/transactions-import"/)
  assert.equal(a.reads.length, 0)
  assert.equal(a.calls.length, 2)
})

test("separate recommendation groups continue numbering and render compact estimates with exact INR formatting", () => {
  const recommendation = (title) => ({ type: "recommendation", title, text: "Consider this only if suitable." })
  const result = { presentation: { version: 1, blocks: [
    { ...recommendation("Review optional costs"), estimate: { type: "savings", label: "One optional purchase", period: "October · incomplete period", originalPaise: 100000, savingPaise: 9030, remainingPaise: 90970, reductionBps: null, hypothetical: true } },
    { type: "paragraph", text: "A separate, useful explanation." }, recommendation("Protect essentials"),
    { type: "notice", tone: "info", text: "Current recorded scope." }, recommendation("Review next period"),
    { type: "metric", label: "Recorded healthcare expense", semantic: "expense", period: "October", amountPaise: 81270 },
  ] } }
  const html = render(result)
  assert.deepEqual([...html.matchAll(/class="ai-recommendation-heading"><span aria-hidden="true">(\d+)<\/span>/g)].map((match) => match[1]), ["1", "2", "3"])
  assert.match(html, /start="2"/)
  assert.match(html, /start="3"/)
  assert.match(html, /class="ai-savings-inline"/)
  assert.doesNotMatch(html, /<section class="ai-savings"/)
  assert.match(html, /₹90\.30/)
  assert.match(html, /₹812\.70/)
  assert.match(html, /not recorded savings/)
})

test("a reduction follow-up retaining largest intent uses its recorded evidence without repeating the ranked list", async () => {
  const a = app([plan({ intent: "largest" }), { answer: "Here are the selected expenses." }, plan({ intent: "largest", task: "reduce" }), { answer: "Review which selected purchases were optional before changing spending." }])
  const first = await a.ask("Show my biggest expenses")
  const result = await a.ask("How can I reduce those expenses?", { context: first.context, messages: [{ role: "user", content: "Show my biggest expenses" }, { role: "assistant", content: first.answer }, { role: "user", content: "How can I reduce those expenses?" }] })
  assert.equal(first.presentation.blocks.filter((block) => block.type === "ranked_expenses").length, 1)
  assert.equal(result.presentation.blocks.filter((block) => block.type === "ranked_expenses").length, 0)
  assert.equal(result.context.queries[0].intent, "largest")
  assert.equal(result.context.queries[0].task, "reduce")
  assert.ok(result.presentation.blocks.some((block) => block.type === "recommendation" && block.estimate?.savingPaise === 18000))
  assert.equal(a.calls.length, 4)
})

test("a conversational verified amount remains visible alongside the ranked visual card", async () => {
  const a = app([plan({ intent: "largest" }), { answer: "Your largest recorded expense is {{q0_record0_amount}}." }])
  const result = await a.ask("Show my biggest expenses")
  assert.match(result.answer, /Your largest recorded expense is ₹3,450/)
  assert.equal(result.presentation.blocks.filter((block) => block.type === "ranked_expenses").length, 1)
  assert.equal((render(result).match(/₹3,450/g) || []).length, 2)
  assert.equal(a.calls.length, 2)
})

test("Shopping advice stays gradual until the user explicitly discusses deferring a purchase", async () => {
  const a = app([
    plan({ task: "reduce", category: "Shopping" }), { answer: "Try a gradual reduction if it fits your needs." },
    plan({ task: "reduce", category: "Shopping" }), { answer: "If that purchase is optional, deferring a similar purchase is a hypothetical option." },
  ])
  const first = await a.ask("How can I reduce my shopping expenses?")
  const gradual = first.presentation.blocks.find((block) => block.type === "recommendation" && block.estimate).estimate
  assert.equal(gradual.reductionBps, 2000)
  assert.equal(gradual.savingPaise, 18000)
  assert.equal(gradual.remainingPaise, 72000)
  const second = await a.ask("What if I defer that optional shopping purchase?", { context: first.context })
  const deferral = second.presentation.blocks.find((block) => block.type === "recommendation" && block.estimate).estimate
  assert.equal(deferral.reductionBps, null)
  assert.equal(deferral.savingPaise, 90000)
  assert.equal(deferral.remainingPaise, 0)
  assert.equal(deferral.hypothetical, true)
  assert.equal(a.calls.length, 4)
  assert.equal(second.source, "gemini_development")
})
