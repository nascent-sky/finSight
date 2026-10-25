import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromCache,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
} from "firebase/firestore"

import { auth, db } from "../firebase"
import {
  addPendingTransaction,
  deletePendingTransaction,
  getPendingTransaction,
  getPendingTransactions,
  subscribeToPendingTransactions,
  updatePendingTransaction,
} from "./pendingTransactionService"
import { findImportMatch, getImportDocumentId, getImportDocumentIds, getImportIdentityKeys, normalizeReference, parseAmountPaise, toImportPayload } from "./statementImportModel.js"
import { diagnoseImportError, importSaveError, importSaveOperation } from "./transactionImportErrors.js"

export const GUEST_TRANSACTIONS_STORAGE_KEY = "finsight_guest_transactions_v1"
export const TRANSACTIONS_CHANGED_EVENT = "transactionsChanged"

const requireUser = () => {
  const user = auth.currentUser

  if (!user?.uid) {
    throw new Error("A logged-in user is required to manage transactions.")
  }

  return user
}

const transactionsCollection = (uid) => collection(db, "users", uid, "transactions")

const assertImportAccount = (expectedUid) => {
  const currentUid = auth.currentUser?.uid ?? null
  if (currentUid !== expectedUid) throw importSaveError(expectedUid && !currentUid ? "auth-unavailable" : "account-changed", "authentication")
}

const validateTransactionId = (id) => {
  const transactionId = String(id ?? "").trim()

  if (!transactionId || transactionId.includes("/")) {
    throw new Error("A valid transaction document ID is required.")
  }

  return transactionId
}

const generateGuestTransactionId = () => {
  if (globalThis.crypto?.randomUUID) {
    return `guest_${globalThis.crypto.randomUUID()}`
  }

  return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const readGuestTransactionRecords = () => {
  if (typeof localStorage === "undefined") return []

  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_TRANSACTIONS_STORAGE_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    console.error("Failed to read guest transactions")
    return []
  }
}

const sortTransactions = (transactions) =>
  [...transactions].sort((left, right) => {
    const datetimeDifference = Date.parse(right.datetime) - Date.parse(left.datetime)
    if (datetimeDifference !== 0) return datetimeDifference
    return String(right.id).localeCompare(String(left.id))
  })

const writeGuestTransactionRecords = (transactions) => {
  if (typeof localStorage === "undefined") {
    throw importSaveError("storage-unavailable", "guest-storage")
  }

  try {
    if (transactions.length === 0) {
      localStorage.removeItem(GUEST_TRANSACTIONS_STORAGE_KEY)
    } else {
      localStorage.setItem(GUEST_TRANSACTIONS_STORAGE_KEY, JSON.stringify(transactions))
    }
  } catch (error) {
    throw importSaveError(error, "guest-storage")
  }
}

const emitGuestTransactionsChanged = (type, detail = {}) => {
  if (typeof window === "undefined") return

  window.dispatchEvent(
    new CustomEvent(TRANSACTIONS_CHANGED_EVENT, {
      detail: { type, ...detail },
    }),
  )
}

export const normalizeTransaction = (transaction = {}) => {
  const amount = Number(transaction.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Transaction amount must be a positive number.")
  }

  if (!['expense', 'income'].includes(transaction.type)) {
    throw new Error('Transaction type must be "expense" or "income".')
  }

  if (!['cash', 'upi'].includes(transaction.paymentMethod)) {
    throw new Error('Transaction payment method must be "cash" or "upi".')
  }

  const date = transaction.datetime == null ? new Date() : new Date(transaction.datetime)
  if (Number.isNaN(date.getTime())) {
    throw new Error("Transaction datetime must be a valid ISO-8601 date.")
  }

  // This is the v3.2.0 cloud contract. Production rules permit exactly these
  // seven fields; import metadata must never be included in a Firestore write.
  return {
    amount,
    datetime: date.toISOString(),
    type: transaction.type,
    person: String(transaction.person ?? ""),
    paymentMethod: transaction.paymentMethod,
    category: String(transaction.category || "Other"),
    note: String(transaction.note ?? ""),
  }
}

// Preview, guest records and the existing offline queue keep source metadata.
// Persisting the financial record to Firestore always projects through the
// seven-field normalizer above; the shared UPI reference lives in its document ID.
const normalizeLocalTransaction = (transaction = {}) => {
  const normalized = normalizeTransaction(transaction)
  const metadata = {}
  if (transaction.source && ["gpay", "phonepe", "paytm"].includes(transaction.source.provider) && ["pdf", "csv", "xlsx"].includes(transaction.source.format)) {
    metadata.source = { provider: transaction.source.provider, format: transaction.source.format }
  }
  for (const field of ["upiTransactionId", "transactionId", "utr"]) {
    if (transaction[field]) {
      const value = normalizeReference(transaction[field])
      if (!/^[A-Z0-9-]{4,80}$/.test(value)) throw new Error("Invalid import reference.")
      metadata[field] = value
    }
  }
  if (transaction.paymentInstrument) metadata.paymentInstrument = String(transaction.paymentInstrument).slice(0, 1000)
  if (transaction.amountPaise != null || metadata.source) metadata.amountPaise = parseAmountPaise(String(normalized.amount))
  const identityKeys = getImportIdentityKeys(metadata)
  if (identityKeys.length) metadata.importIdentityKeys = identityKeys

  return {
    ...normalized,
    ...metadata,
  }
}

