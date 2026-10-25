import test from "node:test"
import assert from "node:assert/strict"
import { createChatHandler } from "../functions/finance-chat.mjs"
import { aiError } from "../lib/aiErrors.js"
import { developmentEnabled, financeCapabilities, financeDiagnostics, requireDevelopmentAccess } from "../lib/developmentPolicy.js"
import { FINANCE_ROUTING_VERSION, validateFinancePolicy } from "../../src/features/finance-ai/financeRouting.js"

const uid = "PRIVATE-authenticated-test-uid"
const token = "PRIVATE-auth-token"
const env = { AI_ALLOWED_ORIGIN: "https://finsight.example", FIREBASE_PROJECT_ID: "test-project", GEMINI_API_KEY: "PRIVATE-api-key", GEMINI_MODEL: "gemini-3.8-flash", GEMINI_DATA_HANDLING: "development", GEMINI_DEVELOPMENT_DATA: "fictional", GEMINI_DEVELOPMENT_UIDS: `other-test-account,\n${uid}` }
const route = { action: "route", consent: true, timezone: "Asia/Kolkata", messages: [{ role: "user", content: "PRIVATE-financial-question" }] }
const request = (body, headers = {}) => new Request(`${env.AI_ALLOWED_ORIGIN}/api/finance-chat`, { method: "POST", headers: { origin: env.AI_ALLOWED_ORIGIN, authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
function handler(settings = env, options = {}) {
  return createChatHandler({ env: settings, verifyToken: async () => uid, retrieve: async () => { throw new Error("Diagnostics must not retrieve records") }, development: async () => { throw new Error("Provider must be explicitly mocked") }, ...options })
}

test("the disabled message means only the exact data-handling predicate failed, including in production", () => {
  for (const context of [undefined, "production", "dev", "deploy-preview"]) {
    for (const value of [undefined, "", "disabled", "paid", " development ", '"development"', "DEVELOPMENT"]) {
      const settings = { ...env, CONTEXT: context, GEMINI_DATA_HANDLING: value }
      const policy = financeCapabilities(settings, uid)
      assert.equal(policy.reasons[0].code, "DEVELOPMENT_DISABLED")
      assert.equal(policy.development.enabled, false)
      assert.equal(developmentEnabled(settings, uid), false)
      assert.throws(() => requireDevelopmentAccess(settings, uid), { code: "DEVELOPMENT_ACCESS_DENIED" })
      if (value == null || !value) {
        assert.equal(policy.diagnostics.dataHandling, "missing")
        assert.match(policy.reasons[0].message, /missing.*deployed function/)
      } else if (["paid", "disabled"].includes(value)) {
        assert.equal(policy.diagnostics.dataHandling, value)
        assert.match(policy.reasons[0].message, new RegExp(`GEMINI_DATA_HANDLING=${value}`))
      } else {
        assert.equal(policy.diagnostics.dataHandling, "unrecognized")
        assert.match(policy.reasons[0].message, /exact value development/)
      }
    }
    const valid = financeCapabilities({ ...env, CONTEXT: context }, uid)
    assert.equal(valid.mode, "development")
    assert.deepEqual(valid.reasons, [])
  }
})

test("UID, fictional-data and key failures cannot be misreported as development disabled", () => {
  for (const [settings, code, field, state] of [
    [{ ...env, GEMINI_DEVELOPMENT_UIDS: "" }, "TEST_UID_NOT_ALLOWLISTED", "uidAllowlist", "not_configured"],
    [{ ...env, GEMINI_DEVELOPMENT_UIDS: uid.toUpperCase() }, "TEST_UID_NOT_ALLOWLISTED", "uidAllowlist", "not_matched"],
    [{ ...env, GEMINI_DEVELOPMENT_UIDS: JSON.stringify([uid]) }, "TEST_UID_NOT_ALLOWLISTED", "uidAllowlist", "not_matched"],
    [{ ...env, GEMINI_DEVELOPMENT_DATA: undefined }, "DEVELOPMENT_DATA_UNCONFIRMED", "fictionalData", "missing"],
    [{ ...env, GEMINI_DEVELOPMENT_DATA: '"fictional"' }, "DEVELOPMENT_DATA_UNCONFIRMED", "fictionalData", "unrecognized"],
    [{ ...env, GEMINI_API_KEY: " " }, "GEMINI_KEY_MISSING", "geminiKey", "missing"],
  ]) {
    const policy = financeCapabilities(settings, uid)
    assert.equal(policy.reasons[0].code, code)
    assert.equal(policy.diagnostics[field], state)
    assert.equal(policy.diagnostics.dataHandling, "development")
  }
})

test("a deployed environment snapshot stays protected until a new handler receives the updated settings", async () => {
  const saved = { ...env, GEMINI_DATA_HANDLING: undefined }
  const oldDeployment = handler({ ...saved })
  saved.GEMINI_DATA_HANDLING = "development"
  const old = await (await oldDeployment(request(route))).json()
  assert.equal(old.route, "protected")
  assert.equal(old.policy.diagnostics.dataHandling, "missing")
  assert.match(old.policy.reasons[0].message, /new deployment/)
  let providerCalls = 0
  const newDeployment = handler({ ...saved }, { development: async () => {
    providerCalls++
    return { source: "gemini_development", fictionalDataOnly: true, answer: "Mock Gemini response", cards: [], cloud: { status: "used", dataHandling: "development" } }
  } })
  const current = await (await newDeployment(request(route))).json()
  assert.equal(providerCalls, 1)
  assert.equal(current.route, "development")
  assert.equal(current.policy.diagnostics.cloudConsent, "enabled")
  assert.equal(current.policy.diagnostics.uidAllowlist, "matched")
})

test("authenticated capability diagnostics identify this backend revision without changing the routing contract", async () => {
  const response = await handler()(request({ action: "capabilities" }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const policy = await response.json()
  assert.equal(validateFinancePolicy(policy), policy)
  assert.equal(policy.routingVersion, FINANCE_ROUTING_VERSION)
  assert.equal(policy.diagnostics.backendRevision, "finance-policy-diagnostics-2026-10-25")
  assert.equal(policy.diagnostics.cloudConsent, "not_evaluated")
  assert.equal(financeDiagnostics({ ...env, GEMINI_MODEL: "" }, uid).geminiModel, "default")
  assert.throws(() => validateFinancePolicy({ ...policy, routingVersion: 0 }), { code: "AI_ROUTING_VERSION_MISMATCH" })
})

test("origin and authentication failures never expose eligibility diagnostics", async () => {
  for (const headers of [{ authorization: "" }, { origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }]) {
    const response = await handler()(request({ action: "capabilities" }, headers))
    assert.ok([401, 403].includes(response.status))
    assert.equal(Object.hasOwn(await response.json(), "diagnostics"), false)
  }
  const response = await handler(env, { verifyToken: async () => { throw aiError("Sign in", { status: 401 }) } })(request({ action: "capabilities" }))
  assert.equal(response.status, 401)
  assert.equal(Object.hasOwn(await response.json(), "diagnostics"), false)
})

test("consent, access, configuration and provider errors retain their cause and safe diagnostics", async () => {
  for (const [settings, body, code, field, value, status] of [
    [env, { ...route, consent: false }, "AI_CONSENT_REQUIRED", "cloudConsent", "disabled", 403],
    [{ ...env, GEMINI_DEVELOPMENT_UIDS: "someone-else" }, { ...route, mode: "development" }, "DEVELOPMENT_ACCESS_DENIED", "uidAllowlist", "not_matched", 403],
    [{ ...env, GEMINI_DEVELOPMENT_DATA: "" }, { ...route, mode: "development" }, "DEVELOPMENT_DATA_UNCONFIRMED", "fictionalData", "missing", 503],
    [{ ...env, GEMINI_API_KEY: "" }, route, "GEMINI_KEY_MISSING", "geminiKey", "missing", 503],
  ]) {
    const response = await handler(settings)(request(body))
    assert.equal(response.status, status)
    const result = await response.json()
    assert.equal(result.code, code)
    assert.equal(result.diagnostics[field], value)
    assert.equal(Object.hasOwn(result, "answer"), false)
  }
  const response = await handler(env, { development: async () => { throw aiError("Gemini provider unavailable", { code: "GEMINI_PROVIDER_FAILED", origin: "provider", providerStatus: 503 }) } })(request(route))
  const result = await response.json()
  assert.equal(response.status, 503)
  assert.equal(result.code, "GEMINI_PROVIDER_FAILED")
  assert.equal(result.origin, "provider")
  assert.equal(result.providerStatus, 503)
  assert.equal(result.diagnostics.dataHandling, "development")
  assert.equal(result.diagnostics.cloudConsent, "enabled")
  assert.equal(Object.hasOwn(result, "answer"), false)
})

test("diagnostics and configuration messages never echo unknown values, keys, UIDs, tokens or questions", async () => {
  const settings = { ...env, GEMINI_DATA_HANDLING: "PRIVATE-mode-value", GEMINI_DEVELOPMENT_DATA: "PRIVATE-policy-value", GEMINI_MODEL: "PRIVATE-model-value" }
  const response = await handler(settings)(request(route))
  const result = await response.json()
  assert.equal(result.route, "protected")
  assert.equal(result.policy.diagnostics.dataHandling, "unrecognized")
  assert.equal(result.policy.diagnostics.fictionalData, "unrecognized")
  const serialized = JSON.stringify(result)
  for (const secret of ["PRIVATE-", uid, token, env.GEMINI_API_KEY, "other-test-account"]) assert.equal(serialized.includes(secret), false)
})
