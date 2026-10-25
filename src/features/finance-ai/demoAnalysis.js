import { createFinancialIndex, analyseFinancialQuery, publicFinancialAnswer } from "./financialEngine.js"
import { planFinancialQuestion } from "./questionPlanner.js"
import { appGuideResponse, findAppGuide } from "./appGuidance.js"
import { responsePresentation } from "./responseBlocks.js"

export const DEMO_AS_OF = "2026-10-24T12:00:00Z"
export const DEMO_TIMEZONE = "UTC"
// AI-only, immutable sample records. Normal account/report engines exclude both
// these reserved IDs and sample flags. Never insert these into a transaction feed.
export const AI_DEMO_RECORDS = Object.freeze([
  ["income", 30000, "2026-08-01", "Income", "upi"],
  ["income", 30000, "2026-09-01", "Income", "upi"],
  ["income", 32000, "2026-10-01", "Income", "upi"],
  ["expense", 6000, "2026-08-02", "Housing", "upi"],
  ["expense", 2600, "2026-08-15", "Food & Dining", "cash"],
  ["expense", 500, "2026-08-19", "Shopping", "upi"],
  ["expense", 700, "2026-08-21", "Transport", "cash"],
  ["expense", 6000, "2026-09-02", "Housing", "upi"],
  ["expense", 2800, "2026-09-15", "Food & Dining", "cash"],
  ["expense", 450, "2026-09-18", "Shopping", "upi"],
  ["expense", 650, "2026-09-20", "Transport", "cash"],
  ["expense", 300, "2026-09-23", "Entertainment", "upi"],
  ["expense", 6000, "2026-10-02", "Housing", "upi"],
  ["expense", 2200, "2026-10-12", "Food & Dining", "upi"],
  ["expense", 1250, "2026-10-24", "Food & Dining", "cash"],
  ["expense", 900, "2026-10-18", "Shopping", "upi"],
  ["expense", 850, "2026-10-20", "Transport", "cash"],
  ["expense", 500, "2026-10-22", "Entertainment", "upi"],
].map(([type, amount, date, category, paymentMethod], i) => Object.freeze({ id: `__finsight_ai_demo_${i}`, isSampleData: true, source: "sample", type, amount, datetime: `${date}T10:00:00Z`, category, paymentMethod })))

export function createDemoFinancialIndex() {
  // Only this isolated evaluator projects the AI-owned fixtures into engine
  // inputs. The frozen originals keep their sample markers everywhere else.
  const isolated = AI_DEMO_RECORDS.map(({ type, amount, datetime, category, paymentMethod }, i) => ({ id: `ai-demo-analysis-${i}`, type, amount, datetime, category, paymentMethod }))
  return createFinancialIndex(isolated, { now: new Date(DEMO_AS_OF), timezone: DEMO_TIMEZONE })
}

export async function answerDemoQuestion({ question, history = [], context = null, signal }) {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  if (typeof question !== "string" || !question.trim() || question.length > 1200) throw new Error("Enter a demo question of up to 1,200 characters.")
  if (context && context.version !== "demo-v1") throw new Error("Start a new demo chat to reset its sample-data scope.")
  const guide = findAppGuide(question)
  if (guide) return { ...appGuideResponse(guide, context), source: "demo_local", cloud: { status: "not_requested", dataHandling: "local_demo" } }
  const index = createDemoFinancialIndex()
  const plan = planFinancialQuestion(question, history.filter((message) => message.role === "user").slice(-5), { now: new Date(DEMO_AS_OF), timezone: DEMO_TIMEZONE, categoryNames: index.categoryNames, context: context?.scope ?? null })
  const analysis = analyseFinancialQuery(index, plan)
  const result = publicFinancialAnswer(analysis)
  const presentation = result.presentation ? responsePresentation(result.presentation.blocks.filter((block) => block.type !== "actions").map((block) => block.type === "comparison" ? { ...block, card: { ...block.card, title: `Sample · ${block.card.title}` } } : block)) : undefined
  return { ...result, ...(presentation ? { presentation } : {}), answer: plan.route === "conversation" ? result.answer : `Sample data · fictional finances\n\n${result.answer}`, source: "demo_local", context: { version: "demo-v1", scope: result.context || (plan.preserveContext ? context?.scope : null) || null },
    cards: result.cards.map((card) => ({ ...card, title: `Sample · ${card.title}`, note: `Fictional sample data. ${card.note || ""}` })),
    cloud: { status: "not_requested", dataHandling: "local_demo" } }
}
