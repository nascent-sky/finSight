import test, { beforeEach, afterEach, after } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { initializeApp, deleteApp } from "firebase/app"
import { initializeFirestore, connectFirestoreEmulator, terminate, collection, collectionGroup, doc, getDoc, getDocs, query, where, setDoc, runTransaction, setLogLevel } from "firebase/firestore"
import { parsePhonePeCsv, parsePhonePePdfLines } from "../../src/services/phonePeStatementParser.js"
import { getImportDocumentId, annotateImportDuplicates } from "../../src/services/statementImportModel.js"
import { loadStatementModule } from "../helpers/statementHarness.mjs"
import { paytmExcelRows, paytmPdfRows } from "../helpers/paytmFixtures.mjs"

const address = process.env.FIRESTORE_EMULATOR_HOST || ""
const project = process.env.FINSIGHT_RULES_TEST_PROJECT || ""
if (!/^127\.0\.0\.1:\d+$/.test(address) || project !== "demo-finsight-rules") throw new Error("Run with npm run test:firestore. Only the localhost demo project is allowed.")
const [host, port] = address.split(":")
setLogLevel("silent")
const fields = ["amount", "category", "datetime", "note", "paymentMethod", "person", "type"]
const csvRows = parsePhonePeCsv(await readFile(new URL("../fixtures/phonepe/statement.csv", import.meta.url), "utf8")).transactions
const pdfRows = parsePhonePePdfLines(JSON.parse(await readFile(new URL("../fixtures/phonepe/statement.pdf-lines.json", import.meta.url), "utf8"))).transactions
const baselineSource = execFileSync("git", ["show", "v3.2.0:src/services/transactionService.js"], { encoding: "utf8" })
const descriptors = new Map(["navigator", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const pendingNames = ["addPendingTransaction", "deletePendingTransaction", "getPendingTransaction", "getPendingTransactions", "subscribeToPendingTransactions", "updatePendingTransaction"]
let context, current, count = 0

const seams = (baseline = false) => [{ name: "real-sdk-synthetic-account", setup(builder) {
  builder.onResolve({ filter: /(?:^|\/)firebase$/ }, () => ({ path: "demo-account", namespace: "rules-context" }))
  builder.onResolve({ filter: /pendingTransactionService$/ }, () => ({ path: "pending", namespace: "rules-context" }))
  builder.onLoad({ filter: /.*/, namespace: "rules-context" }, ({ path }) => ({ contents: path === "demo-account"
    ? "export const db = globalThis.__finsightRules.db; export const auth = { get currentUser() { return globalThis.__finsightRules.user } }"
    : pendingNames.map((name) => `export const ${name} = (...args) => globalThis.__finsightRules.${name}(...args)`).join(";\n") }))
  if (baseline) builder.onLoad({ filter: /[\\/]transactionService\.js$/ }, () => ({ contents: baselineSource, loader: "js" }))
} }]

beforeEach(async () => {
  const uid = `fixture-owner-${++count}`
  const app = initializeApp({ projectId: project }, `rules-${count}`)
  const db = initializeFirestore(app, { experimentalForceLongPolling: true })
  connectFirestoreEmulator(db, host, Number(port), { mockUserToken: { sub: uid } })
  const local = new Map(), pending = new Map()
  context = {
    app, db, uid, user: { uid }, online: true, pending,
    getPendingTransactions: async (owner) => [...pending.values()].filter((record) => record.uid === owner),
    getPendingTransaction: async (owner, id) => pending.get(`${owner}:${id}`),
    addPendingTransaction: async (owner, id, transaction) => { const key = `${owner}:${id}`; const created = !pending.has(key); if (created) pending.set(key, { uid: owner, id, transaction }); return { created } },
    deletePendingTransaction: async (owner, id) => pending.delete(`${owner}:${id}`),
    updatePendingTransaction: async (owner, id, transaction) => pending.set(`${owner}:${id}`, { uid: owner, id, transaction }),
    subscribeToPendingTransactions: () => () => {},
  }
  globalThis.__finsightRules = context
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key) => local.get(key), setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key) } })
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get onLine() { return context.online } } })
  current = await loadStatementModule("src/services/transactionService.js", seams())
})
afterEach(async () => { await terminate(context.db); await deleteApp(context.app); delete globalThis.__finsightRules })
after(() => { for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] } })
const ownerCollection = () => collection(context.db, "users", context.uid, "transactions")
const ownerDoc = (id) => doc(ownerCollection(), id)
const save = (row) => current.saveImportedTransactionWithId(getImportDocumentId(row), row, { expectedUid: context.uid })
const denied = (error) => error?.code === "permission-denied"
const assertSeven = (snapshot) => assert.deepEqual(Object.keys(snapshot.data()).sort(), fields)
const gpay = (row = csvRows[0]) => ({ amount: row.amount, datetime: row.datetime, type: row.type, person: row.person, paymentMethod: "upi", category: "Other", note: "", upiTransactionId: row.utr })

