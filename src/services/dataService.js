import { onAuthStateChanged } from "firebase/auth"
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore"

import { auth, db } from "../firebase"

export const GUEST_EXPENSES_STORAGE_KEY = "finsight_expenses_v1"
export const GUEST_MODE_STORAGE_KEY = "finsight_guest_mode_v1"
export const OFFLINE_QUEUE_STORAGE_KEY = "finsight_expense_queue_v1"
export const EXPENSES_CHANGED_EVENT = "expensesChanged"

const EXPENSES_COLLECTION = "expenses"
const DATA_SERVICE_INIT_KEY = "__finsightDataServiceInitialized"

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch (error) {
    console.error(`Failed to read ${key}`, error)
    return fallback
  }
}

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.error(`Failed to write ${key}`, error)
    return false
  }
}

const removeStorageItem = (key) => {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.error(`Failed to remove ${key}`, error)
  }
}

const getNowDateString = () => new Date().toISOString().split("T")[0]

const generateExpenseId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `expense_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const toTimestamp = (value) => {
  if (value == null) return null

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value.toMillis === "function") {
    return value.toMillis()
  }

  if (typeof value.toDate === "function") {
    return value.toDate().getTime()
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000
  }

  return null
}

const getExpenseTimestamp = (expense = {}) => {
  return (
    toTimestamp(expense.timestamp) ??
    toTimestamp(expense.updatedAt) ??
    toTimestamp(expense.createdAt) ??
    toTimestamp(expense.date) ??
    0
  )
}

const toDateString = (value) => {
  if (!value) return getNowDateString()
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  const timestamp = toTimestamp(value)
  if (!timestamp) return getNowDateString()

  return new Date(timestamp).toISOString().split("T")[0]
}

const normalizeExpense = (expense = {}, overrides = {}) => {
  const fallbackTimestamp = overrides.timestamp ?? Date.now()
  const createdTimestamp =
    toTimestamp(overrides.createdAt) ??
    toTimestamp(expense.createdAt) ??
    toTimestamp(expense.timestamp) ??
    toTimestamp(expense.date) ??
    fallbackTimestamp
  const updatedTimestamp =
    overrides.timestamp ??
    toTimestamp(overrides.updatedAt) ??
    toTimestamp(expense.updatedAt) ??
    toTimestamp(expense.timestamp) ??
    createdTimestamp
  const createdAt =
    overrides.createdAt ?? expense.createdAt ?? new Date(createdTimestamp).toISOString()
  const updatedAt =
    overrides.updatedAt ?? new Date(updatedTimestamp).toISOString()

  const normalized = {
    id: String(overrides.id ?? expense.id ?? generateExpenseId()),
    amount: Number(expense.amount) || 0,
    category: expense.category || "Other",
    note: expense.note || "",
    date: toDateString(expense.date || createdAt),
    createdAt,
    updatedAt,
    timestamp: updatedTimestamp,
  }

  if (expense.merchant) {
    normalized.merchant = expense.merchant
  }

  const userId = overrides.userId ?? expense.userId
  if (userId) {
    normalized.userId = userId
  }

  return normalized
}

const sortExpenses = (expenses = []) =>
  [...expenses].sort((left, right) => {
    const timestampDiff = getExpenseTimestamp(right) - getExpenseTimestamp(left)
    if (timestampDiff !== 0) return timestampDiff
    return String(right.id).localeCompare(String(left.id))
  })

const buildConflictKey = (expense = {}) => {
  return [
    toDateString(expense.date),
    (Number(expense.amount) || 0).toFixed(2),
    String(expense.category || "").trim().toLowerCase(),
    String(expense.note || "").trim().toLowerCase(),
    String(expense.merchant || "").trim().toLowerCase(),
  ].join("|")
}

const readGuestExpenses = () => {
  const parsed = readJson(GUEST_EXPENSES_STORAGE_KEY, [])
  if (!Array.isArray(parsed)) return []
  return sortExpenses(parsed.map((expense) => normalizeExpense(expense)))
}

const writeGuestExpenses = (expenses) => {
  return writeJson(
    GUEST_EXPENSES_STORAGE_KEY,
    sortExpenses(expenses.map((expense) => normalizeExpense(expense))),
  )
}

const isGuestModeEnabled = () => readJson(GUEST_MODE_STORAGE_KEY, false) === true

const emitExpenseChange = (type, detail = {}) => {
  if (typeof window === "undefined") return

  const payload = { type, ...detail }
  window.dispatchEvent(new CustomEvent(EXPENSES_CHANGED_EVENT, { detail: payload }))

  if (type === "add") {
    window.dispatchEvent(new CustomEvent("expenseAdded", { detail: payload }))
  }

  if (type === "update") {
    window.dispatchEvent(new CustomEvent("expenseUpdated", { detail: payload }))
  }

  if (type === "delete") {
    window.dispatchEvent(new CustomEvent("expenseDeleted", { detail: payload }))
  }
}

const isOnline = () => {
  if (typeof navigator === "undefined") return true
  return navigator.onLine
}

const isRetryableError = (error) => {
  const code = String(error?.code || "").replace("firestore/", "")
  return ["aborted", "deadline-exceeded", "failed-precondition", "unavailable"].includes(code)
}

const readOfflineQueue = () => {
  const parsed = readJson(OFFLINE_QUEUE_STORAGE_KEY, [])
  return Array.isArray(parsed) ? parsed : []
}

const writeOfflineQueue = (queue) => {
  writeJson(OFFLINE_QUEUE_STORAGE_KEY, queue)
}

const enqueueOfflineOperation = (operation) => {
  const queue = readOfflineQueue()
  queue.push({
    ...operation,
    queuedAt: Date.now(),
  })
  writeOfflineQueue(queue)
}

const persistExpenseToCloud = async (expense, user = auth.currentUser) => {
  if (!user) {
    throw new Error("A logged-in user is required to store expenses in Firestore.")
  }

  const nextExpense = normalizeExpense(expense, { userId: user.uid, id: expense.id })
  const queuedOperation = {
    type: "upsert",
    userId: user.uid,
    expense: nextExpense,
  }

  let wasQueued = false
  if (!isOnline()) {
    enqueueOfflineOperation(queuedOperation)
    wasQueued = true
  }

  try {
    await setDoc(doc(db, EXPENSES_COLLECTION, nextExpense.id), nextExpense, { merge: true })
    return nextExpense
  } catch (error) {
    if (isRetryableError(error) && !wasQueued) {
      enqueueOfflineOperation(queuedOperation)
      return nextExpense
    }

    throw error
  }
}

const removeExpenseFromCloud = async (id, user = auth.currentUser) => {
  if (!user) {
    throw new Error("A logged-in user is required to delete Firestore expenses.")
  }

  const expenseId = String(id)
  const queuedOperation = {
    type: "delete",
    userId: user.uid,
    id: expenseId,
  }

  let wasQueued = false
  if (!isOnline()) {
    enqueueOfflineOperation(queuedOperation)
    wasQueued = true
  }

  try {
    await deleteDoc(doc(db, EXPENSES_COLLECTION, expenseId))
    return true
  } catch (error) {
    if (isRetryableError(error) && !wasQueued) {
      enqueueOfflineOperation(queuedOperation)
      return true
    }

    throw error
  }
}

const getCloudExpenses = async (user = auth.currentUser) => {
  if (!user) return []

  const expensesQuery = query(
    collection(db, EXPENSES_COLLECTION),
    where("userId", "==", user.uid),
  )
  const snapshot = await getDocs(expensesQuery)

  return sortExpenses(
    snapshot.docs.map((document) =>
      normalizeExpense(
        {
          id: document.id,
          ...document.data(),
        },
        { userId: user.uid },
      ),
    ),
  )
}

const resolveLatestExpense = (existingExpense, incomingExpense, preferredId) => {
  const existingTimestamp = getExpenseTimestamp(existingExpense)
  const incomingTimestamp = getExpenseTimestamp(incomingExpense)
  const winner =
    incomingTimestamp >= existingTimestamp ? incomingExpense : existingExpense
  const loser = winner === incomingExpense ? existingExpense : incomingExpense
  const createdCandidates = [
    toTimestamp(existingExpense?.createdAt),
    toTimestamp(incomingExpense?.createdAt),
    existingTimestamp,
    incomingTimestamp,
  ].filter((value) => Number.isFinite(value) && value > 0)
  const createdTimestamp =
    createdCandidates.length > 0 ? Math.min(...createdCandidates) : Date.now()
  const updatedTimestamp = Math.max(existingTimestamp, incomingTimestamp)

  return normalizeExpense(
    {
      ...loser,
      ...winner,
      id: preferredId ?? winner.id ?? loser.id,
    },
    {
      id: preferredId ?? winner.id ?? loser.id,
      createdAt: new Date(createdTimestamp).toISOString(),
      updatedAt: new Date(updatedTimestamp).toISOString(),
      timestamp: updatedTimestamp,
      userId: winner.userId ?? loser.userId,
    },
  )
}

const upsertGuestExpense = (expense) => {
  const guestExpenses = readGuestExpenses()
  const expenseId = String(expense.id)
  const existingIndex = guestExpenses.findIndex(
    (currentExpense) => String(currentExpense.id) === expenseId,
  )

  if (existingIndex === -1) {
    const nextExpenses = sortExpenses([expense, ...guestExpenses])
    writeGuestExpenses(nextExpenses)
    return expense
  }

  const resolved = resolveLatestExpense(guestExpenses[existingIndex], expense, expenseId)
  const nextExpenses = [...guestExpenses]
  nextExpenses[existingIndex] = resolved
  writeGuestExpenses(nextExpenses)
  return resolved
}

export async function flushQueuedOperations(user = auth.currentUser) {
  const currentUser = user ?? auth.currentUser
  if (!currentUser || !isOnline()) return readOfflineQueue().length

  const queue = readOfflineQueue()
  if (!queue.length) return 0

  const remaining = []
  let syncedCount = 0

  for (const operation of queue) {
    if (operation.userId && operation.userId !== currentUser.uid) {
      remaining.push(operation)
      continue
    }

    try {
      if (operation.type === "delete") {
        await deleteDoc(doc(db, EXPENSES_COLLECTION, String(operation.id)))
      } else {
        const queuedExpense = normalizeExpense(operation.expense, {
          userId: currentUser.uid,
          id: operation.expense?.id,
        })
        await setDoc(doc(db, EXPENSES_COLLECTION, queuedExpense.id), queuedExpense, {
          merge: true,
        })
      }
      syncedCount += 1
    } catch (error) {
      console.error("Failed to flush queued expense operation", error)
      remaining.push(operation)
    }
  }

  writeOfflineQueue(remaining)

  if (syncedCount > 0) {
    emitExpenseChange("sync", { syncedCount, pendingCount: remaining.length })
  }

  return remaining.length
}

export function initializeGuestMode() {
  const wasGuestModeEnabled = isGuestModeEnabled()
  writeJson(GUEST_MODE_STORAGE_KEY, true)

  if (!localStorage.getItem(GUEST_EXPENSES_STORAGE_KEY)) {
    writeGuestExpenses([])
  }

  if (!wasGuestModeEnabled) {
    emitExpenseChange("sourceChanged", { mode: "guest" })
  }
}

export function clearGuestMode() {
  removeStorageItem(GUEST_MODE_STORAGE_KEY)
}

export function getGuestExpenses() {
  return readGuestExpenses()
}

export function hasGuestExpenses() {
  return readGuestExpenses().length > 0
}

export function discardGuestExpenses() {
  removeStorageItem(GUEST_EXPENSES_STORAGE_KEY)
  clearGuestMode()
  emitExpenseChange("sourceChanged", { mode: auth.currentUser ? "cloud" : "guest" })
}

export async function mergeGuestExpensesIntoAccount(user = auth.currentUser) {
  const currentUser = user ?? auth.currentUser
  if (!currentUser) {
    return { merged: 0, keptRemote: 0, totalGuestExpenses: 0 }
  }

  const guestExpenses = readGuestExpenses()
  if (!guestExpenses.length) {
    clearGuestMode()
    return { merged: 0, keptRemote: 0, totalGuestExpenses: 0 }
  }

  const cloudExpenses = await getCloudExpenses(currentUser)
  const cloudById = new Map(cloudExpenses.map((expense) => [String(expense.id), expense]))
  const cloudBySignature = new Map(
    cloudExpenses.map((expense) => [buildConflictKey(expense), expense]),
  )

  let merged = 0
  let keptRemote = 0

  for (const guestExpense of guestExpenses) {
    const normalizedGuestExpense = normalizeExpense(guestExpense, {
      userId: currentUser.uid,
      id: guestExpense.id,
    })
    const signature = buildConflictKey(normalizedGuestExpense)
    const conflict =
      cloudById.get(String(normalizedGuestExpense.id)) ?? cloudBySignature.get(signature)

    if (!conflict) {
      await persistExpenseToCloud(normalizedGuestExpense, currentUser)
      cloudById.set(normalizedGuestExpense.id, normalizedGuestExpense)
      cloudBySignature.set(signature, normalizedGuestExpense)
      merged += 1
      continue
    }

    if (getExpenseTimestamp(normalizedGuestExpense) >= getExpenseTimestamp(conflict)) {
      const resolvedExpense = resolveLatestExpense(
        conflict,
        normalizedGuestExpense,
        conflict.id || normalizedGuestExpense.id,
      )
      await persistExpenseToCloud(resolvedExpense, currentUser)
      cloudById.set(String(resolvedExpense.id), resolvedExpense)
      cloudBySignature.set(buildConflictKey(resolvedExpense), resolvedExpense)
      merged += 1
    } else {
      keptRemote += 1
    }
  }

  discardGuestExpenses()
  emitExpenseChange("merge", { merged, keptRemote })

  return {
    merged,
    keptRemote,
    totalGuestExpenses: guestExpenses.length,
  }
}

export async function getExpenses() {
  const user = auth.currentUser

  if (user) {
    try {
      await flushQueuedOperations(user)
      return await getCloudExpenses(user)
    } catch (error) {
      console.error("Failed to fetch expenses from Firestore", error)
      return []
    }
  }

  return readGuestExpenses()
}

export async function addExpense(expense) {
  const user = auth.currentUser
  const timestamp = Date.now()
  const createdAt = expense.createdAt ?? new Date(timestamp).toISOString()
  const nextExpense = normalizeExpense(expense, {
    id: expense.id,
    createdAt,
    updatedAt: new Date(timestamp).toISOString(),
    timestamp,
    userId: user?.uid,
  })

  try {
    if (user) {
      const savedExpense = await persistExpenseToCloud(nextExpense, user)
      emitExpenseChange("add", { expense: savedExpense })
      return savedExpense
    }

    initializeGuestMode()
    const savedExpense = upsertGuestExpense(nextExpense)
    emitExpenseChange("add", { expense: savedExpense })
    return savedExpense
  } catch (error) {
    console.error("Failed to add expense", error)
    return null
  }
}

export async function updateExpense(id, updates) {
  const expenseId = String(id)
  const existingExpenses = await getExpenses()
  const existingExpense = existingExpenses.find(
    (currentExpense) => String(currentExpense.id) === expenseId,
  )
  const timestamp = Date.now()
  const nextExpense = normalizeExpense(
    {
      ...existingExpense,
      ...updates,
      id: expenseId,
    },
    {
      id: expenseId,
      createdAt: existingExpense?.createdAt ?? new Date(timestamp).toISOString(),
      updatedAt: new Date(timestamp).toISOString(),
      timestamp,
      userId: auth.currentUser?.uid ?? existingExpense?.userId,
    },
  )

  try {
    if (auth.currentUser) {
      const savedExpense = await persistExpenseToCloud(nextExpense, auth.currentUser)
      emitExpenseChange("update", { expense: savedExpense })
      return savedExpense
    }

    initializeGuestMode()
    const savedExpense = upsertGuestExpense(nextExpense)
    emitExpenseChange("update", { expense: savedExpense })
    return savedExpense
  } catch (error) {
    console.error("Failed to update expense", error)
    return null
  }
}

export async function deleteExpense(id) {
  const expenseId = String(id)

  try {
    if (auth.currentUser) {
      await removeExpenseFromCloud(expenseId, auth.currentUser)
      emitExpenseChange("delete", { id: expenseId })
      return true
    }

    const remainingExpenses = readGuestExpenses().filter(
      (expense) => String(expense.id) !== expenseId,
    )
    writeGuestExpenses(remainingExpenses)
    emitExpenseChange("delete", { id: expenseId })
    return true
  } catch (error) {
    console.error("Failed to delete expense", error)
    return false
  }
}

if (typeof window !== "undefined" && !window[DATA_SERVICE_INIT_KEY]) {
  window[DATA_SERVICE_INIT_KEY] = true

  window.addEventListener("online", () => {
    flushQueuedOperations().catch((error) => {
      console.error("Failed to sync queued expense operations", error)
    })
  })

  onAuthStateChanged(auth, (user) => {
    if (user) {
      flushQueuedOperations(user).catch((error) => {
        console.error("Failed to sync queued expense operations after sign-in", error)
      })
    }

    emitExpenseChange("sourceChanged", {
      mode: user ? "cloud" : "guest",
      userId: user?.uid ?? null,
    })
  })
}

const dataService = {
  addExpense,
  deleteExpense,
  discardGuestExpenses,
  flushQueuedOperations,
  getExpenses,
  getGuestExpenses,
  hasGuestExpenses,
  initializeGuestMode,
  mergeGuestExpensesIntoAccount,
  updateExpense,
}

export default dataService
