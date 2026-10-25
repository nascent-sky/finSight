import test from "node:test"
import assert from "node:assert/strict"
import { diagnoseImportError, importSaveError, importSaveOperation, importResultTitle, groupImportFailures } from "./transactionImportErrors.js"

test("diagnostics expose only public codes/stages and fixed messages, never raw SDK errors or payloads", () => {
  const privateText = "private account, transaction, bearer token and API key"
  for (const error of [
    Object.assign(new Error(privateText), { code: "firestore/permission-denied", credential: privateText }),
    { code: privateText, message: privateText, importStage: privateText },
    Object.assign(new Error(privateText), { name: "QuotaExceededError" }),
    { code: "auth/user-token-expired", message: privateText },
    null,
  ]) {
    const diagnostic = diagnoseImportError(error)
    assert.deepEqual(Object.keys(diagnostic), ["code", "stage", "message"])
    assert.doesNotMatch(JSON.stringify(diagnostic), /private account|bearer token|API key/)
    const wrapped = importSaveError(error, "save")
    assert.doesNotMatch(wrapped.message, /private account|bearer token|API key/)
    assert.equal(wrapped.cause, undefined)
  }
})

test("stage wrappers preserve the original failure stage through outer save/sync handlers", async () => {
  await assert.rejects(() => importSaveOperation("firestore-write", () => importSaveOperation("firestore-read", () => { throw { code: "permission-denied", message: "private" } })), { code: "permission-denied", importStage: "firestore-read" })
  assert.equal(diagnoseImportError(new Error("unexposed validation details"), "validation").code, "invalid-payload")
  assert.equal(diagnoseImportError(new Error("unexposed storage details"), "offline-queue").code, "local-storage-failed")
  assert.equal(diagnoseImportError(new Error("unexposed sync details"), "synchronization").code, "sync-failed")
  for (const code of ["not-found", "already-exists", "out-of-range", "unimplemented", "internal", "data-loss"]) assert.equal(diagnoseImportError({ code: `firestore/${code}`, message: "private response" }, "firestore-write").code, code)
})

test("batch titles distinguish complete failures, partial success, queued saves and duplicates", () => {
  assert.equal(importResultTitle({ failed: 3 }), "Import failed")
  assert.equal(importResultTitle({ imported: 2, failed: 1 }), "Partially imported")
  assert.equal(importResultTitle({ pending: 2, failed: 1 }), "Partially imported")
  assert.equal(importResultTitle({ pending: 3 }), "Saved on this device")
  assert.equal(importResultTitle({ alreadyQueued: 3 }), "Saved on this device")
  assert.equal(importResultTitle({ imported: 3 }), "Import complete")
  assert.equal(importResultTitle({ duplicates: 3 }), "Import complete")
})

test("equal codes and stages are grouped by preview row number, without transaction identity", () => {
  const groups = groupImportFailures([1, 2, 3].map((row) => ({ row, code: "permission-denied", stage: "firestore-write", message: "must not render", transactionId: "must not render" })))
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].rows, [1, 2, 3])
  assert.doesNotMatch(JSON.stringify(groups), /must not render/)
})