for (const [first, second] of [[paytmPdfRows(), paytmExcelRows()], [paytmExcelRows(), paytmPdfRows()]]) {
  test(`Paytm ${first[0].source.format} then ${second[0].source.format} saves exactly three seven-field documents under unchanged rules`, async () => {
    for (const row of first) assert.equal((await save(row)).created, true)
    for (const row of second) assert.equal((await save(row)).created, false)
    const stored = await getDocs(ownerCollection())
    assert.equal(stored.size, 3)
    assert.equal(stored.docs.reduce((sum, snapshot) => sum + Math.round(snapshot.data().amount * 100), 0), 293000)
    stored.docs.forEach(assertSeven)
    assert.deepEqual(stored.docs.map((snapshot) => snapshot.data().datetime).sort(), first.map((row) => row.datetime).sort())
  })
}
test("Paytm guest merge and reimport use the canonical seven-field account collection", async () => {
  context.user = null
  for (const row of paytmPdfRows()) await current.saveImportedTransactionWithId(getImportDocumentId(row), row, { expectedUid: null })
  context.user = { uid: context.uid }
  assert.equal((await current.mergeGuestTransactionsIntoAccount()).merged, 3)
  for (const row of paytmExcelRows()) assert.equal((await save(row)).created, false)
  assert.equal(current.getGuestTransactions().length, 0)
  const stored = await getDocs(ownerCollection()); assert.equal(stored.size, 3); stored.docs.forEach(assertSeven)
})
test("Paytm offline queue synchronizes once without changing timestamps on duplicates", async () => {
  context.online = false
  const pdf = paytmPdfRows()[0], id = getImportDocumentId(pdf)
  for (const row of paytmPdfRows()) assert.equal((await save(row)).pending, true)
  for (const row of paytmExcelRows()) assert.equal((await save(row)).created, false)
  assert.equal(context.pending.size, 3)
  context.online = true
  assert.deepEqual(await current.syncPendingTransactions(), { synced: 3, duplicates: 0, failed: 0 })
  assert.deepEqual(await current.syncPendingTransactions(), { synced: 0, duplicates: 0, failed: 0 })
  const stored = await getDocs(ownerCollection()); assert.equal(stored.size, 3); stored.docs.forEach(assertSeven)
  assert.equal((await getDoc(ownerDoc(id))).data().datetime, pdf.datetime)
})
test("Paytm cross-provider legacy UPI IDs match while significant same-reference conflicts are refused", async () => {
  const row = paytmExcelRows()[0], oldId = `gpay_${row.utr}`
  await setDoc(ownerDoc(oldId), current.normalizeTransaction(row))
  assert.equal((await save(row)).created, false)
  for (const updates of [{ amount: 61 }, { type: "expense" }, { person: "Different Person" }, { datetime: "2024-08-09T14:39:52.000Z" }]) await assert.rejects(() => save({ ...row, ...updates }), (error) => error.code === "reference-conflict")
  const distinct = { ...row, utr: "000000009999", upiTransactionId: "000000009999" }
  assert.equal((await save(distinct)).created, true)
  const stored = await getDocs(ownerCollection()); assert.equal(stored.size, 2); stored.docs.forEach(assertSeven)
})

test("v3.2.0 GPay saves with its original document read and seven-field payload under unchanged rules", async () => {
  const baseline = await loadStatementModule("src/services/transactionService.js", seams(true))
  const row = gpay()
  assert.deepEqual(current.normalizeTransaction(csvRows[0]), baseline.normalizeTransaction(csvRows[0]))
  assert.equal((await baseline.saveImportedTransactionWithId(`gpay_${row.upiTransactionId}`, row)).created, true)
  assertSeven(await getDoc(ownerDoc(`gpay_${row.upiTransactionId}`)))
  // The current shared adapter recognizes this old ID without changing its data.
  assert.equal((await save(csvRows[0])).created, false)
  assert.equal((await getDocs(ownerCollection())).size, 1)
})

