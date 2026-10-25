import { FINANCIAL_INTENTS, MAX_RETRIEVAL_MONTHS, localDateKey, monthsBetween, monthStart, shiftDay, shiftMonth, validateConversationContext, validateInterpretedIntent } from "../../src/features/finance-ai/questionPlanner.js"
import { MAX_MONEY_PAISE } from "../../src/features/finance-ai/financialContext.js"
import { aiError } from "./aiErrors.js"

const invalid = () => { throw aiError("Gemini requested an unsupported financial scope. Please narrow the period, categories or question.", { status: 502, code: "GEMINI_OUTPUT_INVALID", origin: "provider" }) }
const keys = ["intent", "start", "end", "comparisonStart", "comparisonEnd", "category", "method", "task", "targetPaise"]
export const DEVELOPMENT_PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status", "queries"], properties: {
    status: { type: "string", enum: ["resolved", "clarify"] },
    queries: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: keys, properties: {
      intent: { type: "string", enum: FINANCIAL_INTENTS }, start: { type: "string" }, end: { type: "string" },
      comparisonStart: { type: ["string", "null"] }, comparisonEnd: { type: ["string", "null"] },
      category: { type: ["string", "null"], maxLength: 80 }, method: { type: ["string", "null"], enum: ["cash", "upi", null] },
      task: { type: "string", enum: ["answer", "analyse", "reduce"] }, targetPaise: { type: ["integer", "null"], minimum: 1, maximum: MAX_MONEY_PAISE },
    } } },
  },
}

export function developmentQuery(plan) {
  return { intent: plan.intent, start: plan.period.start, end: plan.period.end, comparisonStart: plan.comparison?.start || null, comparisonEnd: plan.comparison?.end || null, category: plan.category, method: plan.method, task: plan.task || "answer", targetPaise: plan.targetPaise || null }
}

export function validateDevelopmentPlan(output, { now, timezone }) {
  if (!output || Object.keys(output).some((key) => !["status", "queries"].includes(key)) || !["resolved", "clarify"].includes(output.status) || !Array.isArray(output.queries) || output.queries.length > 3) invalid()
  if (output.status === "clarify") {
    if (output.queries.length) invalid()
    return { clarify: true, plans: [] }
  }
  if (!output.queries.length) invalid()
  const plans = output.queries.map((query) => {
    if (!query || Object.keys(query).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(query, key)) || !["answer", "analyse", "reduce"].includes(query.task)) invalid()
    if (query.targetPaise != null && (!Number.isSafeInteger(query.targetPaise) || query.targetPaise <= 0 || query.targetPaise > MAX_MONEY_PAISE)) invalid()
    let plan
    try { plan = validateInterpretedIntent({ status: "resolved", intent: query.intent, start: query.start, end: query.end, comparisonStart: query.comparisonStart, comparisonEnd: query.comparisonEnd, category: query.category, method: query.method, explain: true, reference: false }, { now, timezone }) } catch { invalid() }
    return { ...plan, task: query.task, targetPaise: query.targetPaise, thinking: query.task === "answer" ? "LOW" : "MEDIUM" }
  })
  // Coalesce the union once, including overlap between separate tool requests.
  const ranges = plans.flatMap((plan) => plan.retrieval.ranges).sort((a, b) => a.start.localeCompare(b.start))
  const merged = []
  for (const range of ranges) {
    const last = merged.at(-1)
    if (last && last.end >= range.start) last.end = last.end > range.end ? last.end : range.end
    else merged.push({ ...range })
  }
  const start = merged[0].start, end = merged.at(-1).end
  if (monthsBetween(monthStart(start), shiftMonth(shiftDay(end, -1), 1)) > MAX_RETRIEVAL_MONTHS) invalid()
  return { clarify: false, plans, retrieval: { start, end, ranges: merged } }
}

export function validateDevelopmentContext(context, options) {
  if (context == null) return null
  if (context.version === 1) {
    try {
      const previous = validateConversationContext(context, { asOf: localDateKey(options.now, options.timezone) })
      return { version: 2, queries: [developmentQuery({ ...previous, task: "answer" })] }
    } catch { throw aiError("The previous local scope is invalid. Start a new chat.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID" }) }
  }
  if (context.version !== 2 || Object.keys(context).some((key) => !["version", "queries"].includes(key))) throw aiError("Start a new chat to reset the development conversation scope.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID" })
  try { return { version: 2, queries: validateDevelopmentPlan({ status: "resolved", queries: context.queries }, options).plans.map(developmentQuery) } } catch { throw aiError("The development conversation scope is invalid. Start a new chat.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID" }) }
}

export function developmentContext(plans) {
  return { version: 2, queries: plans.map(developmentQuery) }
}