export const getGuestTransactions = () =>
  sortTransactions(
    readGuestTransactionRecords().flatMap((transaction) => {
      try {
        const id = String(transaction.id || "").trim()
        if (!id) return []
        return [{ id, ...normalizeLocalTransaction(transaction) }]
      } catch {
        console.error("Ignored an invalid guest transaction")
        return []
      }
    }),
  )

export const hasGuestTransactions = () => getGuestTransactions().length > 0

export const discardGuestTransactions = () => {
  writeGuestTransactionRecords([])
  emitGuestTransactionsChanged("discard")
}

export const addTransaction = async (transaction) => {
  const normalized = normalizeTransaction(transaction)

  const user = auth.currentUser
  if (!user?.uid) {
    const savedTransaction = {
      id: generateGuestTransactionId(),
      ...normalized,
    }
    const nextTransactions = sortTransactions([
      savedTransaction,
      ...getGuestTransactions(),
    ])
    writeGuestTransactionRecords(nextTransactions)
    emitGuestTransactionsChanged("add", { transaction: savedTransaction })
    return savedTransaction
  }

  const reference = await addDoc(transactionsCollection(user.uid), normalized)

  return { id: reference.id, ...normalized }
}

export const addGuestTransactionWithId = async (id, transaction) => {
  const transactionId = validateTransactionId(id)
  const normalized = normalizeLocalTransaction(transaction)
  const guestTransactions = getGuestTransactions()
  const match = findImportMatch({ id: transactionId, ...normalized }, guestTransactions)
  if (match?.conflict) throw new Error("An existing transaction has the same reference but conflicting financial details. Review it before importing.")
  const existing = guestTransactions.find((item) => item.id === transactionId) || match?.record

  if (existing) return { ...existing, created: false }

  const savedTransaction = { id: transactionId, ...normalized }
  writeGuestTransactionRecords(sortTransactions([savedTransaction, ...guestTransactions]))
  emitGuestTransactionsChanged("add", { transaction: savedTransaction })

  return { ...savedTransaction, created: true }
}

const createTransactionIfMissing = async (uid, id, normalized) => {
  assertImportAccount(uid)
  const reference = doc(db, "users", uid, "transactions", id)
  // Older queued/guest GPay records contain only seven fields, with their UPI
  // identity retained solely in the document ID. Include that identity as well.
  const identityRecord = { id, ...normalized }
  const aliases = [...new Set([id, ...getImportDocumentIds(identityRecord)])]
  // Like v3.2.0, check deterministic owner-scoped document IDs in the same
  // transaction that creates the record. No metadata or collection-group query.
  return importSaveOperation("firestore-write", () => runTransaction(db, async (firestoreTransaction) => {
    const snapshots = await importSaveOperation("firestore-read", () => Promise.all(aliases.map((alias) => firestoreTransaction.get(doc(db, "users", uid, "transactions", alias)))))
    const existing = snapshots.find((snapshot) => snapshot.exists())
    if (existing) {
      const match = findImportMatch(identityRecord, [{ id: existing.id, ...existing.data() }])
      if (match?.conflict) throw importSaveError("reference-conflict", "duplicate-check")
      return false
    }
    assertImportAccount(uid)

    firestoreTransaction.set(reference, normalizeTransaction(normalized))
    return true
  }))
}

export const addTransactionWithId = async (id, transaction) => {
  const user = requireUser()
  const transactionId = validateTransactionId(id)
  const normalized = normalizeLocalTransaction(transaction)
  const created = await createTransactionIfMissing(user.uid, transactionId, normalized)

  return { id: transactionId, ...normalized, created }
}

const isOfflineFirestoreError = (error) => {
  const code = String(error?.code || "").replace("firestore/", "")

  return [
    "aborted",
    "deadline-exceeded",
    "network-request-failed",
    "unavailable",
  ].includes(code)
}

const queueAuthenticatedTransaction = async (uid, id, normalized) => {
  assertImportAccount(uid)
  const result = await importSaveOperation("offline-queue", () => addPendingTransaction(uid, id, normalized))

  return {
    id,
    ...normalized,
    created: result.created,
    pending: true,
    storage: "indexeddb",
  }
}