test("pre-fix metadata payload is rejected at transaction commit; its owner reads and queries are allowed", async () => {
  for (const id of [getImportDocumentId(csvRows[0]), `gpay_${csvRows[0].utr}`, `phonepe_${csvRows[0].transactionId}`]) assert.equal((await getDoc(ownerDoc(id))).exists(), false)
  const matches = await getDocs(query(ownerCollection(), where("importIdentityKeys", "array-contains-any", [`upi:${csvRows[0].utr}`])))
  assert.equal(matches.empty, true)
  const expanded = { ...csvRows[0], importIdentityKeys: [`upi:${csvRows[0].utr}`, `phonepe:${csvRows[0].transactionId}`] }
  await assert.rejects(() => runTransaction(context.db, async (transaction) => {
    await transaction.get(ownerDoc(getImportDocumentId(csvRows[0])))
    transaction.set(ownerDoc(getImportDocumentId(csvRows[0])), expanded)
  }), denied)
  assert.equal((await getDocs(ownerCollection())).size, 0)
})

for (const extra of ["amountPaise", "source", "transactionId", "utr", "upiTransactionId", "paymentInstrument", "importIdentityKeys"]) {
  test(`unchanged hasOnly rule rejects the extra ${extra} field`, async () => {
    const extraValue = extra === "importIdentityKeys" ? [`upi:${csvRows[0].utr}`] : csvRows[0][extra]
    await assert.rejects(() => setDoc(ownerDoc(`invalid-${extra}`), { ...current.normalizeTransaction(csvRows[0]), [extra]: extraValue }), denied)
  })
}

test("current manual CRUD and GPay creation retain the original seven-field schema", async () => {
  const manual = await current.addTransaction(current.normalizeTransaction(csvRows[0]))
  assertSeven(await getDoc(ownerDoc(manual.id)))
  await current.updateTransaction(manual.id, { amount: 2.5, category: "Food & Dining", note: "Synthetic edit" })
  const edited = await getDoc(ownerDoc(manual.id))
  assertSeven(edited)
  assert.equal(edited.data().amount, 2.5)
  assert.equal(edited.data().note, "Synthetic edit")
  await current.deleteTransaction(manual.id)
  assert.equal((await getDoc(ownerDoc(manual.id))).exists(), false)
  const row = { ...gpay(csvRows[1]), source: { provider: "gpay", format: "pdf" } }
  assert.equal((await current.saveImportedTransactionWithId(`gpay_${row.upiTransactionId}`, row)).created, true)
  assertSeven(await getDoc(ownerDoc(getImportDocumentId(row))))
})

for (const [name, first, second] of [["CSV then PDF", csvRows, pdfRows], ["PDF then CSV", pdfRows, csvRows]]) {
  test(`PhonePe ${name}: three valid saves, then zero new and three duplicates on the server`, async () => {
    for (const row of first) assert.equal((await save(row)).created, true)
    const stored = await getDocs(ownerCollection())
    assert.equal(stored.size, 3)
    stored.docs.forEach(assertSeven)
    // Cloud records have no metadata. A new preview still identifies references
    // from their document IDs, including on another device with no local metadata.
    assert.ok(annotateImportDuplicates(second, stored.docs.map((item) => ({ id: item.id, ...item.data() }))).every((row) => row.duplicate))
    const repeated = await Promise.all(second.map(save))
    assert.equal(repeated.filter((row) => row.created).length, 0)
    assert.equal(repeated.filter((row) => !row.created).length, 3)
    assert.equal((await getDocs(ownerCollection())).size, 3)
  })
}

test("PhonePe and GPay share the same UPI identity in either import order", async () => {
  const gpayFirst = { ...gpay(csvRows[0]), source: { provider: "gpay", format: "pdf" } }
  await current.saveImportedTransactionWithId(`gpay_${gpayFirst.upiTransactionId}`, gpayFirst)
  assert.equal((await save(csvRows[0])).created, false)
  await save(csvRows[1])
  const phonepeFirst = gpay(csvRows[1])
  assert.equal((await current.saveImportedTransactionWithId(`gpay_${phonepeFirst.upiTransactionId}`, phonepeFirst)).created, false)
  assert.equal((await getDocs(ownerCollection())).size, 2)
})

