import test from "node:test"
import assert from "node:assert/strict"
import { answerFinanceQuestion } from "./chatOrchestrator.js"
import { createFinancialIndex } from "./financialEngine.js"

const now = new Date("2026-10-25T12:00:00Z")
const index = createFinancialIndex([{ id: "fixture", type: "expense", amount: 10, datetime: "2026-10-02T12:00:00Z", category: "Food & Dining", paymentMethod: "upi" }], { now, timezone: "Asia/Kolkata" })

test("eligible consented development questions always reach Gemini, including local answers and unsupported local wording", async () => {
  const captured = []
  for (const question of ["Where did my money go?", "last month biggest ec[penses", "Give all expenses from the first week of October 2026.", "Total?", "Only UPI transactions.", "How can I save ₹2,000 every month?"]) {
    const result = await answerFinanceQuestion({ index, now, question, context: null, development: true, consent: true, requestCloud: async (request) => {
      captured.push(request)
      return { answer: "Mock development Gemini answer", cards: [], source: "gemini_development" }
    } })
    assert.equal(result.source, "gemini_development")
    assert.equal(captured.at(-1).mode, "development")
    assert.equal(captured.at(-1).messages.at(-1).content, question)
  }
  assert.equal(captured.length, 6)
})

test("development forwards bounded user/assistant history and structured scope; a new chat has neither", async () => {
  const history = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Fictional history turn ${i}` }))
  const context = { version: 2, queries: [] }
  let captured
  const requestCloud = async (request) => { captured = request; return { answer: "Mock", cards: [], source: "gemini_development" } }
  await answerFinanceQuestion({ index, now, question: "Only UPI transactions.", history, context, development: true, consent: true, requestCloud })
  assert.equal(captured.messages.length, 11)
  assert.equal(captured.messages[0].content, "Fictional history turn 6")
  assert.equal(captured.messages[1].role, "assistant")
  assert.equal(captured.context, context)
  await answerFinanceQuestion({ index, now, question: "Where did my money go?", context: null, development: true, consent: true, requestCloud })
  assert.equal(captured.messages.length, 1)
  assert.equal(captured.context, null)
})

test("ordinary users and non-consented development sessions keep deterministic local answers", async () => {
  let calls = 0
  const requestCloud = () => { calls++; throw new Error("unexpected") }
  for (const development of [false, true]) {
    const result = await answerFinanceQuestion({ index, now, question: "Where did my money go?", consent: false, development, requestCloud })
    assert.equal(result.source, "local")
    assert.match(result.answer, /₹10/)
  }
  const ordinary = await answerFinanceQuestion({ index, now, question: "Where did my money go?", consent: true, development: false, requestCloud })
  assert.equal(ordinary.source, "local")
  assert.equal(calls, 0)
})

test("development provider failure stays visible and cancellation discards a late result", async () => {
  const failure = Object.assign(new Error("Gemini temporarily unavailable"), { origin: "provider", providerStatus: 503 })
  await assert.rejects(() => answerFinanceQuestion({ index, now, question: "Total?", consent: true, development: true, requestCloud: async () => { throw failure } }), failure)
  const controller = new AbortController()
  await assert.rejects(() => answerFinanceQuestion({ index, now, question: "Where did my money go?", consent: true, development: true, signal: controller.signal, requestCloud: async () => { controller.abort(); return { answer: "late" } } }), { name: "AbortError" })
})
