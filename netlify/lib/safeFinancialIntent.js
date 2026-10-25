import { TRANSACTION_CATEGORIES } from "../../src/components/transactions/transactionCategories.js"
import { hasUnresolvedMeaning, isContinuation, normalizeQuestion } from "../../src/features/finance-ai/questionLanguage.js"
import { FINANCIAL_INTENTS, validateConversationContext } from "../../src/features/finance-ai/questionPlanner.js"
import { aiError } from "./aiErrors.js"
import { modelValidationError } from "./modelValidation.js"

// Only these program-owned enum values can leave the server on the safe path.
// This is a semantic projection, not a claim that regex redaction makes an
// arbitrary personal message safe. Unrecognised meaning fails closed.
const OPERATORS = [
  ["list", /\blist\b|itemi[sz]e|individual|everything.*spent|what did i buy|show.*today.*expenses/],
  ["rank", /biggest|largest|highest|\btop\b|contribut.*most|big ticket/],
  ["compare", /compar|versus|\bvs\b|increas|decreas|higher|lower|more|less/],
  ["reduce", /sav(e|ing)|reduc|tighten.*belt/],
  ["explain", /\bwhy\b|explain|advice|suggest|recommend|\bhow\b(?!\s+(?:much|many))/],
  ["patterns", /habits?|patterns?|routine|trends?|analy[sz]e/],
  ["breakdown", /where.*money|breakdown|rundown|money.*went/],
  ["total", /how much|total|wallet.*damage|damage.*wallet|wallet.*take/],
]
const extraPublicWords = ["wallet", "damage", "take", "big ticket", "tighten", "belt", "k", "thousand", "lakh", "crore"]
const categoryWords = ["food", "dining", "groceries", "transportation", "subscriptions", "health", "rent", "bills", ...TRANSACTION_CATEGORIES]

export function buildSafeIntentInput(question, { context = null, category = null } = {}) {
  const text = normalizeQuestion(question)
  const labels = [...categoryWords, ...extraPublicWords, context?.category, category].filter(Boolean)
  if (!text || text.length > 1200 || hasUnresolvedMeaning(text, labels)) throw aiError("This wording needs a more explicit local question. Free-tier AI does not receive private wording, names or unsupported filters; specify a metric, category and period.", { status: 422, code: "SAFE_INTENT_NEEDS_CLARIFICATION", origin: "privacy" })
  const operators = OPERATORS.filter(([, expression]) => expression.test(text)).map(([name]) => name)
  const metric = /cash flow|cashflow|net cash|income\s+(?:versus|vs|and)\s+expenses?/.test(text) ? "cashflow"
    : /income|earn/.test(text) && !/spen[dt]|expense/.test(text) ? "income" : /categor|percent|share/.test(text) ? "categories" : "expenses"
  const continuation = Boolean(context && isContinuation(text))
  // No raw text, amounts, dates, timezone, labels, methods, identifiers, record
  // counts, financial facts or past questions are copied into this object.
  return { kind: "abstract_budget_query", operators, metric, continuation,
    previousIntent: continuation && FINANCIAL_INTENTS.includes(context.intent) ? context.intent : null }
}

export function applySafeIntent(output, candidate, { asOf, context = null } = {}) {
  if (!output || Object.keys(output).some((key) => !["status", "intent", "reference"].includes(key)) || !["resolved", "clarify"].includes(output.status) || !FINANCIAL_INTENTS.includes(output.intent) || typeof output.reference !== "boolean") throw modelValidationError("plan_schema", "planning", { repairable: false })
  if (output.status === "clarify") return { route: "clarify", message: "Should I total expenses, list transactions, rank categories or compare periods? Please specify the scope.", asOf, preserveContext: Boolean(context) }
  if (output.reference && !context) throw modelValidationError("tool_scope", "planning", { repairable: false })
  if (!candidate?.period) throw aiError("Please specify the period and supported filters locally.", { status: 422, code: "SAFE_INTENT_NEEDS_CLARIFICATION", origin: "privacy" })
  // All real scope values remain in the application. The model selects only an
  // operation, which cannot add a filter, amount, date or database query.
  const plan = { ...candidate, intent: output.intent, route: "local" }
  validateConversationContext({ version: 1, intent: plan.intent, period: plan.period, comparison: plan.comparison || null, category: plan.category, method: plan.method, metric: plan.intent === "income" ? "income" : plan.intent === "cashflow" ? "net" : "expenses", targetPaise: plan.targetPaise || null, selection: null }, { asOf })
  if (plan.intent === "comparison" && !plan.comparison) throw aiError("A comparison needs two explicit periods. Please specify them.", { status: 422, code: "SAFE_INTENT_NEEDS_CLARIFICATION", origin: "privacy" })
  return plan
}
