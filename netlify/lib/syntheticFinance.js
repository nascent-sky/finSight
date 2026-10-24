import { SYNTHETIC_QUESTIONS } from "../../src/features/finance-ai/syntheticDemo.js"
import { conversationContextFromPlan, planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner.js"
import { analyseFinancialQuery, createFinancialIndex } from "../../src/features/finance-ai/financialEngine.js"
import { aiError } from "./aiErrors.js"

const clock = new Date("2026-10-24T12:00:00Z")
const options = { now: clock, timezone: "UTC" }
const records = [
  ["income", 30000, "2026-10-01", "Income"], ["income", 30000, "2026-09-01", "Income"],
  ["expense", 3450, "2026-10-15", "Food & Dining"], ["expense", 2800, "2026-09-15", "Food & Dining"],
  ["expense", 6000, "2026-10-05", "Housing"], ["expense", 6000, "2026-09-05", "Housing"],
  ["expense", 900, "2026-10-18", "Shopping"], ["expense", 450, "2026-09-18", "Shopping"],
].map(([type, amount, date, category], index) => ({ id: `fictional-${index}`, type, amount, datetime: `${date}T12:00:00Z`, category, paymentMethod: "upi" }))

export function prepareSyntheticConversation({ questionId, history = [] }) {
  if (!Array.isArray(history)) throw aiError("Synthetic history must contain fixed demo question IDs.", { status: 400, code: "SYNTHETIC_REQUEST_INVALID" })
  const ids = [...history, questionId]
  if (history.length > 19 || ids.some((id) => typeof id !== "string" || !SYNTHETIC_QUESTIONS.some((question) => question.id === id))) throw aiError("Choose a supported synthetic demo question. Real messages, records and custom prompts are not accepted in demo mode.", { status: 400, code: "SYNTHETIC_REQUEST_INVALID" })
  const questions = ids.map((id) => SYNTHETIC_QUESTIONS.find((question) => question.id === id).question)
  const index = createFinancialIndex(records, options)
  let context = null, plan
  for (const question of questions) {
    plan = planFinancialQuestion(question, [], { ...options, categoryNames: index.categoryNames, context })
    if (!plan.period) throw aiError("Start the synthetic conversation with an overview, comparison or expense question.", { status: 422, code: "SYNTHETIC_SCOPE_REQUIRED" })
    context = conversationContextFromPlan(plan)
  }
  plan.route = "cloud"
  return { plan, analysis: analyseFinancialQuery(index, plan), questions, history: ids }
}
