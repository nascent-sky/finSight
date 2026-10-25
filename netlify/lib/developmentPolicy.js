import { aiError } from "./aiErrors.js"
import { FINANCE_ROUTING_VERSION } from "../../src/features/finance-ai/financeRouting.js"

function testUids(env) {
  return String(env.GEMINI_DEVELOPMENT_UIDS || "").split(/[,\s]+/).filter(Boolean)
}

// Independent of the routing protocol: identifies this diagnostic-capable
// function revision even when an older function uses the same routingVersion.
const BACKEND_REVISION = "finance-policy-diagnostics-2026-10-25"
function settingState(value, accepted) {
  if (typeof value !== "string" || !value.trim()) return "missing"
  // Classify only; never normalize a privacy opt-in or echo unknown values.
  return accepted.includes(value) ? value : "unrecognized"
}

export function financeDiagnostics(env, uid, consent) {
  const uids = testUids(env)
  return {
    backendRevision: BACKEND_REVISION,
    dataHandling: settingState(env.GEMINI_DATA_HANDLING, ["development", "paid", "disabled"]),
    fictionalData: settingState(env.GEMINI_DEVELOPMENT_DATA, ["fictional"]),
    uidAllowlist: !uids.length ? "not_configured" : uids.includes(uid) ? "matched" : "not_matched",
    geminiKey: env.GEMINI_API_KEY?.trim() ? "configured" : "missing",
    geminiModel: env.GEMINI_MODEL?.trim() ? "configured" : "default",
    cloudConsent: consent === undefined ? "not_evaluated" : consent === true ? "enabled" : "disabled",
  }
}

export function developmentEnabled(env, uid) {
  return env.GEMINI_DATA_HANDLING === "development" && env.GEMINI_DEVELOPMENT_DATA === "fictional" && testUids(env).includes(uid)
}

export function requireDevelopmentAccess(env, uid) {
  if (env.GEMINI_DATA_HANDLING !== "development" || !uid || !testUids(env).includes(uid)) throw aiError("Full development AI is restricted to designated authenticated test accounts.", { status: 403, code: "DEVELOPMENT_ACCESS_DENIED", origin: "privacy" })
  if (env.GEMINI_DEVELOPMENT_DATA !== "fictional") throw aiError("Development AI requires GEMINI_DEVELOPMENT_DATA=fictional to confirm that allowlisted accounts contain only fictional test records.", { code: "DEVELOPMENT_DATA_UNCONFIRMED", origin: "configuration" })
}

export function financeCapabilities(env, uid, consent) {
  const enabled = env.GEMINI_DATA_HANDLING === "development"
  const allowlisted = testUids(env).includes(uid)
  const dataConfirmed = env.GEMINI_DEVELOPMENT_DATA === "fictional"
  const cloudConfigured = Boolean(env.GEMINI_API_KEY?.trim())
  const diagnostics = financeDiagnostics(env, uid, consent)
  const reasons = []
  if (!enabled) reasons.push({ code: "DEVELOPMENT_DISABLED", message: diagnostics.dataHandling === "missing"
    ? "GEMINI_DATA_HANDLING is missing from this deployed function's environment. Netlify environment changes require a new deployment."
    : diagnostics.dataHandling === "unrecognized"
      ? "GEMINI_DATA_HANDLING is unrecognized on this backend. Development requires the exact value development, without surrounding whitespace or quotes and with matching case."
      : `Gemini-first development mode is disabled on this backend (GEMINI_DATA_HANDLING=${diagnostics.dataHandling}).` })
  else if (!allowlisted) reasons.push({ code: "TEST_UID_NOT_ALLOWLISTED", message: "This authenticated test UID is not allowlisted for development AI." })
  else if (!dataConfirmed) reasons.push({ code: "DEVELOPMENT_DATA_UNCONFIRMED", message: "The server has not confirmed the fictional development data policy." })
  if (!cloudConfigured) reasons.push({ code: "GEMINI_KEY_MISSING", message: "The backend Gemini API key is missing." })
  return { routingVersion: FINANCE_ROUTING_VERSION, mode: developmentEnabled(env, uid) ? "development" : env.GEMINI_DATA_HANDLING === "paid" ? "paid" : "protected", cloudConfigured, fictionalDataOnly: developmentEnabled(env, uid), development: { enabled, allowlisted, dataConfirmed }, reasons, diagnostics }
}

// Applied to every string in development provider input, including question
// history, category labels and calculated fact descriptions. Record people,
// notes and IDs are excluded structurally before reaching this boundary.
export function sanitizeDevelopmentInput(value, { env, uid, token }) {
  const secrets = [env.GEMINI_API_KEY, uid, token, ...testUids(env)].filter(Boolean)
  const scrub = (text) => {
    let result = text
    for (const secret of secrets) result = result.split(secret).join("[redacted]")
    return result
      .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi, "[email removed]")
      .replace(/\bBearer\s+[A-Za-z0-9_.-]+/gi, "[authorization removed]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[token removed]")
      .replace(/\bAIza[A-Za-z0-9_-]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b/g, "[key removed]")
      .replace(/\b(?:firebase\s*uid|uid|user[_ -]?id|api[_ -]?key|auth(?:entication)?[_ -]?token|email|phone|mobile|account\s*(?:number|no\.?))\s*[:=]\s*[^\s,;]+/gi, "[identifier removed]")
      .replace(/\b(?:password|passcode|access[_ -]?token|refresh[_ -]?token|phone(?: number)?|mobile(?: number)?|account number|card number|aadhaar|pan)\s*(?:is|:|=)\s*[^\s,;]+/gi, "[private identifier removed]")
      .replace(/\b(?:my name is|my address is|my phone is|my email is)\s+[^.!?\n]+/gi, "[personal information removed]")
  }
  if (typeof value === "string") return scrub(value)
  if (Array.isArray(value)) return value.map((entry) => sanitizeDevelopmentInput(entry, { env, uid, token }))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeDevelopmentInput(entry, { env, uid, token })]))
  return value
}
