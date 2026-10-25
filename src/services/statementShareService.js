import { STATEMENT_LIMITS } from "./statementImportModel.js"

// Retain the original GPay cache name for installed service-worker upgrades.
const CACHE = "finsight-shared-pdf-v1"
const PATH = "/__finsight_shared_pdf__"
export const receiveSharedStatement = async (token) => {
  if (token === "missing") throw new Error("The browser did not deliver the statement. Use a supported, up-to-date Android browser and share the file again.")
  if (token !== "1" && !/^[a-f0-9-]{36}$/.test(token)) throw new Error("Share one non-empty PDF, CSV or XLSX statement up to 10 MB.")
  const path = token === "1" ? PATH : `${PATH}/${token}`
  let response
  try {
    const cache = await caches.open(CACHE)
    response = await cache.match(path)
    // One-use local handoff, including invalid/expired files.
    await cache.delete(path)
  } catch { throw new Error("The shared statement could not be received from local storage. Allow browser storage and share it again.") }
  if (!response) throw new Error("The shared statement is no longer available. Please share it again.")
  const storedAt = Number(response.headers.get("X-FinSight-Shared-At"))
  if (!storedAt || Date.now() - storedAt > 5 * 60000) throw new Error("The shared statement has expired. Please share it again.")
  const blob = await response.blob()
  if (!blob.size || blob.size > STATEMENT_LIMITS.bytes) throw new Error("Share one non-empty PDF, CSV or XLSX statement up to 10 MB.")
  let name
  try { name = decodeURIComponent(response.headers.get("X-FinSight-Filename") || "shared-statement.pdf") }
  catch { throw new Error("The shared statement has an invalid filename. Please share it again.") }
  return new File([blob], name.split(/[\\/]/).at(-1).slice(0, 255), { type: blob.type })
}