test("guest imports and a manual guest transaction merge into seven-field cloud records", async () => {
  context.user = null
  for (const row of csvRows) await current.saveImportedTransactionWithId(getImportDocumentId(row), row)
  await current.addTransaction({ ...current.normalizeTransaction(csvRows[0]), note: "Synthetic manual guest" })
  assert.equal(current.getGuestTransactions().length, 4)
  assert.ok(current.getGuestTransactions().find((row) => row.utr)?.source)
  context.user = { uid: context.uid }
  assert.equal((await current.mergeGuestTransactionsIntoAccount()).merged, 4)
  assert.equal(current.getGuestTransactions().length, 0)
  const stored = await getDocs(ownerCollection())
  assert.equal(stored.size, 4)
  stored.docs.forEach(assertSeven)
  for (const row of pdfRows) assert.equal((await save(row)).created, false)
})

test("v3.2.0 guest GPay records with ID-only identity do not duplicate a newer PhonePe cloud record on merge", async () => {
  const baseline = await loadStatementModule("src/services/transactionService.js", seams(true))
  context.user = null
  await baseline.saveImportedTransactionWithId(`gpay_${csvRows[0].utr}`, gpay())
  assert.equal(current.getGuestTransactions()[0].upiTransactionId, undefined)
  context.user = { uid: context.uid }
  await save(csvRows[0])
  assert.equal((await current.mergeGuestTransactionsIntoAccount()).merged, 1)
  assert.equal(current.getGuestTransactions().length, 0)
  assert.equal((await getDocs(ownerCollection())).size, 1)
})

test("legacy queued ID-only GPay records sync without duplicating an existing cross-provider record", async () => {
  await save(csvRows[0])
  const id = `gpay_${csvRows[0].utr}`
  await context.addPendingTransaction(context.uid, id, current.normalizeTransaction(csvRows[0]))
  assert.deepEqual(await current.syncPendingTransactions(), { synced: 0, duplicates: 1, failed: 0 })
  assert.equal(context.pending.size, 0)
  assert.equal((await getDocs(ownerCollection())).size, 1)
})

test("offline metadata stays local and queued sync creates exactly three valid cloud records", async () => {
  context.online = false
  for (const row of csvRows) assert.equal((await save(row)).pending, true)
  assert.equal(context.pending.size, 3)
  assert.ok([...context.pending.values()].every((record) => record.transaction.utr && record.transaction.source))
  assert.equal((await getDocs(ownerCollection())).size, 0)
  context.online = true
  assert.deepEqual(await current.syncPendingTransactions(), { synced: 3, duplicates: 0, failed: 0 })
  assert.equal(context.pending.size, 0)
  const stored = await getDocs(ownerCollection())
  assert.equal(stored.size, 3)
  stored.docs.forEach(assertSeven)
})

test("reference conflicts remain blocked and other users cannot read owner records", async () => {
  await save(csvRows[0])
  await assert.rejects(() => save({ ...csvRows[0], amount: 2 }), { code: "reference-conflict" })
  await assert.rejects(() => getDoc(doc(context.db, "users", "another-owner", "transactions", "missing-record")), denied)
  assert.equal((await getDocs(ownerCollection())).size, 1)
})

test("legacy ownership-filtered queries work; unfiltered expenses and collection-group queries are denied", async () => {
  await setDoc(doc(context.db, "expenses", `legacy-${context.uid}`), { userId: context.uid, amount: 1 })
  const owned = await getDocs(query(collection(context.db, "expenses"), where("userId", "==", context.uid)))
  assert.equal(owned.size, 1)
  await assert.rejects(() => getDocs(collection(context.db, "expenses")), denied)
  await assert.rejects(() => getDoc(doc(context.db, "expenses", `missing-${context.uid}`)), denied)
  await assert.rejects(() => getDocs(collectionGroup(context.db, "transactions")), denied)
})

test("the existing legacy-then-canonical Merge Data sequence succeeds under the supplied rules", async () => {
  const legacy = await loadStatementModule("src/services/dataService.js", seams())
  context.user = null
  await legacy.addExpense({ amount: 1, category: "Other", note: "Synthetic legacy guest", date: "2026-10-12" })
  for (const row of csvRows) await current.saveImportedTransactionWithId(getImportDocumentId(row), row)
  context.user = { uid: context.uid }
  assert.equal((await legacy.mergeGuestExpensesIntoAccount()).merged, 1)
  assert.equal((await current.mergeGuestTransactionsIntoAccount()).merged, 3)
  assert.equal(legacy.getGuestExpenses().length, 0)
  assert.equal(current.getGuestTransactions().length, 0)
  const oldRecords = await getDocs(query(collection(context.db, "expenses"), where("userId", "==", context.uid)))
  assert.equal(oldRecords.size, 1)
  const records = await getDocs(ownerCollection())
  assert.equal(records.size, 3)
  records.docs.forEach(assertSeven)
})
