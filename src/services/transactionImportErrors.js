// Diagnostics contain only allowlisted codes/stages and fixed public messages.
// Never render or log an SDK error message, payload, account ID or token.
export const IMPORT_SAVE_STAGES = Object.freeze({
  validation: "Validating transaction", authentication: "Checking account",
  "guest-storage": "Saving on this device", "local-lookup": "Checking local records",
  "offline-queue": "Saving to offline queue", "duplicate-check": "Checking server references",
  "queue-cleanup": "Removing a synchronized record from the offline queue",
  "firestore-read": "Reading existing Firestore records", "firestore-write": "Saving to Firestore",
  synchronization: "Synchronizing queued transactions", save: "Saving transaction",
})

const MESSAGES = Object.freeze({
  "permission-denied": "Permission denied. Firestore did not authorize this operation. Verify the signed-in account and the existing transaction rules.",
  unauthenticated: "Authentication unavailable. Sign in again, then retry the selected records.",
  "auth-unavailable": "Authentication unavailable. The signed-in account is no longer available; sign in again before importing.",
  "account-changed": "The account changed. Review the statement under the current account before retrying.",
  "invalid-payload": "Invalid transaction payload. Review the amount, date, direction, payment method and references.",
  "invalid-argument": "Invalid transaction payload or request. Review the transaction fields before retrying.",
  "reference-conflict": "Duplicate/reference conflict. An existing record has different financial details for the same reference. Review it before retrying.",
  "storage-quota": "Local storage is full. Free device storage, then retry. This record was not saved locally.",
  "storage-unavailable": "Local storage is unavailable. Allow browser storage and retry; the record was not queued.",
  "local-storage-failed": "Local storage failed. The record was not saved on this device. Check browser storage, then retry.",
  "queue-cleanup-failed": "Offline queue cleanup failed after synchronization. The record may already be saved in Firestore; retry will check for duplicates.",
  "failed-precondition": "Firestore could not complete the operation because a required precondition was not met. Check the database configuration before retrying.",
  "resource-exhausted": "Firestore capacity or quota is temporarily exhausted. Retry later.",
  "not-found": "The requested Firestore resource was not found. Verify the database configuration.",
  "already-exists": "Firestore reports that a record already exists. Recheck saved records before retrying.",
  "out-of-range": "A value is outside the range accepted by Firestore. Review the transaction fields.",
  unimplemented: "This Firestore operation is not supported by the current database configuration.",
  internal: "Firestore reported an internal error. Retry; existing records will be checked for duplicates.",
  "data-loss": "Firestore reported a data integrity error. Review the database status before retrying.",
  unavailable: "Firestore is temporarily unavailable. Retry when connected; any queued records remain on this device.",
  "deadline-exceeded": "The Firestore request timed out. Retry when connected; saved records will be checked for duplicates.",
  "network-request-failed": "The network request failed. Retry when connected; queued records remain on this device.",
  aborted: "The Firestore operation was interrupted. Retry; saved records will be checked for duplicates.",
  cancelled: "The save operation was cancelled. Retry the selected records.",
  "sync-failed": "Firestore synchronization failed. Queued records remain on this device for retry.",
  unknown: "The transaction could not be saved. Retry and use the diagnostic code and stage if the failure continues.",
})

export const diagnoseImportError = (error, fallbackStage = "save") => {
  const stage = Object.hasOwn(IMPORT_SAVE_STAGES, error?.importStage) ? error.importStage : Object.hasOwn(IMPORT_SAVE_STAGES, fallbackStage) ? fallbackStage : "save"
  const suppliedCode = typeof error?.code === "string" ? error.code.replace(/^(?:firestore|auth|import)\//, "") : ""
  let code = Object.hasOwn(MESSAGES, suppliedCode) ? suppliedCode : "unknown"
  const message = typeof error?.message === "string" ? error.message : ""
  if (code === "unknown") {
    if (/conflicting financial|same reference/i.test(message)) code = "reference-conflict"
    else if (/account changed/i.test(message)) code = "account-changed"
    else if (["user-token-expired", "invalid-user-token", "user-disabled"].includes(suppliedCode)) code = "unauthenticated"
    else if (error?.name === "QuotaExceededError") code = "storage-quota"
    else if (["SecurityError", "InvalidStateError", "NotAllowedError"].includes(error?.name) || /storage is unavailable/i.test(message)) code = "storage-unavailable"
    else if (stage === "validation") code = "invalid-payload"
    else if (stage === "queue-cleanup") code = "queue-cleanup-failed"
    else if (["guest-storage", "offline-queue", "local-lookup"].includes(stage)) code = "local-storage-failed"
    else if (stage === "synchronization") code = "sync-failed"
  }
  return { code, stage, message: stage === "queue-cleanup" ? MESSAGES["queue-cleanup-failed"] : MESSAGES[code] }
}

export const importSaveError = (error, stage) => {
  const diagnostic = diagnoseImportError(typeof error === "string" ? { code: error } : error, stage)
  return Object.assign(new Error(diagnostic.message), { name: "ImportSaveError", code: diagnostic.code, importStage: diagnostic.stage })
}

export const importSaveOperation = async (stage, operation) => {
  try { return await operation() }
  catch (error) { throw importSaveError(error, stage) }
}

export const importResultTitle = ({ imported = 0, duplicates = 0, failed = 0, pending = 0, alreadyQueued = 0 }) => {
  if (failed) return imported + duplicates + pending + alreadyQueued ? "Partially imported" : "Import failed"
  if (pending || alreadyQueued) return "Saved on this device"
  return "Import complete"
}

export const groupImportFailures = (failures) => {
  const groups = new Map()
  for (const { row, ...failure } of failures) {
    const diagnostic = diagnoseImportError({ code: failure.code, importStage: failure.stage })
    const key = `${diagnostic.code}:${diagnostic.stage}`
    if (!groups.has(key)) groups.set(key, { ...diagnostic, rows: [] })
    if (Number.isSafeInteger(row) && row > 0) groups.get(key).rows.push(row)
  }
  return [...groups.values()]
}
