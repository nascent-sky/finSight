export function aiError(message, { status = 503, code = "AI_UNAVAILABLE", origin = "application", providerStatus, provider, retryable } = {}) {
  return Object.assign(new Error(message), { status, code, origin, ...(providerStatus ? { providerStatus } : {}), ...(provider ? { provider } : {}), ...(typeof retryable === "boolean" ? { retryable } : {}) })
}
