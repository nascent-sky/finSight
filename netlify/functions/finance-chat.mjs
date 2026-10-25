import { verifyFirebaseToken } from "../lib/firebaseToken.js"
import { retrieveFinancialRecords } from "../lib/financialRetrieval.js"
import { explainWithGemini, explainSyntheticWithGemini, interpretSafeWithGemini, interpretWithGemini, requireGeminiConfiguration } from "../lib/geminiFinance.js"
import { aiError } from "../lib/aiErrors.js"
import { safeValidationDetails } from "../lib/modelValidation.js"
import { financeCapabilities, financeDiagnostics, requireDevelopmentAccess } from "../lib/developmentPolicy.js"
import { runDevelopmentConversation, validateDevelopmentMessages } from "../lib/developmentConversation.js"
import { isContinuation, normalizeQuestion } from "../../src/features/finance-ai/questionLanguage.js"
import { conversationContextFromPlan, localDateKey, planFinancialQuestion, validateConversationContext } from "../../src/features/finance-ai/questionPlanner.js"
import { analyseFinancialQuery, createFinancialIndex, publicFinancialAnswer } from "../../src/features/finance-ai/financialEngine.js"
import { FINANCE_ROUTING_VERSION, isVerifiedNarrativeRecovery } from "../../src/features/finance-ai/financeRouting.js"
import { appGuideResponse, findAppGuide } from "../../src/features/finance-ai/appGuidance.js"

const MAX_BODY = 32 * 1024
const json = (body, status = 200) => Response.json({ ...body, routingVersion: FINANCE_ROUTING_VERSION }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Origin" } })
const fail = (message, status = 400, code = "AI_REQUEST_INVALID", origin = "application") => { throw aiError(message, { status, code, origin }) }

async function readBody(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail("Send a JSON request.", 415)
  if (Number(request.headers.get("content-length")) > MAX_BODY) fail("The chat request is too large.", 413)
  const reader = request.body?.getReader()
  if (!reader) fail("A chat request is required.")
  let bytes = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_BODY) { await reader.cancel(); fail("The chat request is too large.", 413) }
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { fail("The chat request is invalid.") }
  } finally { reader.releaseLock() }
}

// Counters only: never cache financial data or conversation across requests.
function takeUsage(usage, uid, now) {
  for (const [key, entry] of usage) if (entry.expires <= now && !entry.busy) usage.delete(key)
  const entry = usage.get(uid) || { count: 0, expires: now + 3600_000, busy: false }
  if (entry.busy) fail("An answer is already being prepared. Please wait.", 429, "AI_REQUEST_BUSY")
  if (entry.count >= 30) fail("Your cloud AI limit has been reached. Try again in an hour.", 429, "AI_RATE_LIMITED")
  if (usage.size >= 10000 && !usage.has(uid)) fail("FinSight AI is busy. Try again shortly.", 429)
  entry.count++
  entry.busy = true
  usage.set(uid, entry)
  return () => { entry.busy = false }
}

