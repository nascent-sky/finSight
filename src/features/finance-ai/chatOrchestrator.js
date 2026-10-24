import { analyseFinancialQuery, publicFinancialAnswer } from "./financialEngine.js"
import { planFinancialQuestion } from "./questionPlanner.js"

export async function answerFinanceQuestion({ index, question, history = [], context, consent = false, requestCloud, signal, now = new Date() }) {
  if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
  const plan = planFinancialQuestion(question, history, { now, timezone: index.timezone, categoryNames: index.categoryNames, context })
  const analysis = analyseFinancialQuery(index, plan)
  const local = publicFinancialAnswer(analysis)
  if (!plan.period && plan.preserveContext) local.context = context
  if (!["cloud", "interpret"].includes(plan.route) || analysis.empty) return { ...local, cloud: { status: "not_requested" } }
  if (!consent) return { ...local, cloud: { status: "consent_required", reason: "Gemini was not used. Cloud sharing is off; enable it for interpretation and explanations." } }
  try {
    const result = await requestCloud({ messages: [...history.slice(-5), { role: "user", content: question }], context, timezone: index.timezone, consent: true, signal })
    if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError")
    return result
  } catch (error) {
    if (signal?.aborted || error.name === "AbortError") throw error
    return { ...local, cloud: { status: "unavailable", reason: error.message || "Gemini is unavailable. This response was calculated locally.", code: error.code, origin: error.origin, providerStatus: error.providerStatus } }
  }
}
