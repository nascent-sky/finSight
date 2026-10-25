import test, { beforeEach, after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { loadStatementModule } from "../../tests/helpers/statementHarness.mjs"
import { parsePhonePeCsv } from "./phonePeStatementParser.js"
import { parsePhonePePdfLines } from "./phonePeStatementParser.js"
import { getImportDocumentId } from "./statementImportModel.js"

// Run the actual transaction service with explicit Firestore/queue transport
// seams. No Firebase connection, application, browser or emulator is started.
const firestoreExports = ["addDoc", "collection", "deleteDoc", "doc", "getDoc", "getDocsFromServer", "getDocsFromCache", "onSnapshot", "orderBy", "query", "runTransaction", "setDoc", "where"]
const pendingExports = ["addPendingTransaction", "deletePendingTransaction", "getPendingTransaction", "getPendingTransactions", "subscribeToPendingTransactions", "updatePendingTransaction"]
const service = await loadStatementModule("src/services/transactionService.js", [{ name: "persistence-transport-seams", setup(builder) {
  builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore", namespace: "transport" }))
  builder.onResolve({ filter: /(?:^|\/)firebase$/ }, () => ({ path: "firebase", namespace: "transport" }))
  builder.onResolve({ filter: /pendingTransactionService$/ }, () => ({ path: "pending", namespace: "transport" }))
  builder.onLoad({ filter: /.*/, namespace: "transport" }, ({ path }) => ({ contents: path === "firebase"
    ? "export const db = {}; export const auth = { get currentUser() { return globalThis.__statementStore.user } }"
    : (path === "firestore" ? firestoreExports : pendingExports).map((name) => `export const ${name} = (...args) => globalThis.__statementStore.${name}(...args)`).join(";\n") }))
} }])
const rows = parsePhonePeCsv(await readFile(new URL("../../tests/fixtures/phonepe/statement.csv", import.meta.url), "utf8")).transactions
const pdfRows = parsePhonePePdfLines(JSON.parse(await readFile(new URL("../../tests/fixtures/phonepe/statement.pdf-lines.json", import.meta.url), "utf8"))).transactions
const descriptors = new Map(["localStorage", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const snapshot = (path, value) => ({ id: path.split("/").at(-1), exists: () => Boolean(value), data: () => value })
let state
beforeEach(() => {
  const local = new Map(), server = new Map(), pending = new Map(), cached = new Map()
  state = {
    user: null, online: false, server, pending, cached, remoteCalls: 0, serverQueryCalls: 0, fail: null, queryFailure: null, readFailure: null, commitFailure: null, afterCommitFailure: null, writes: 0,
    collection: (db, ...parts) => parts.join("/"), doc: (db, ...parts) => parts.join("/"),
    query: (path, ...filters) => ({ path, filters }), where: (...values) => values,
    getDocsFromCache: async (path) => ({ docs: [...cached].filter(([key]) => key.startsWith(path)).map(([key, value]) => snapshot(key, value)) }),
    getDocsFromServer: async ({ path, filters }) => {
      state.serverQueryCalls++
      state.remoteCalls++
      if (state.queryFailure || state.fail) throw state.queryFailure || state.fail
      return { docs: [...server].filter(([key, value]) => key.startsWith(path) && filters.every(([field, , keys]) => value[field]?.some((key) => keys.includes(key)))).map(([key, value]) => snapshot(key, value)) }
    },
    runTransaction: async (db, callback) => {
      state.remoteCalls++
      if (state.fail) throw state.fail
      const writes = []
      const result = await callback({ get: async (path) => { if (state.readFailure) throw state.readFailure; return snapshot(path, server.get(path)) }, set: (path, value) => { writes.push([path, value]) } })
      const rejected = typeof state.commitFailure === "function" ? state.commitFailure(writes) : state.commitFailure
      if (rejected) throw rejected
      writes.forEach(([path, value]) => { state.writes++; server.set(path, value) })
      if (state.afterCommitFailure) throw state.afterCommitFailure
      return result
    },
    getPendingTransactions: async (uid) => [...pending.values()].filter((record) => record.uid === uid),
    addPendingTransaction: async (uid, id, transaction) => { const key = `${uid}:${id}`; const created = !pending.has(key); if (created) pending.set(key, { uid, id, transaction }); return { created } },
    deletePendingTransaction: async (uid, id) => pending.delete(`${uid}:${id}`),
  }
  globalThis.__statementStore = state
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key) => local.get(key), setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) } })
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return state.online } } })
})
after(() => { delete globalThis.__statementStore; for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
const save = (transaction) => service.saveImportedTransactionWithId(getImportDocumentId(transaction), transaction)

test("guest imports remain local, preserve identity, detect cross-format duplicates and retain distinct UTRs", async () => {
  for (const row of rows) assert.equal((await save(row)).created, true)
  for (const row of rows) assert.equal((await save({ ...row, source: { provider: "phonepe", format: "pdf" } })).created, false)
  const stored = service.getGuestTransactions()
  assert.equal(stored.length, 3)
  assert.equal(state.remoteCalls, 0)
  assert.equal(stored[0].source.provider, "phonepe")
  assert.equal(stored[0].amountPaise, 100)
  assert.ok(stored.every((row) => row.utr && row.transactionId && row.paymentInstrument && row.importIdentityKeys.length === 2))
})

test("legacy GPay document IDs prevent duplicate imports without changing existing records", async () => {
  const { source, amountPaise, transactionId, upiTransactionId, utr, paymentInstrument, ...legacy } = rows[0]
  await service.addGuestTransactionWithId(`gpay_${utr}`, legacy)
  assert.equal((await save(rows[0])).created, false)
  assert.equal(service.getGuestTransactions()[0].id, `gpay_${utr}`)
  assert.equal(service.getGuestTransactions()[0].source, undefined)
})

test("account offline import queues normalized records, deduplicates, then syncs exactly once", async () => {
  state.user = { uid: "synthetic-user" }
  for (const row of rows) { const saved = await save(row); assert.equal(saved.pending, true); assert.equal(saved.created, true) }
  assert.equal((await save({ ...rows[0], source: { provider: "phonepe", format: "pdf" } })).created, false)
  assert.equal(state.remoteCalls, 0)
  assert.equal(state.pending.size, 3)
  assert.deepEqual(await service.syncPendingTransactions(), { synced: 0, duplicates: 0, failed: 0 })
  state.online = true
  assert.deepEqual(await service.syncPendingTransactions(), { synced: 3, duplicates: 0, failed: 0 })
  assert.equal(state.pending.size, 0)
  assert.equal(state.server.size, 3)
  assert.equal((await save(rows[0])).created, false)
  assert.equal(state.server.size, 3)
})

test("sync rechecks remote legacy GPay duplicates not known at offline import time", async () => {
  state.user = { uid: "synthetic-user" }
  await save(rows[0])
  const old = { amount: 1, type: "expense", datetime: rows[0].datetime, person: "Existing", category: "Other", paymentMethod: "upi", note: "" }
  const path = `users/synthetic-user/transactions/gpay_${rows[0].utr}`
  state.server.set(path, old)
  state.online = true
  assert.deepEqual(await service.syncPendingTransactions(), { synced: 0, duplicates: 1, failed: 0 })
  assert.equal(state.pending.size, 0)
  assert.deepEqual(state.server.get(path), old)
  assert.equal(state.writes, 0)
})

test("cached references and pending references protect offline imports across providers", async () => {
  state.user = { uid: "synthetic-user" }
  state.cached.set(`users/synthetic-user/transactions/gpay_${rows[0].utr}`, { ...rows[0] })
  assert.equal((await save(rows[0])).created, false)
  await save(rows[1])
  const gpay = { ...rows[1], utr: undefined, transactionId: undefined, source: { provider: "gpay", format: "pdf" } }
  assert.equal((await save(gpay)).created, false)
  assert.equal(state.pending.size, 1)
  assert.equal(state.remoteCalls, 0)
})

test("transient online failures queue safely; permission failures do not become success", async () => {
  state.user = { uid: "synthetic-user" }
  state.online = true
  state.fail = { code: "unavailable" }
  assert.equal((await save(rows[0])).pending, true)
  state.fail = { code: "permission-denied" }
  await assert.rejects(() => save(rows[1]))
  assert.equal(state.pending.size, 1)
  assert.equal(state.server.size, 0)
})

test("same reference with a different amount/direction is an explicit conflict and never overwrites", async () => {
  await save(rows[0])
  await assert.rejects(() => save({ ...rows[0], amount: 2 }), /conflict/i)
  await assert.rejects(() => save({ ...rows[0], type: "income" }), /conflict/i)
  assert.equal(service.getGuestTransactions()[0].amount, 1)
  assert.equal(service.getGuestTransactions().length, 1)
})

test("a previously missing UTR still matches the provider transaction ID across formats on sync", async () => {
  state.user = { uid: "synthetic-user" }
  const partial = { ...rows[0], utr: "", upiTransactionId: "" }
  const first = await save(partial)
  assert.match(first.id, /^phonepe_/)
  state.online = true
  await service.syncPendingTransactions()
  const full = await save({ ...rows[0], source: { provider: "phonepe", format: "pdf" } })
  assert.equal(full.created, false)
  assert.equal(state.server.size, 1)
})

test("metadata remains local through corrections while guest account merge writes seven cloud fields", async () => {
  const result = await save({ ...rows[0], rawDocument: "must not persist", source: { ...rows[0].source, originalFile: "must not persist" } })
  const edited = await service.updateTransaction(result.id, { amount: 1.23, category: "Food & Dining" })
  assert.equal(edited.amountPaise, 123)
  assert.equal(edited.utr, rows[0].utr)
  assert.equal(edited.rawDocument, undefined)
  assert.deepEqual(edited.source, { provider: "phonepe", format: "csv" })
  state.user = { uid: "synthetic-user" }; state.online = true
  assert.equal((await service.mergeGuestTransactionsIntoAccount()).merged, 1)
  assert.equal(state.server.size, 1)
  assert.equal(service.getGuestTransactions().length, 0)
  assert.equal([...state.server.values()][0].amount, 1.23)
  assert.equal([...state.server.values()][0].amountPaise, undefined)
  assert.deepEqual(Object.keys([...state.server.values()][0]).sort(), ["amount", "category", "datetime", "note", "paymentMethod", "person", "type"])
})

test("missing identity/invalid money never saves; account changes during lookup abort", async () => {
  for (const changed of [{ amount: 0 }, { amount: "1.001" }, { datetime: "invalid" }, { person: "" }, { utr: "", upiTransactionId: "", transactionId: "" }]) await assert.rejects(() => service.saveImportedTransactionWithId("candidate", { ...rows[0], ...changed }))
  assert.equal(service.getGuestTransactions().length, 0)
  state.user = { uid: "synthetic-user" }
  state.getDocsFromCache = async () => { state.user = { uid: "another-user" }; return { docs: [] } }
  await assert.rejects(() => save(rows[0]), /account changed/i)
  assert.equal(state.pending.size, 0)
  assert.equal(state.server.size, 0)
})

test("three valid PhonePe debits save online to the existing owner transaction path with canonical fields", async () => {
  state.user = { uid: "synthetic-user" }; state.online = true
  for (const row of rows) assert.equal((await service.saveImportedTransactionWithId(getImportDocumentId(row), row, { expectedUid: "synthetic-user" })).created, true)
  assert.equal(state.server.size, 3)
  assert.equal(state.pending.size, 0)
  for (const row of rows) {
    const stored = state.server.get(`users/synthetic-user/transactions/${getImportDocumentId(row)}`)
    assert.deepEqual(stored, service.normalizeTransaction(row))
    assert.deepEqual(Object.keys(stored).sort(), ["amount", "category", "datetime", "note", "paymentMethod", "person", "type"])
    assert.equal(stored.amount, 1)
    assert.equal(stored.category, "Other")
    assert.equal(stored.type, "expense")
    assert.ok(Number.isFinite(Date.parse(stored.datetime)))
    assert.equal(stored.paymentMethod, "upi")
    assert.doesNotThrow(() => JSON.stringify(stored))
    assert.ok(Object.values(stored).every((value) => value !== undefined))
  }
})

for (const [name, first, second] of [["CSV then PDF", rows, pdfRows], ["PDF then CSV", pdfRows, rows]]) {
  test(`${name}: three saved records, zero new records and three duplicates on reimport`, async () => {
    state.user = { uid: "synthetic-user" }; state.online = true
    for (const row of first) assert.equal((await save(row)).created, true)
    const repeated = await Promise.all(second.map(save))
    assert.equal(repeated.filter((record) => record.created).length, 0)
    assert.equal(repeated.filter((record) => !record.created).length, 3)
    assert.equal(state.server.size, 3)
    assert.equal(state.writes, 3)
  })
}

test("signed-in imports do not depend on removed server metadata queries", async () => {
  state.user = { uid: "synthetic-user" }; state.online = true
  state.queryFailure = { code: "permission-denied" }
  for (const row of rows) assert.equal((await save(row)).created, true)
  assert.equal(state.serverQueryCalls, 0)
  assert.equal(state.server.size, 3)
})

for (const [property, stage] of [["readFailure", "firestore-read"], ["commitFailure", "firestore-write"]]) {
  test(`permission rejection during ${stage} identifies the same sanitized failure for all three records`, async () => {
    state.user = { uid: "synthetic-user" }; state.online = true
    state[property] = Object.assign(new Error("private server response with account and record identifiers"), { code: "firestore/permission-denied" })
    const failures = []
    for (const row of rows) {
      await assert.rejects(() => save(row), (error) => {
        failures.push({ code: error.code, stage: error.importStage })
        assert.doesNotMatch(error.message, /private server response|synthetic-user|900000/)
        return error.code === "permission-denied" && error.importStage === stage
      })
    }
    assert.deepEqual(failures, rows.map(() => ({ code: "permission-denied", stage })))
    assert.equal(state.server.size, 0)
    assert.equal(state.pending.size, 0)
    assert.equal(state.writes, 0)
  })
}

test("partial Firestore commit failures retain successful documents and retry creates only the missing record", async () => {
  state.user = { uid: "synthetic-user" }; state.online = true
  state.commitFailure = (writes) => writes.some(([path]) => path.endsWith(getImportDocumentId(rows[1]))) ? { code: "permission-denied" } : null
  const first = []
  for (const row of rows) { try { first.push(await save(row)) } catch (error) { first.push(error) } }
  assert.equal(first.filter((value) => value.created).length, 2)
  assert.equal(first.filter((value) => value.code === "permission-denied").length, 1)
  assert.equal(state.server.size, 2)
  state.commitFailure = null
  const retry = await Promise.all(pdfRows.map(save))
  assert.equal(retry.filter((value) => value.created).length, 1)
  assert.equal(retry.filter((value) => !value.created).length, 2)
  assert.equal(state.server.size, 3)
  assert.equal(state.writes, 3)
})

test("failed synchronization keeps queued records and sanitized reasons for a later retry", async () => {
  state.user = { uid: "synthetic-user" }
  for (const row of rows) await save(row)
  state.online = true; state.commitFailure = { code: "permission-denied", message: "private server response" }
  const failed = await service.syncPendingTransactions()
  assert.equal(failed.failed, 3)
  assert.equal(failed.synced, 0)
  assert.equal(failed.failures.length, 3)
  assert.ok(failed.failures.every((failure) => failure.code === "permission-denied" && failure.stage === "firestore-write"))
  assert.doesNotMatch(JSON.stringify(failed), /private server response|synthetic-user|900000/)
  assert.equal(state.pending.size, 3)
  assert.equal(state.server.size, 0)
  state.commitFailure = null
  assert.deepEqual(await service.syncPendingTransactions(), { synced: 3, duplicates: 0, failed: 0 })
  assert.equal(state.pending.size, 0)
  for (const row of pdfRows) assert.equal((await save(row)).created, false)
  assert.equal(state.server.size, 3)
})

test("a lost Firestore acknowledgement queues safely and sync does not duplicate an already committed record", async () => {
  state.user = { uid: "synthetic-user" }; state.online = true
  state.afterCommitFailure = { code: "unavailable" }
  assert.equal((await save(rows[0])).pending, true)
  assert.equal(state.server.size, 1)
  assert.equal(state.pending.size, 1)
  state.afterCommitFailure = null
  assert.deepEqual(await service.syncPendingTransactions(), { synced: 0, duplicates: 1, failed: 0 })
  assert.equal(state.server.size, 1)
  assert.equal(state.writes, 1)
  assert.equal(state.pending.size, 0)
})

test("local queue failures and lost authentication never masquerade as saved imports", async () => {
  await assert.rejects(() => service.saveImportedTransactionWithId(getImportDocumentId(rows[0]), rows[0], { expectedUid: "synthetic-user" }), { code: "auth-unavailable", importStage: "authentication" })
  assert.equal(service.getGuestTransactions().length, 0)
  state.user = { uid: "synthetic-user" }
  state.addPendingTransaction = async () => { throw Object.assign(new Error("private payload"), { name: "QuotaExceededError" }) }
  await assert.rejects(() => save(rows[0]), { code: "storage-quota", importStage: "offline-queue" })
  assert.equal(state.pending.size, 0)
  assert.equal(state.server.size, 0)
})

test("queue cleanup failure is distinct from a failed Firestore write and retry is duplicate-safe", async () => {
  state.user = { uid: "synthetic-user" }
  await save(rows[0]); state.online = true
  const remove = state.deletePendingTransaction
  state.deletePendingTransaction = async () => { throw new Error("private local queue failure") }
  const result = await service.syncPendingTransactions()
  assert.equal(result.failed, 1)
  assert.equal(result.failures[0].stage, "queue-cleanup")
  assert.equal(result.failures[0].code, "queue-cleanup-failed")
  assert.equal(state.server.size, 1)
  assert.equal(state.pending.size, 1)
  state.deletePendingTransaction = remove
  assert.deepEqual(await service.syncPendingTransactions(), { synced: 0, duplicates: 1, failed: 0 })
  assert.equal(state.writes, 1)
})

test("GPay and PhonePe continue to share the same save path and global UPI identity", async () => {
  state.user = { uid: "synthetic-user" }; state.online = true
  const gpay = { amount: 1, datetime: rows[0].datetime, type: "expense", person: "Synthetic GPay Merchant", paymentMethod: "upi", category: "Other", note: "", upiTransactionId: rows[0].utr, source: { provider: "gpay", format: "pdf" } }
  assert.equal((await service.saveImportedTransactionWithId(`gpay_${gpay.upiTransactionId}`, gpay)).created, true)
  assert.equal((await save(rows[0])).created, false)
  assert.equal(state.server.size, 1)
  assert.ok(state.server.has(`users/synthetic-user/transactions/${getImportDocumentId(gpay)}`))
})