export function createChatHandler({ env = process.env, fetcher = fetch, verifyToken = verifyFirebaseToken, retrieve = retrieveFinancialRecords, explain = explainWithGemini, interpret = interpretWithGemini, interpretSafe = interpretSafeWithGemini, demonstrate = explainSyntheticWithGemini, development = runDevelopmentConversation, now = Date.now } = {}) {
  const usage = new Map()
  return async (request) => {
    let release
    let diagnostics
    try {
      if (request.method !== "POST") return json({ error: "Use POST to send a question." }, 405)
      const origins = [env.AI_ALLOWED_ORIGIN, env.URL, env.DEPLOY_PRIME_URL].filter(Boolean)
      if (!origins.includes(request.headers.get("origin")) || request.headers.get("sec-fetch-site") === "cross-site") fail("Open FinSight AI from the configured app address.", 403)
      if (!env.FIREBASE_PROJECT_ID) fail("FinSight AI needs FIREBASE_PROJECT_ID on the backend.", 503, "FIREBASE_PROJECT_MISSING", "configuration")
      const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1]
      if (!token) fail("Sign in to use FinSight AI. Guest records stay on this device.", 401)
      const uid = await verifyToken(token, env.FIREBASE_PROJECT_ID, fetcher)
      const body = await readBody(request)
      if (!body || typeof body !== "object" || Array.isArray(body)) fail("Send a valid chat request.")
      // Diagnostics are available only after origin, authentication and JSON
      // validation. They contain fixed states, never values or identifiers.
      diagnostics = financeDiagnostics(env, uid, body.consent)
      if (body.action === "capabilities") {
        if (Object.keys(body).some((key) => key !== "action")) fail("Send only a capabilities request.")
        return json(financeCapabilities(env, uid))
      }
      if (![undefined, "personal", "synthetic", "development"].includes(body.mode)) fail("Choose a supported financial chat mode.")
      if (body.mode === "synthetic") {
        if (Object.keys(body).some((key) => !["mode", "consent", "questionId", "history"].includes(key))) fail("Synthetic demos accept fixed question IDs only, never personal questions, records or context.")
        if (body.consent !== true) fail("Allow cloud AI before starting a Gemini demonstration.", 403, "AI_CONSENT_REQUIRED", "privacy")
        requireGeminiConfiguration(env, { privateContext: false })
        release = takeUsage(usage, uid, now())
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
        return json(await demonstrate({ env, questionId: body.questionId, history: body.history, signal }))
      }
      const policy = financeCapabilities(env, uid, body.consent)
      const routingRequest = body.action === "route"
      // Questions are intent, never financial authority or an asserted identity.
      if (Object.keys(body).some((key) => !["mode", "messages", "timezone", "consent", "context", ...(routingRequest ? ["action"] : [])].includes(key))) fail("Send questions and a bounded conversation scope only; financial totals and user IDs are not accepted.")
      if (routingRequest && body.consent !== true) fail("Enable cloud sharing before requesting conversational cloud routing.", 403, "AI_CONSENT_REQUIRED", "privacy")
      // Eligibility is server authority. A stale personal-mode client cannot
      // short-circuit Gemini for an eligible, consented development account.
      const isDevelopment = body.mode === "development" || body.consent === true && policy.mode === "development"
      if (isDevelopment) requireDevelopmentAccess(env, uid)
      if (routingRequest && !isDevelopment) {
        validateDevelopmentMessages(body.messages)
        return json({ route: "protected", policy })
      }
      if (!isDevelopment && (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 6)) fail("Start a new chat or shorten the conversation.")
      const messages = isDevelopment ? validateDevelopmentMessages(body.messages) : body.messages.map((message) => {
        if (message?.role !== "user" || typeof message.content !== "string" || !message.content.trim() || message.content.length > 1200) fail("The question history is invalid or a message is too long.")
        return { role: "user", content: message.content.trim() }
      })
      if (typeof body.timezone !== "string" || body.timezone.length > 80) fail("Choose a valid local timezone.")
      try { new Intl.DateTimeFormat("en-IN", { timeZone: body.timezone }).format() } catch { fail("Choose a valid local timezone.") }
      const instant = new Date(now())
      if (isDevelopment) {
        if (body.consent !== true) fail("Allow cloud sharing before sending fictional development questions and financial context to Gemini.", 403, "AI_CONSENT_REQUIRED", "privacy")
        requireGeminiConfiguration(env, { privateContext: false })
        release = takeUsage(usage, uid, now())
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
        const result = await development({ env, uid, token, messages, context: body.context, timezone: body.timezone, now: instant, signal, retrieve, fetcher })
        if (result.fictionalDataOnly !== true || !(result.source === "gemini_development" && result.cloud?.status === "used" || isVerifiedNarrativeRecovery(result))) fail("The development pipeline did not return a Gemini-generated answer or explicit verified narrative recovery.", 502, "DEVELOPMENT_RESPONSE_MISMATCH", "provider")
        return json({ ...result, route: "development", policy })
      }
      const last = messages.at(-1).content
      const history = messages.slice(0, -1)
      const context = Object.hasOwn(body, "context") ? validateConversationContext(body.context, { asOf: localDateKey(instant, body.timezone) }) : undefined
      const guide = findAppGuide(last)
      if (guide) return json(appGuideResponse(guide, context || null))
      let plan = planFinancialQuestion(last, history, { now: instant, timezone: body.timezone, context })
      if (["clarify", "conversation"].includes(plan.route)) return json({ answer: plan.message, cards: [], asOf: plan.asOf, source: "local", context: plan.preserveContext ? context || null : null, cloud: { status: "not_requested" } })
      if (["cloud", "interpret"].includes(plan.route)) {
        if (body.consent !== true) fail("Enable Gemini cloud sharing before asking for interpretation or an explanation.", 403, "AI_CONSENT_REQUIRED", "privacy")
        requireGeminiConfiguration(env, { privateContext: false })
      }
      release = takeUsage(usage, uid, now())
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
      let interpreted = false
      const privateAllowed = env.GEMINI_DATA_HANDLING === "paid"
      const safeInterpretation = !privateAllowed && ["interpret", "cloud"].includes(plan.route)
      if (plan.route === "interpret" || safeInterpretation) {
        const continuation = plan.route === "interpret" ? plan.preserveContext : isContinuation(normalizeQuestion(last))
        const previous = !continuation ? null : context === undefined && history.length ? conversationContextFromPlan(planFinancialQuestion(history.at(-1).content, history.slice(0, -1), { now: instant, timezone: body.timezone })) : context || null
        const constraints = plan.constraints || { intent: plan.intent }
        plan = safeInterpretation
          ? await interpretSafe({ env, question: last, localPlan: plan, context: previous, signal })
          : await interpret({ env, questions: messages.map((message) => message.content), context: previous, now: instant, timezone: body.timezone, signal })
        interpreted = true
        if (plan.route === "clarify") return json({ answer: plan.message, cards: [], asOf: plan.asOf, source: "gemini_intent", context: plan.preserveContext ? previous : null, cloud: { status: "used", stage: "interpretation", dataHandling: safeInterpretation ? "abstract_intent" : "paid" } })
        const changedPeriod = constraints?.period && (constraints.period.start !== plan.period.start || constraints.period.end !== plan.period.end)
        const changedComparison = constraints?.comparison && (constraints.comparison.start !== plan.comparison?.start || constraints.comparison.end !== plan.comparison?.end)
        const changedFilter = constraints?.method && constraints.method !== plan.method || constraints?.category && constraints.category.toLowerCase() !== plan.category?.toLowerCase()
        if (changedPeriod || changedComparison || changedFilter || constraints?.intent && constraints.intent !== plan.intent) fail("The interpreted scope did not preserve your explicit intent or filters. Please rephrase.", 502, "GEMINI_OUTPUT_INVALID", "provider")
      }
      const records = await retrieve({ uid, token, projectId: env.FIREBASE_PROJECT_ID, range: plan.retrieval, signal, fetcher })
      const index = createFinancialIndex(records, { now: instant, timezone: body.timezone })
      if (!interpreted) plan = planFinancialQuestion(last, history, { now: instant, timezone: body.timezone, categoryNames: index.categoryNames, context })
      const analysis = analyseFinancialQuery(index, plan)
      if (safeInterpretation || plan.route !== "cloud" || analysis.empty) return json({ ...publicFinancialAnswer(analysis), source: interpreted ? "gemini_intent" : "local", cloud: { status: interpreted ? "used" : "not_requested", ...(interpreted ? { stage: "interpretation", dataHandling: safeInterpretation ? "abstract_intent" : "paid" } : {}), ...(safeInterpretation ? { reason: "Gemini interpreted abstract query hints only. FinSight calculated this answer; explaining personal financial context still requires paid data handling." } : {}) } })
      const explanation = await explain({ env, plan, analysis, financialIndex: index, questions: messages.map((message) => message.content), signal })
      return json({ ...explanation, context: conversationContextFromPlan(plan), cloud: explanation.cloud || { status: "used", stage: "explanation" } })
    } catch (error) {
      // Never log tokens, questions, provider errors, or financial records.
      const validation = safeValidationDetails(error)
      return json({ error: error.status ? error.message : "FinSight AI could not complete the request. Please retry shortly.", code: error.code || "AI_REQUEST_FAILED", origin: error.origin || "application", ...(error.providerStatus ? { providerStatus: error.providerStatus } : {}), ...(error.provider ? { provider: error.provider } : {}), ...(typeof error.retryable === "boolean" ? { retryable: error.retryable } : {}), ...(diagnostics ? { diagnostics } : {}), ...(validation ? { validation } : {}) }, error.status || 503)
    } finally { release?.() }
  }
}

export default createChatHandler()
export const config = { path: "/api/finance-chat", rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ["ip", "domain"] } }
