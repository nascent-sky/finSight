import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
} from "firebase/firestore"

import { auth, db } from "../firebase"

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
  } catch (error) {
    console.error("Failed to read guest transactions", error)
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
    throw new Error("Guest transaction storage is unavailable.")
  }

  try {
    if (transactions.length === 0) {
      localStorage.removeItem(GUEST_TRANSACTIONS_STORAGE_KEY)
    } else {
      localStorage.setItem(GUEST_TRANSACTIONS_STORAGE_KEY, JSON.stringify(transactions))
    }
  } catch (error) {
    console.error("Failed to write guest transactions", error)
    throw new Error("Could not save the transaction on this device.")
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

export const getGuestTransactions = () =>
  sortTransactions(
    readGuestTransactionRecords().flatMap((transaction) => {
      try {
        const id = String(transaction.id || "").trim()
        if (!id) return []
        return [{ id, ...normalizeTransaction(transaction) }]
      } catch (error) {
        console.error("Ignored an invalid guest transaction", error)
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

export const addTransactionWithId = async (id, transaction) => {
  const user = requireUser()
  const transactionId = String(id ?? "").trim()

  if (!transactionId || transactionId.includes("/")) {
    throw new Error("A valid transaction document ID is required.")
  }

  const normalized = normalizeTransaction(transaction)
  const reference = doc(db, "users", user.uid, "transactions", transactionId)
  const created = await runTransaction(db, async (firestoreTransaction) => {
    const snapshot = await firestoreTransaction.get(reference)

    if (snapshot.exists()) return false

    firestoreTransaction.set(reference, normalized)
    return true
  })

  return { id: transactionId, ...normalized, created }
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
      const normalized = normalizeTransaction(transaction)
      const reference = doc(
        db,
        "users",
        currentUser.uid,
        "transactions",
        transaction.id,
      )

      await setDoc(reference, normalized)

      const remainingTransactions = getGuestTransactions().filter(
        (guestTransaction) => guestTransaction.id !== transaction.id,
      )
      writeGuestTransactionRecords(remainingTransactions)
      emitGuestTransactionsChanged("merge", { id: transaction.id })
      merged += 1
    } catch (error) {
      console.error("Failed to merge a guest transaction", error)
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

  return onSnapshot(
    transactionsQuery,
    (snapshot) => {
      callback(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })))
    },
    errorCallback,
  )
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

    const normalized = normalizeTransaction({
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

  await deleteDoc(doc(db, "users", user.uid, "transactions", transactionId))
  return true
}
