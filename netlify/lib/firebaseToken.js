import { verify } from "node:crypto"

let cachedKeys = { expires: 0, keys: {} }
let pendingKeys
const invalid = () => { throw Object.assign(new Error("Please sign in again to use FinSight AI."), { status: 401 }) }

export async function verifyFirebaseToken(token, projectId, fetcher = fetch, now = Date.now()) {
  if (!projectId) throw Object.assign(new Error("FinSight AI needs backend configuration."), { status: 503 })
  let header, claims, parts
  try {
    if (typeof token !== "string" || token.length > 8192) invalid()
    parts = token.split(".")
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) invalid()
    header = JSON.parse(Buffer.from(parts[0], "base64url"))
    claims = JSON.parse(Buffer.from(parts[1], "base64url"))
  } catch { invalid() }
  const seconds = now / 1000
  if (!header || !claims || typeof header !== "object" || typeof claims !== "object" ||
      header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid || header.kid.length > 200 ||
      claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 ||
      !Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds ||
      !Number.isFinite(claims.auth_time) || claims.auth_time > seconds || claims.auth_time <= 0 ||
      !claims.firebase?.sign_in_provider || claims.firebase.sign_in_provider === "anonymous") invalid()
  if (cachedKeys.expires <= now) {
    pendingKeys ||= (async () => {
      const response = await fetcher("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com", { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error("Key lookup failed")
      const keys = await response.json()
      const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] || 300)
      cachedKeys = { keys, expires: now + Math.min(maxAge, 86400) * 1000 }
    })().finally(() => { pendingKeys = undefined })
    try { await pendingKeys } catch { throw Object.assign(new Error("Sign-in verification is temporarily unavailable. Please retry."), { status: 503 }) }
  }
  if (!Object.hasOwn(cachedKeys.keys, header.kid)) invalid()
  try {
    if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), cachedKeys.keys[header.kid], Buffer.from(parts[2], "base64url"))) invalid()
  } catch { invalid() }
  return claims.sub
}
