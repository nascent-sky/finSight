import { aiError } from "./aiErrors.js"

const stages = ["planning", "explanation", "clarification", "synthetic", "safe_interpretation", "interpretation"]
const codes = ["INVALID_ARGUMENT", "RESOURCE_EXHAUSTED", "UNAVAILABLE", "PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND", "INTERNAL", "DEADLINE_EXCEEDED", "UNKNOWN"]
const fieldNames = new Set("generation_config generationConfig response_json_schema responseJsonSchema response_schema responseSchema response_mime_type responseMimeType thinking_config thinkingConfig thinking_level thinkingLevel thinking_budget thinkingBudget max_output_tokens maxOutputTokens system_instruction systemInstruction tools tool_config toolConfig function_declarations functionDeclarations contents parts text properties items required type enum anyOf oneOf allOf minLength maxLength minItems maxItems additionalProperties minimum maximum blocks kind title id estimateId ordered cardIds queries status guideId intent start end comparisonStart comparisonEnd category method task targetPaise reductionBps".split(" "))
function safeFields(body) {
  const paths = Array.isArray(body.details) ? body.details.flatMap((detail) => Array.isArray(detail?.fieldViolations) ? detail.fieldViolations.map((entry) => entry.field) : []) : []
  return [...new Set(paths.filter((field) => typeof field === "string" && field.length < 240 && /^[a-zA-Z_][\w.[\]]*$/.test(field) && field.replace(/\[\d+\]/g, "").split(/[.[\]]+/).filter(Boolean).every((name) => fieldNames.has(name))))].slice(0, 4)
}
function payload(error) {
  if (error?.error && typeof error.error === "object") return error.error
  try { const value = JSON.parse(String(error?.message || "").slice(0, 32000)); return value.error || value } catch { return {} }
}
export function providerStatus(error) {
  const body = payload(error)
  return [error?.status, error?.code, body.code, error?.cause?.status].map(Number).find((value) => Number.isInteger(value) && value >= 400 && value <= 599)
}

export function geminiProviderError(error, { stage, model, schemaVersion, attempts = 1 }) {
  const body = payload(error), status = providerStatus(error)
  const raw = `${String(body.message || "")} ${String(error?.message || "")}`
  let reason, field, message
  if (/API_KEY_INVALID|api key (?:not valid|invalid)|invalid api key/i.test(raw)) { reason = "api_key_invalid"; message = "The provider rejected the backend API key." }
  else if (status === 429) { reason = "rate_limit"; message = "The provider's quota or rate limit was reached." }
  else if ([401, 403].includes(status)) { reason = "authorization"; message = "The provider rejected the backend API project's credentials or permissions." }
  else if (status === 404) { reason = "model_not_found"; message = "The configured model was not found for this API project." }
  else if (status === 503) { reason = "unavailable"; message = "The provider is temporarily unavailable." }
  else if (status === 504 || !status && (error?.name === "TimeoutError" || /timed? out|timeout|ETIMEDOUT/i.test(raw))) { reason = "timeout"; message = "The provider request did not finish within its deadline." }
  else if (status === 400 && /too many states|too much branching|(?:schema|constraint)[\s\S]{0,160}(?:too (?:large|complex)|complexity|nesting|exceed)/i.test(raw)) { reason = "schema_complexity"; field = "generationConfig.responseJsonSchema"; message = "The provider rejected the response schema's complexity or nesting." }
  else if (status === 400 && /schema|grammar|anyOf|oneOf|minLength|maxLength|additionalProperties/i.test(raw)) { reason = "schema_invalid"; field = "generationConfig.responseJsonSchema"; message = "The provider rejected a response-schema keyword or constraint." }
  else if (status === 400 && /thinking[_ .]?(?:config|level|budget)/i.test(raw)) { reason = "thinking_configuration"; field = "generationConfig.thinkingConfig"; message = "The provider rejected the thinking configuration." }
  else if (status === 400 && /mime[_ .]?type/i.test(raw)) { reason = "mime_configuration"; field = "generationConfig.responseMimeType"; message = "The provider rejected the response MIME type." }
  else if (status === 400 && /function[_ .]?declarations|tool[_ .]?config|function[_ .]?calling/i.test(raw)) { reason = "tool_configuration"; field = "tools"; message = "The provider rejected the tool configuration." }
  else if (status === 400) { reason = "request_configuration"; message = "The provider rejected the request configuration." }
  else if (status) { reason = "provider_failure"; message = "The provider could not complete the request." }
  else { reason = "transport_failure"; message = "The provider could not be reached." }
  // Never echo error.message/details: they may contain keys, prompts or records.
  const provider = {
    stage: stages.includes(stage) ? stage : "explanation", status: status || null,
    code: codes.includes(body.status) ? body.status : status === 400 ? "INVALID_ARGUMENT" : status === 429 ? "RESOURCE_EXHAUSTED" : status === 503 ? "UNAVAILABLE" : "UNKNOWN",
    reason, message, model: /^gemini-[a-z0-9.-]{1,70}$/i.test(model || "") ? model : "unrecognized",
    schemaVersion, attempts, ...(field ? { field } : {}),
  }
  const fields = safeFields(body)
  if (fields.length) provider.fields = fields
  if (reason === "schema_invalid" && /unknown|unsupported|not supported|not allowed/i.test(raw)) {
    const keyword = ["anyOf", "oneOf", "allOf", "minLength", "maxLength", "additionalProperties", "required"].find((key) => raw.includes(key))
    if (keyword) provider.keyword = keyword
  }
  const options = { origin: "provider", providerStatus: status, provider, retryable: ![400, 401, 403, 404].includes(status) }
  if (reason === "api_key_invalid" || reason === "authorization") return aiError(`Gemini rejected the backend credentials during ${provider.stage}.`, { ...options, code: "GEMINI_AUTH_FAILED" })
  if (reason === "model_not_found") return aiError(`The configured Gemini model ${provider.model} is unavailable for this API project. No fallback model was used.`, { ...options, code: "GEMINI_MODEL_UNAVAILABLE" })
  if (status === 400) return aiError(`Gemini rejected the ${provider.stage} request configuration (${reason}${field ? `: ${field}` : ""}).`, { ...options, status: 502, code: "GEMINI_REQUEST_REJECTED" })
  if (status === 429) return aiError(`Gemini's quota or rate limit was reached during ${provider.stage}. Please retry later.`, { ...options, status: 429, code: "GEMINI_RATE_LIMITED" })
  if (reason === "timeout") return aiError(`Gemini did not finish ${provider.stage} within the request deadline. Please retry.`, { ...options, status: 504, code: "GEMINI_TIMEOUT" })
  return aiError(`Gemini ${reason === "unavailable" ? "is temporarily unavailable" : "could not complete the request"} during ${provider.stage}. Please retry.`, { ...options, code: status ? "GEMINI_PROVIDER_FAILED" : "GEMINI_TRANSPORT_FAILED" })
}