export const saveImportedTransactionWithId = async (id, transaction, { expectedUid } = {}) => {
  let normalized, transactionId
  try {
    validateTransactionId(id)
    normalized = normalizeLocalTransaction(toImportPayload(transaction))
    transactionId = getImportDocumentId(normalized)
  } catch (error) { throw importSaveError(error, "validation") }
  // The preview's account is authoritative for this batch. A lost sign-in must
  // not silently redirect an authenticated import into guest storage.
  if (expectedUid !== undefined) assertImportAccount(expectedUid)
  const user = auth.currentUser

  if (!user?.uid) {
    const saved = await importSaveOperation("guest-storage", () => addGuestTransactionWithId(transactionId, normalized))
    return { ...saved, storage: "guest" }
  }

  const pending = await getPendingTransactions(user.uid).catch(() => [])
  const cached = await getDocsFromCache(transactionsCollection(user.uid)).catch(() => null)
  assertImportAccount(user.uid)
  const match = findImportMatch(normalized, [
    ...pending.map((record) => ({ id: record.id, ...record.transaction })),
    ...(cached?.docs || []).map((record) => ({ id: record.id, ...record.data() })),
  ])
  if (match?.conflict) throw importSaveError("reference-conflict", "duplicate-check")
  if (match) return { ...match.record, created: false, pending: Boolean(pending.some((record) => record.id === match.record.id)) }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return queueAuthenticatedTransaction(user.uid, transactionId, normalized)
  }

  try {
    const saved = await addTransactionWithId(transactionId, normalized)
    return { ...saved, pending: false, storage: "firestore" }
  } catch (error) {
    if (!isOfflineFirestoreError(error)) throw error
    return queueAuthenticatedTransaction(user.uid, transactionId, normalized)
  }
}

let pendingSync = null

export const syncPendingTransactions = async (user = auth.currentUser) => {
  const currentUser = user ?? auth.currentUser
  if (!currentUser?.uid) return { synced: 0, duplicates: 0, failed: 0 }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, duplicates: 0, failed: 0 }
  }
  if (pendingSync?.uid === currentUser.uid) return pendingSync.promise

  const promise = (async () => {
    const records = await importSaveOperation("local-lookup", () => getPendingTransactions(currentUser.uid))
    const counts = { synced: 0, duplicates: 0, failed: 0 }
    const failures = []

    for (const record of records) {
      if (auth.currentUser?.uid !== currentUser.uid) break

      try {
        let transactionId, normalized
        try {
          transactionId = validateTransactionId(record.id)
          normalized = normalizeLocalTransaction(record.transaction)
        } catch (error) { throw importSaveError(error, "validation") }
        const created = await createTransactionIfMissing(
          currentUser.uid,
          transactionId,
          normalized,
        )
        await importSaveOperation("queue-cleanup", () => deletePendingTransaction(currentUser.uid, record.id))
        counts[created ? "synced" : "duplicates"] += 1
      } catch (error) {
        failures.push(diagnoseImportError(error, "synchronization"))
        counts.failed += 1
      }
    }

    return failures.length ? { ...counts, failures } : counts
  })()

  pendingSync = { uid: currentUser.uid, promise }

  try {
    return await promise
  } finally {
    if (pendingSync?.promise === promise) pendingSync = null
  }
}

export const mergeGuestTransactionsIntoAccount = async (user = auth.currentUser) => {
  const currentUser = user ?? auth.currentUser
  if (!currentUser?.uid) {
    throw new Error("Sign in before merging guest transactions.")
  }

  const guestTransactions = getGuestTransactions()
  let merged = 0
  let failed = 0
  let lastError = null

  for (const transaction of guestTransactions) {
    try {
      const normalized = normalizeLocalTransaction(transaction)
      await createTransactionIfMissing(currentUser.uid, transaction.id, normalized)

      const remainingTransactions = getGuestTransactions().filter(
        (guestTransaction) => guestTransaction.id !== transaction.id,
      )
      writeGuestTransactionRecords(remainingTransactions)
      emitGuestTransactionsChanged("merge", { id: transaction.id })
      merged += 1
    } catch (error) {
      console.error("Failed to merge a guest transaction")
      lastError = error
      failed += 1
    }
  }

  const result = {
    merged,
    failed,
    totalGuestTransactions: guestTransactions.length,
  }

  if (failed > 0) {
    const error = new Error(
      `${failed} guest transaction${failed === 1 ? "" : "s"} could not be merged.`,
    )
    error.cause = lastError
    error.mergeResult = result
    throw error
  }

  return result
}

