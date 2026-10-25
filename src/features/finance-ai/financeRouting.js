// Shared by the browser and function to detect mismatched deployed versions.
export const FINANCE_ROUTING_VERSION = 1

export function routingError(message, code = "AI_ROUTING_UNVERIFIED", origin = "configuration") {
  return Object.assign(new Error(message), { code, origin, retryable: true })
}

export function validateFinancePolicy(value) {
  if (!value || value.routingVersion !== FINANCE_ROUTING_VERSION || !["development", "paid", "protected"].includes(value.mode) || typeof value.cloudConfigured !== "boolean" || typeof value.fictionalDataOnly !== "boolean" || !Array.isArray(value.reasons) || value.reasons.some((reason) => typeof reason?.code !== "string" || typeof reason?.message !== "string") || value.mode === "development" && !value.fictionalDataOnly) {
    throw routingError("The deployed frontend and AI function routing could not be matched. Retry the routing check; a missing or older backend must not be treated as protected mode.", "AI_ROUTING_VERSION_MISMATCH")
  }
  return value
}

export function validateDevelopmentAnswer(value) {
  if (value?.routingVersion !== FINANCE_ROUTING_VERSION || value.source !== "gemini_development" || value.fictionalDataOnly !== true || value.cloud?.status !== "used" || value.cloud?.dataHandling !== "development") throw routingError("The AI function did not return a Gemini-generated development answer. Retry; no local answer was substituted.", "DEVELOPMENT_RESPONSE_MISMATCH")
  return value
}

export function localRoutingReason(policy, consent) {
  if (consent && policy?.mode === "development" && policy.cloudConfigured) return { code: "DEVELOPMENT_ACTIVE", message: "Gemini-first development routing is active. The server checks every conversational message.", reasons: [] }
  const reasons = [...(!consent ? [{ code: "CLOUD_SHARING_DISABLED", message: "Cloud sharing is disabled." }] : []), ...(policy?.reasons || [])]
  return { code: reasons[0]?.code || "PROTECTED_LOCAL_ANSWER", message: reasons.map((reason) => reason.message).join(" ") || "The server selected protected local processing.", reasons }
}

export function financeSourceLabel(source) {
  return { local: "Local financial answer", gemini: "Gemini-generated answer", gemini_development: "Gemini-generated answer · Development · fictional test data", gemini_demo: "Gemini-generated synthetic demonstration", gemini_intent: "Gemini interpreted · FinSight calculated" }[source] || "Unverified response source"
}
