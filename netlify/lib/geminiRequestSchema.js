// Keep the provider grammar intentionally simple. Conditional block fields,
// financial authority, relevance and display shape are enforced in our existing
// server validator, never by an expanding union of provider JSON grammars.
export const GEMINI_RESPONSE_SCHEMA_VERSION = "narrative-refs-v1"
export const GEMINI_PLAN_SCHEMA_VERSION = "flat-plan-v1"
export const GEMINI_PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["status", "guideId", "queries"], properties: {
    status: { type: "string", enum: ["resolved", "clarify", "guide"] },
    guideId: { type: "string" },
    queries: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false,
      required: ["intent", "start", "end", "comparisonStart", "comparisonEnd", "category", "method", "task", "targetPaise", "reductionBps"],
      properties: {
        intent: { type: "string", enum: ["expenses", "income", "cashflow", "list", "largest", "categories", "breakdown", "percentages", "comparison"] },
        start: { type: "string" }, end: { type: "string" }, comparisonStart: { type: "string" }, comparisonEnd: { type: "string" },
        category: { type: "string" }, method: { type: "string" }, task: { type: "string", enum: ["answer", "analyse", "reduce"] },
        targetPaise: { type: "integer" }, reductionBps: { type: "integer" },
      },
    } },
  },
}
export const GEMINI_PLAN_FORMAT = `Provider wire format: always return status, guideId and queries. guideId is an empty string for financial questions and clarification, or gpay_import for that implemented guide. Every query contains all schema fields. Use empty strings for absent comparisonStart/comparisonEnd/category/method, targetPaise=0 when no target was requested and reductionBps=-1 when no percentage was requested. These are wire-only sentinels: do not return null or omit fields. Financial bounds, dates and permissions are checked by the backend before tools run.`

export function normalizeGeminiPlan(output) {
  // Canonical legacy outputs and retained conversation scopes remain unchanged.
  if (!output || typeof output.guideId !== "string" || !Array.isArray(output.queries)) return output
  return { ...output, guideId: output.guideId || null, queries: output.queries.map((query) => {
    if (!query || typeof query !== "object" || Array.isArray(query)) return query
    const normalized = { ...query }
    for (const key of ["comparisonStart", "comparisonEnd", "category", "method"]) if (normalized[key] === "") normalized[key] = null
    if (normalized.targetPaise === 0) normalized.targetPaise = null
    if (normalized.reductionBps === -1) normalized.reductionBps = null
    return normalized
  }) }
}
export const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string" },
    blockIds: { type: "array", maxItems: 8, items: { type: "string" } },
  },
}

export const GEMINI_RESPONSE_FORMAT = `Return one JSON object with a required answer string and optional blockIds array of strings. Example: {"answer":"Here are the verified expenses you asked for."}. Write a concise natural explanation, with short paragraphs or unnumbered bullet points when helpful. Use exact supplied {{fact_key}} placeholders for every financial value, date, recorded count and category name. Never reproduce values from memory or calculate amounts.
blockIds are optional suggestions from availableBlocks only. Omit them when unnecessary. FinSight independently creates the correct verified cards, expense lists, hypothetical estimates and allowed actions. Do not construct UI blocks, nested objects, cardIds, sections, HTML, paths or URLs. Do not repeat a backend expense list in your narrative.`

export function assertSimpleResponseSchema(schema) {
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object") return
    if (depth > 8 || Array.isArray(value.type) || ["anyOf", "oneOf", "allOf", "$ref", "if", "then", "else"].some((key) => Object.hasOwn(value, key))) throw new Error("Gemini response schemas must use the flat compatibility contract.")
    Object.values(value).forEach((entry) => visit(entry, depth + 1))
  }
  visit(schema)
}
