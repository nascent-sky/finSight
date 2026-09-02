import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore"

import { auth, db } from "../firebase"

const requireUser = () => {
  const user = auth.currentUser

  if (!user?.uid) {
    throw new Error("A logged-in user is required to manage transactions.")
  }

  return user
}

const transactionsCollection = (uid) => collection(db, "users", uid, "transactions")

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

export const addTransaction = async (transaction) => {
  const user = requireUser()
  const normalized = normalizeTransaction(transaction)
  const reference = await addDoc(transactionsCollection(user.uid), normalized)

  return { id: reference.id, ...normalized }
}

export const subscribeToTransactions = (callback, errorCallback) => {
  const user = requireUser()
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
  const user = requireUser()
  const reference = doc(db, "users", user.uid, "transactions", String(id))
  const snapshot = await getDoc(reference)

  if (!snapshot.exists()) {
    throw new Error("Transaction not found.")
  }

  const normalized = normalizeTransaction({ ...snapshot.data(), ...updates })
  await setDoc(reference, normalized)

  return { id: reference.id, ...normalized }
}

export const deleteTransaction = async (id) => {
  const user = requireUser()
  await deleteDoc(doc(db, "users", user.uid, "transactions", String(id)))
}