export const subscribeToTransactions = (callback, errorCallback) => {
  const user = auth.currentUser

  if (!user?.uid) {
    if (typeof callback !== "function") return () => {}

    const publish = () => callback(getGuestTransactions())
    const handleStorage = (event) => {
      if (event.key && event.key !== GUEST_TRANSACTIONS_STORAGE_KEY) return
      publish()
    }

    publish()

    if (typeof window === "undefined") return () => {}

    window.addEventListener("storage", handleStorage)
    window.addEventListener(TRANSACTIONS_CHANGED_EVENT, publish)

    return () => {
      window.removeEventListener("storage", handleStorage)
      window.removeEventListener(TRANSACTIONS_CHANGED_EVENT, publish)
    }
  }

  const transactionsQuery = query(
    transactionsCollection(user.uid),
    orderBy("datetime", "desc"),
  )

  let firestoreTransactions = []
  let pendingTransactions = []
  let isActive = true
  let hasFirestoreSnapshot = false
  let snapshotFromCache = true
  let snapshotHasPendingWrites = false
  let pendingReady = false
  let firestoreFailed = false

  const publish = () => {
    if (!isActive || typeof callback !== "function") return

    const combined = new Map()
    pendingTransactions.forEach((record) => {
      combined.set(record.id, {
        id: record.id,
        ...record.transaction,
        pending: true,
      })
    })
    firestoreTransactions.forEach((transaction) => {
      combined.set(transaction.id, transaction)
    })
    callback(sortTransactions([...combined.values()]), {
      isReady: hasFirestoreSnapshot && pendingReady && !firestoreFailed,
      fromCache: snapshotFromCache,
      hasPendingWrites: snapshotHasPendingWrites || pendingTransactions.length > 0,
    })
  }

  const refreshPendingTransactions = async () => {
    try {
      pendingTransactions = await getPendingTransactions(user.uid)
      pendingReady = true
      publish()
    } catch (error) {
      if (isActive) errorCallback?.(importSaveError(error, "local-lookup"))
    }
  }

  const unsubscribePending = subscribeToPendingTransactions(
    user.uid,
    refreshPendingTransactions,
  )
  void refreshPendingTransactions()

  const unsubscribeFirestore = onSnapshot(
    transactionsQuery,
    { includeMetadataChanges: true },
    (snapshot) => {
      hasFirestoreSnapshot = true
      snapshotFromCache = snapshot.metadata.fromCache
      snapshotHasPendingWrites = snapshot.metadata.hasPendingWrites
      firestoreTransactions = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      }))
      publish()
    },
    (error) => {
      firestoreFailed = true
      errorCallback?.(importSaveError(error, "firestore-read"))
    },
  )

  return () => {
    isActive = false
    unsubscribePending()
    unsubscribeFirestore()
  }
}

export const updateTransaction = async (id, updates) => {
  const user = auth.currentUser
  const transactionId = String(id)

  if (!user?.uid) {
    const transactions = getGuestTransactions()
    const existingIndex = transactions.findIndex(
      (transaction) => transaction.id === transactionId,
    )

    if (existingIndex === -1) {
      throw new Error("Transaction not found.")
    }

    const normalized = normalizeLocalTransaction({
      ...transactions[existingIndex],
      ...updates,
    })
    const savedTransaction = { id: transactionId, ...normalized }
    const nextTransactions = [...transactions]
    nextTransactions[existingIndex] = savedTransaction
    writeGuestTransactionRecords(sortTransactions(nextTransactions))
    emitGuestTransactionsChanged("update", { transaction: savedTransaction })
    return savedTransaction
  }

  const pendingRecord = await getPendingTransaction(user.uid, transactionId)
  if (pendingRecord) {
    const normalized = normalizeLocalTransaction({
      ...pendingRecord.transaction,
      ...updates,
    })
    await updatePendingTransaction(user.uid, transactionId, normalized)
    return { id: transactionId, ...normalized, pending: true }
  }

  const reference = doc(db, "users", user.uid, "transactions", transactionId)
  const snapshot = await getDoc(reference)

  if (!snapshot.exists()) {
    throw new Error("Transaction not found.")
  }

  const normalized = normalizeTransaction({ ...snapshot.data(), ...updates })
  await setDoc(reference, normalized)

  return { id: reference.id, ...normalized }
}

export const deleteTransaction = async (id) => {
  const user = auth.currentUser
  const transactionId = String(id)

  if (!user?.uid) {
    const transactions = getGuestTransactions()
    const nextTransactions = transactions.filter(
      (transaction) => transaction.id !== transactionId,
    )

    if (nextTransactions.length === transactions.length) {
      throw new Error("Transaction not found.")
    }

    writeGuestTransactionRecords(nextTransactions)
    emitGuestTransactionsChanged("delete", { id: transactionId })
    return true
  }

  const pendingRecord = await getPendingTransaction(user.uid, transactionId)
  if (pendingRecord) {
    await deletePendingTransaction(user.uid, transactionId)
    return true
  }

  await deleteDoc(doc(db, "users", user.uid, "transactions", transactionId))
  return true
}
