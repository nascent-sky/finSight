import test from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { verifyFirebaseToken } from "./firebaseToken.js"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const now = Date.now()
const seconds = Math.floor(now / 1000)
const claims = { aud: "test-project", iss: "https://securetoken.google.com/test-project", sub: "test-user", iat: seconds - 60, exp: seconds + 3600, auth_time: seconds - 60, firebase: { sign_in_provider: "google.com" } }
const token = (updates = {}, headerUpdates = {}) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const unsigned = `${encode({ alg: "RS256", kid: "test-key", ...headerUpdates })}.${encode({ ...claims, ...updates })}`
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`
}
let keyCalls = 0
const fetchKeys = async () => { keyCalls++; return Response.json({ "test-key": publicKey.export({ type: "spki", format: "pem" }) }, { headers: { "cache-control": "max-age=3600" } }) }

test("verifies signed Firebase identity, project, issuer, expiry, auth time and caches Google keys", async () => {
  assert.equal(await verifyFirebaseToken(token(), "test-project", fetchKeys, now), "test-user")
  assert.equal(await verifyFirebaseToken(token(), "test-project", fetchKeys, now), "test-user")
  assert.equal(keyCalls, 1)
})

test("rejects invalid identity claims, anonymous users, signature tampering and algorithm confusion", async () => {
  for (const updates of [{ aud: "another-project" }, { iss: "https://evil.example" }, { exp: seconds - 1 }, { iat: seconds + 500 }, { auth_time: seconds + 500 }, { auth_time: 0 }, { sub: "" }, { sub: "x".repeat(129) }, { firebase: { sign_in_provider: "anonymous" } }, { firebase: {} }]) {
    await assert.rejects(() => verifyFirebaseToken(token(updates), "test-project", fetchKeys, now), { status: 401 })
  }
  await assert.rejects(() => verifyFirebaseToken(token({}, { alg: "none" }), "test-project", fetchKeys, now), { status: 401 })
  await assert.rejects(() => verifyFirebaseToken(token({}, { kid: "unknown" }), "test-project", fetchKeys, now), { status: 401 })
  const parts = token().split(".")
  parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: "attacker" })).toString("base64url")
  await assert.rejects(() => verifyFirebaseToken(parts.join("."), "test-project", fetchKeys, now), { status: 401 })
  await assert.rejects(() => verifyFirebaseToken("malformed", "test-project", fetchKeys, now), { status: 401 })
})

test("fails closed when token verification is unavailable", async () => {
  await assert.rejects(() => verifyFirebaseToken(token(), "test-project", async () => { throw new Error("network") }, now + 7200_000), { status: 401 })
  const fresh = token({ iat: seconds + 7200 - 10, exp: seconds + 10000 })
  await assert.rejects(() => verifyFirebaseToken(fresh, "test-project", async () => { throw new Error("network") }, now + 7200_000), { status: 503 })
})
