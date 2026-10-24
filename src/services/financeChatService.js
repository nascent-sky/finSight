import { auth } from "../firebase"

async function postFinanceRequest({ user, body, signal }) {
  if (!user?.uid || user.isAnonymous || auth.currentUser?.uid !== user.uid) throw new Error("Sign in to use FinSight AI.")
  if (body.consent !== true) throw new Error("Enable AI sharing before sending a question.")
  if (!navigator.onLine) throw new Error("You’re offline. Reconnect to ask FinSight AI.")
  const token = await user.getIdToken()
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  if (auth.currentUser?.uid !== user.uid) throw new Error("Your account changed. Please start a new chat.")
  const response = await fetch("/api/finance-chat", {
    method: "POST", signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(50000)]),
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    if (response.status === 404 || !result) throw new Error("The cloud explanation service is unavailable. Its backend configuration needs attention.")
    const prefix = result.origin === "provider" ? "Gemini provider: " : result.origin === "configuration" ? "Backend configuration: " : result.origin === "privacy" ? "Privacy restriction: " : ""
    throw Object.assign(new Error(prefix + (result.error || "FinSight AI could not answer. Please retry.")), { code: result.code, origin: result.origin, providerStatus: result.providerStatus, status: response.status })
  }
  if (!result || typeof result.answer !== "string" || result.answer.length > 9000 || !Array.isArray(result.cards) || result.cards.length > 2) throw new Error("The cloud explanation service returned an invalid answer. Please retry.")
  return result
}

export async function requestFinanceChat({ user, messages, context = null, timezone, consent, signal }) {
  return postFinanceRequest({ user, signal, body: { consent, messages: messages.filter((message) => message.role === "user").slice(-6).map(({ content }) => ({ role: "user", content })), context, timezone } })
}

export async function requestFinanceDemo({ user, questionId, history = [], consent, signal }) {
  return postFinanceRequest({ user, signal, body: { mode: "synthetic", consent, questionId, history: history.slice(-19) } })
}
