import { aiError } from "./aiErrors.js"

const rules = {
  json_invalid: ["GEMINI_OUTPUT_INVALID", "The model returned unreadable JSON. Return the requested JSON schema only."],
  response_schema: ["GEMINI_OUTPUT_INVALID", "Return a JSON object with a nonempty answer string. Optional blockIds may be omitted; do not construct UI objects."],
  narrative_missing: ["GEMINI_NARRATIVE_MISSING", "Return the required answer string, not a financial plan or UI object."],
  narrative_type: ["GEMINI_NARRATIVE_TYPE_INVALID", "The answer field must be a string."],
  narrative_empty: ["GEMINI_NARRATIVE_EMPTY", "Return a nonempty explanation of the supplied verified results."],
  narrative_records_contradiction: ["GEMINI_NARRATIVE_CONTRADICTION", "The record-presence claim contradicts authoritativeEvidence. Use its current verified count and exact scope, or the supplied record_status statement. A bounded display array is not proof of no records."],
  narrative_metric_contradiction: ["GEMINI_NARRATIVE_CONTRADICTION", "Use the matching verified expense, income or category fact; do not relabel a different metric or category."],
  narrative_scope_contradiction: ["GEMINI_NARRATIVE_CONTRADICTION", "Keep the claim within its verified period and category. Use authoritativeEvidence and the supplied period placeholders; history is not current evidence."],
  narrative_direction_contradiction: ["GEMINI_NARRATIVE_CONTRADICTION", "The trend contradicts the chronological comparison. Use the supplied comparison facts or complete verified statement, without recalculating its direction."],
  narrative_role_contradiction: ["GEMINI_NARRATIVE_CONTRADICTION", "A category or period total is not an individual transaction. Use ranked transaction evidence for individual-expense claims."],
  narrative_savings_contradiction: ["GEMINI_NARRATIVE_CONTRADICTION", "Optional-purchase deferrals are conditional scenarios for the stated period, not guaranteed savings or recurring monthly forecasts."],
  response_stage: ["GEMINI_RESPONSE_STAGE_MISMATCH", "This is the final explanation stage. Return answer, not a tool call or planning response."],
  unsafe_content: ["GEMINI_UNSAFE_CONTENT", "Return plain explanatory text without HTML, scripts, links or navigation paths."],
  output_empty: ["GEMINI_OUTPUT_EMPTY", "The provider returned no final text."],
  output_truncated: ["GEMINI_OUTPUT_TRUNCATED", "The provider stopped before completing the final JSON response."],
  answer_invalid: ["GEMINI_OUTPUT_INVALID", "Return nonempty, bounded answer text."],
  answer_too_long: ["GEMINI_OUTPUT_INVALID", "Shorten the response to the requested limits."],
  placeholder_malformed: ["GEMINI_FACT_REFERENCE_INVALID", "Use exact {{fact_key}} placeholders from the supplied facts."],
  fact_unknown: ["GEMINI_FACT_REFERENCE_INVALID", "Reference only fact keys present in the supplied current tool results."],
  figure_unverified: ["GEMINI_NUMERIC_UNVERIFIED", "Replace every amount, date, recorded count and percentage with its supplied fact placeholder. Use bullets rather than numeric list markers."],
  fact_kind_mismatch: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "Keep recorded facts separate from hypothetical scenarios. Scenario figures belong in hypothetical sections."],
  scenario_claim_unsupported: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "Describe scenario values as proposed estimates, never actual, recorded or achieved savings."],
  scenario_result_missing: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "Answer the requested hypothetical reduction using every supplied requiredFactKeys reference; do not substitute a different rate or generic advice."],
  fact_required: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "Recorded sections need recorded fact references; hypothetical sections need scenario fact references. Qualitative advice belongs in recommendation sections."],
  personal_cause_unsupported: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "Do not assert personal causes or habits. Recorded contributions do not establish why spending happened. Offer a conditional suggestion or ask about flexibility."],
  personal_classification_unsupported: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "Do not classify a person's costs as unnecessary, essential or affordable without their information. Offer a conditional review or ask which costs are flexible."],
  card_unknown: ["GEMINI_OUTPUT_INVALID", "Choose only supplied allowedCards IDs, at most two."],
  block_reference_unknown: ["GEMINI_FACT_REFERENCE_INVALID", "Choose only supplied availableBlocks IDs of the requested type. Do not duplicate a financial block or supply financial values."],
  action_forbidden: ["GEMINI_OUTPUT_INVALID", "Choose only the supplied allowedActions and supported follow-up IDs. Never provide paths, URLs or unsupported features."],
  plan_schema: ["GEMINI_TOOL_REQUEST_INVALID", "Return the exact read-only financial query schema."],
  tool_scope: ["GEMINI_TOOL_REQUEST_INVALID", "Use valid supported dates, categories, methods and intents within the supplied scope limits."],
  tool_forbidden: ["GEMINI_TOOL_REQUEST_INVALID", "The model requested unsupported financial tool fields or operations."],
  unrequested_target: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "A savings target must be explicitly requested by the user or retained in the validated conversation scope."],
  unrequested_reduction: ["GEMINI_FINANCIAL_CLAIM_UNSUPPORTED", "A reduction percentage must be explicitly requested by the user or retained in the validated conversation scope."],
  output_incomplete: ["GEMINI_OUTPUT_BLOCKED", "The model response was blocked or incomplete. Please rephrase or retry."],
}
const stages = ["planning", "explanation", "clarification", "generation", "synthetic", "safe_interpretation", "interpretation"]
const validators = ["sdk_extraction", "json_parser", "response_envelope", "narrative", "financial_claim", "legacy_block", "presentation"]
const expectedTypes = ["object", "string", "nonempty_string", "bounded_string", "array", "boolean", "empty_string", "empty_array", "false", "supported_kind", "supported_block", "known_fields", "prepared_block_id", "final_text", "valid_json", "complete_output", "verified_financial_claim", "valid_presentation"]
const receivedTypes = ["missing", "null", "string", "number", "boolean", "array", "object", "empty", "truncated", "tool_call", "blocked", "unknown"]
const safeField = (field) => typeof field === "string" && /^(?:\$|answer|sections(?:\[\d{1,2}\])?(?:\.(?:kind|text))?|blocks(?:\[\d{1,2}\])?(?:\.(?:type|kind|text|title|id|estimateId|ordered|items))?|cardIds|blockIds|presentation|candidates\[0\](?:\.content\.parts|\.finishReason)?)$/.test(field)
export const responseValueType = (value) => value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value

