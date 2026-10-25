import { MAX_RETRIEVAL_MONTHS, localDateKey, monthsBetween, monthStart, shiftDay, shiftMonth, validateConversationContext, validateInterpretedIntent } from "../../src/features/finance-ai/questionPlanner.js"
import { MAX_MONEY_PAISE } from "../../src/features/finance-ai/financialContext.js"
import { aiError } from "./aiErrors.js"
import { modelValidationError } from "./modelValidation.js"
import { GEMINI_PLAN_SCHEMA } from "./geminiRequestSchema.js"

const invalid = (rule = "plan_schema", repairable = true) => { throw modelValidationError(rule, "planning", { repairable }) }
const keys = ["intent", "start", "end", "comparisonStart", "comparisonEnd", "category", "method", "task", "targetPaise"]
const optionalKeys = ["reductionBps"]
export const DEVELOPMENT_PLAN_SCHEMA = GEMINI_PLAN_SCHEMA

export function developmentQuery(plan) {
  return { intent: plan.intent, start: plan.period.start, end: plan.period.end, comparisonStart: plan.comparison?.start || null, comparisonEnd: plan.comparison?.end || null, category: plan.category, method: plan.method, task: plan.task || "answer", targetPaise: plan.targetPaise || null, ...(plan.reductionBps != null ? { reductionBps: plan.reductionBps } : {}) }
}

export function validateDevelopmentPlan(output, { now, timezone }) {
  if (!output || typeof output !== "object" || Array.isArray(output) || Object.keys(output).some((key) => !["status", "queries", "guideId", "clarification"].includes(key)) || !["resolved", "clarify", "guide"].includes(output.status) || !Array.isArray(output.queries) || output.queries.length > 3) invalid()
  // Retained resolved scopes predate the provider-only clarification field.
  if (Object.hasOwn(output, "clarification") && (typeof output.clarification !== "string" || output.clarification.length > 1200 || output.status !== "clarify" && output.clarification.trim())) invalid()
  if (output.status === "guide") {
    if (output.guideId !== "gpay_import" || output.queries.length) invalid("tool_forbidden", false)
    return { guideId: output.guideId, plans: [] }
  }
  if (output.guideId != null) invalid("tool_forbidden", false)
  if (output.status === "clarify") {
    if (output.queries.length || typeof output.clarification !== "string" || !output.clarification.trim()) invalid()
    return { clarify: true, plans: [], clarification: output.clarification.trim() }
  }
  if (!output.queries.length) invalid()
  const plans = output.queries.map((query) => {
    if (!query || typeof query !== "object" || Array.isArray(query)) invalid()
    if (Object.keys(query).some((key) => ![...keys, ...optionalKeys].includes(key))) invalid("tool_forbidden", false)
    if (keys.some((key) => !Object.hasOwn(query, key)) || !["answer", "analyse", "reduce"].includes(query.task)) invalid()
    if (query.targetPaise != null && (!Number.isSafeInteger(query.targetPaise) || query.targetPaise <= 0 || query.targetPaise > MAX_MONEY_PAISE)) invalid("tool_scope", false)
    if (query.reductionBps != null && (!Number.isInteger(query.reductionBps) || query.reductionBps < 0 || query.reductionBps > 10000 || query.task !== "reduce" || ["income", "cashflow"].includes(query.intent))) invalid("tool_scope", false)
    let plan
    try { plan = validateInterpretedIntent({ status: "resolved", intent: query.intent, start: query.start, end: query.end, comparisonStart: query.comparisonStart, comparisonEnd: query.comparisonEnd, category: query.category, method: query.method, explain: true, reference: false }, { now, timezone }) } catch { invalid("tool_scope", false) }
    return { ...plan, task: query.task, targetPaise: query.targetPaise, reductionBps: query.reductionBps ?? null, thinking: query.task === "answer" ? "LOW" : "MEDIUM" }
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
  if (monthsBetween(monthStart(start), shiftMonth(shiftDay(end, -1), 1)) > MAX_RETRIEVAL_MONTHS) invalid("tool_scope", false)
  return { clarify: false, plans, retrieval: { start, end, ranges: merged } }
}

export function validateDevelopmentContext(context, options) {
  if (context == null) return null
  if (typeof context !== "object" || Array.isArray(context)) throw aiError("The development conversation scope is invalid. Start a new chat.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID", origin: "conversation" })
  if (context.version === 1) {
    try {
      const previous = validateConversationContext(context, { asOf: localDateKey(options.now, options.timezone) })
      return { version: 2, queries: [developmentQuery({ ...previous, task: "answer" })] }
    } catch { throw aiError("The previous local scope is invalid. Start a new chat.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID", origin: "conversation" }) }
  }
  if (context.version !== 2 || Object.keys(context).some((key) => !["version", "queries"].includes(key))) throw aiError("Start a new chat to reset the development conversation scope.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID", origin: "conversation" })
  try {
    const validated = validateDevelopmentPlan({ status: "resolved", queries: context.queries }, options)
    if (validated.clarify) throw new Error("A conversation scope needs a resolved query")
    return { version: 2, queries: validated.plans.map(developmentQuery) }
  } catch { throw aiError("The development conversation scope is invalid. Start a new chat.", { status: 400, code: "DEVELOPMENT_CONTEXT_INVALID", origin: "conversation" }) }
}

export function developmentContext(plans) {
  return { version: 2, queries: plans.map(developmentQuery) }
}

