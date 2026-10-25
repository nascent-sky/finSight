import { analyseFinancialQuery, publicFinancialAnswer } from "./financialEngine.js"
import { planFinancialQuestion } from "./questionPlanner.js"
import { localRoutingReason, routingError, validateDevelopmentAnswer, validateFinancePolicy } from "./financeRouting.js"

export async function answerFinanceQuestion({ index, question, history = [], context, consent = false, development = false, policy, requestRoute, requestCloud, signal, now = new Date() }) {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  if (consent && requestRoute) {
    // Every consented message is routed by the authenticated server BEFORE
    // local interpretation, regardless of a cached UI policy or simple wording.
    const result = await requestRoute({ messages: [...history.slice(-10), { role: "user", content: question }], context, timezone: index.timezone, consent: true, signal })
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
    policy = validateFinancePolicy(result?.policy)
    if (result.route === "development") return validateDevelopmentAnswer(result)
    if (result.route !== "protected" || policy.mode === "development") throw routingError("The backend did not confirm a protected local route. Please retry.")
    if (context?.version === 2) throw routingError(`${localRoutingReason(policy, true).message} This development chat cannot silently switch to local answers. Start a new chat to use protected mode.`, "DEVELOPMENT_SESSION_CHANGED", "privacy")
  } else if (development && consent) {
    // Development always lets Gemini plan first, including factual questions,
    // informal follow-ups and local-parser ambiguities. The server rechecks UID.
    const result = await requestCloud({ mode: "development", messages: [...history.slice(-10), { role: "user", content: question }], context, timezone: index.timezone, consent: true, signal })
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
    return result
  }
  const userHistory = history.filter((message) => message.role === "user").slice(-5)
  const plan = planFinancialQuestion(question, userHistory, { now, timezone: index.timezone, categoryNames: index.categoryNames, context })
  const analysis = analyseFinancialQuery(index, plan)
  const local = publicFinancialAnswer(analysis)
  if (!plan.period && plan.preserveContext) local.context = context
  const routing = localRoutingReason(policy, consent)
  if (!["cloud", "interpret"].includes(plan.route) || analysis.empty) return { ...local, policy, routing, cloud: { status: "not_requested" } }
  if (!consent) return { ...local, policy, routing, cloud: { status: "consent_required", reason: "Gemini was not used. Cloud sharing is off; enable it for interpretation and explanations." } }
  // Once a provider request is intended, errors must remain retryable errors.
  const result = await requestCloud({ messages: [...userHistory, { role: "user", content: question }], context, timezone: index.timezone, consent: true, signal })
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  return { ...result, policy: result.policy || policy }
}