function safeLocation(detail) {
  return safeField(detail.field) && validators.includes(detail.validator) && expectedTypes.includes(detail.expected) && receivedTypes.includes(detail.receivedType)
    ? { validator: detail.validator, field: detail.field, expected: detail.expected, receivedType: detail.receivedType } : {}
}

export function modelValidationError(rule, stage = "explanation", { repairable = true, ...location } = {}) {
  const safeRule = Object.hasOwn(rules, rule) ? rule : "response_schema"
  const [code, feedback] = rules[safeRule]
  const safe = safeLocation(location)
  return Object.assign(aiError(`FinSight could not validate the model response (${safeRule}${safe.field ? ` at ${safe.field}: expected ${safe.expected}, received ${safe.receivedType}` : ""}). Please retry or rephrase.`, { status: 502, code, origin: "model_output", retryable: true }), {
    validation: { stage: stages.includes(stage) ? stage : "explanation", rule: safeRule, correctionAttempted: false, ...safe }, feedback, repairable,
  })
}

export function safeValidationDetails(error) {
  const detail = error?.validation
  return detail && stages.includes(detail.stage) && Object.hasOwn(rules, detail.rule)
    ? { stage: detail.stage, rule: detail.rule, correctionAttempted: detail.correctionAttempted === true, ...safeLocation(detail) } : undefined
}

// One extra model call at most for the ENTIRE turn. Never retry API, tool,
// privacy or conversation errors. Invalid output is not echoed into the prompt.
export async function generateValidated({ generate, args, validate, stage, correction }) {
  args = { ...args, stage }
  for (;;) {
    try { return validate(await generate(args)) } catch (error) {
      if (error.origin !== "model_output") throw error
      error.validation.stage = stage
      error.validation.correctionAttempted = correction.used
      if (!error.repairable || correction.used || args.signal?.aborted) throw error
      correction.used = true
      args = { ...args, context: { ...args.context, validationFeedback: { stage, rule: error.validation.rule, instruction: error.feedback, ...safeLocation(error.validation) } } }
    }
  }
}
