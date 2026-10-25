import { FINANCE_ROUTING_VERSION, routingError, validateDevelopmentAnswer, validateFinancePolicy } from "../features/finance-ai/financeRouting.js"

// The production service injects Firebase's current user. Tests exercise this
// same HTTP serialization/validation against the real function handler.
export function createFinanceChatClient({ getCurrentUser, fetcher = (...args) => fetch(...args), online = () => navigator.onLine }) {
  async function post({ user, body, signal }) {
    if (!user?.uid || user.isAnonymous || getCurrentUser()?.uid !== user.uid) throw new Error("Sign in to use FinSight AI.")
    if (body.action !== "capabilities" && body.consent !== true) throw new Error("Enable AI sharing before sending a question.")
    if (!online()) throw new Error("You’re offline. Reconnect to ask FinSight AI.")
    const token = await user.getIdToken()
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
    if (getCurrentUser()?.uid !== user.uid) throw new Error("Your account changed. Please start a new chat.")
    const response = await fetcher("/api/finance-chat", { method: "POST", signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(50000)]), headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    const result = await response.json().catch(() => null)
    if (["capabilities", "route"].includes(body.action) && (response.ok || [400, 404].includes(response.status)) && result?.routingVersion !== FINANCE_ROUTING_VERSION) throw routingError("The deployed AI function does not support this frontend's routing protocol. Retry the routing check; the frontend and Netlify function versions must match.", "AI_ROUTING_VERSION_MISMATCH")
    if (!response.ok) {
      if (response.status === 404 || !result) throw routingError("The AI function is unavailable or does not match this frontend. Retry; cloud requests will not fall back to local answers.", "AI_BACKEND_UNAVAILABLE")
      const prefix = result.origin === "provider" ? "Gemini provider: " : result.origin === "configuration" ? "Backend configuration: " : result.origin === "privacy" ? "Privacy restriction: " : ""
      throw Object.assign(new Error(prefix + (result.error || "FinSight AI could not answer. Please retry.")), { code: result.code, origin: result.origin, providerStatus: result.providerStatus, status: response.status, retryable: true })
    }
    if (body.action === "capabilities") return validateFinancePolicy(result)
    if (body.action === "route") {
      validateFinancePolicy(result?.policy)
      if (result.route === "protected" && result.policy.mode !== "development") return result
      if (result.route !== "development") throw routingError("The backend did not confirm a supported conversation route.")
      validateDevelopmentAnswer(result)
    }
    if (!result || typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 9000 || !Array.isArray(result.cards) || result.cards.length > 2 || !["local", "gemini", "gemini_demo", "gemini_development", "gemini_intent"].includes(result.source)) throw routingError("The cloud service returned an invalid answer or response source. Please retry.", "AI_RESPONSE_INVALID")
    if (body.mode === "development" || result.policy?.mode === "development") validateDevelopmentAnswer(result)
    return result
  }
  const fullHistory = (messages) => messages.slice(-11).map(({ role, content }) => ({ role, content: role === "assistant" ? content.slice(0, 2000) : content }))
  return {
    requestCapabilities: ({ user, signal }) => post({ user, signal, body: { action: "capabilities" } }),
    requestRoute: ({ user, messages, context = null, timezone, consent, signal }) => post({ user, signal, body: { action: "route", consent, messages: fullHistory(messages), context, timezone } }),
    requestChat: ({ user, messages, mode = "personal", context = null, timezone, consent, signal }) => post({ user, signal, body: { ...(mode === "development" ? { mode } : {}), consent, messages: mode === "development" ? fullHistory(messages) : messages.filter((message) => message.role === "user").slice(-6).map(({ content }) => ({ role: "user", content })), context, timezone } }),
    requestDemo: ({ user, questionId, history = [], consent, signal }) => post({ user, signal, body: { mode: "synthetic", consent, questionId, history: history.slice(-19) } }),
  }
}
