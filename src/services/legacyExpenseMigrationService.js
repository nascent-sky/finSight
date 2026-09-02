import { collection, doc, getDocs, query, runTransaction, where } from "firebase/firestore"

import { auth, db } from "../firebase"

const LEGACY_EXPENSES_COLLECTION = "expenses"
const TRANSACTIONS_COLLECTION = "transactions"

const asTrimmedString = (value) =>
  typeof value === "string" ? value.trim() : ""

const toDate = (value) => {
  if (value == null || value === "") return null

  if (value instanceof Date) return value
  if (typeof value?.toDate === "function") return value.toDate()
  if (typeof value?.toMillis === "function") return new Date(value.toMillis())
  if (typeof value?.seconds === "number") {
    return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6))
  }

  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number)
    return new Date(year, month - 1, day)
  }

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getLegacyDatetime = (expense) => {
  const candidates = [
    ["createdAt", expense.createdAt],
    ["timestamp", expense.timestamp],
    ["date", expense.date],
    ["updatedAt", expense.updatedAt],
  ]

  for (const [field, value] of candidates) {
    const date = toDate(value)
    if (date && !Number.isNaN(date.getTime())) {
      return { datetime: date.toISOString(), sourceField: field }
    }
  }

  return null
}

const getLegacyNote = (expense) =>
  asTrimmedString(expense.note) ||
  asTrimmedString(expense.description) ||
  asTrimmedString(expense.merchant)

export const convertLegacyExpense = (expense = {}) => {
  const problems = []
  const numericAmount = Number(expense.amount)
  const amount = Math.abs(numericAmount)

  if (!Number.isFinite(amount) || amount <= 0) {
    problems.push("Amount is missing, zero, or not a valid number.")
  }

  const legacyDatetime = getLegacyDatetime(expense)
  if (!legacyDatetime) {
    problems.push("No valid date or timestamp was found.")
  }

  if (problems.length > 0) {
    return { problems, transaction: null, datetimeSourceField: null }
  }

  return {
    problems: [],
    datetimeSourceField: legacyDatetime.sourceField,
    transaction: {
      amount,
      datetime: legacyDatetime.datetime,
      type: "expense",
      person: "",
      paymentMethod: "cash",
      category: asTrimmedString(expense.category) || "Other",
      note: getLegacyNote(expense),
    },
  }
}

const getAuthenticatedUser = () => {
  const user = auth.currentUser
  if (!user?.uid) {
    throw new Error("Sign in to preview legacy expense migration.")
  }

  return user
}

const loadLegacyExpenseMigrationPreview = async (user) => {

  const legacyQuery = query(
    collection(db, LEGACY_EXPENSES_COLLECTION),
    where("userId", "==", user.uid),
  )
  const snapshot = await getDocs(legacyQuery)
  const convertible = []
  const problems = []

  snapshot.docs.forEach((document) => {
    const legacyExpense = document.data()
    const conversion = convertLegacyExpense(legacyExpense)
    const record = {
      id: document.id,
      legacyExpense,
      ...conversion,
    }

    if (conversion.transaction) convertible.push(record)
    else problems.push(record)
  })

  return {
    legacyExpensesFound: snapshot.size,
    convertible,
    problems,
  }
}

export const getLegacyExpenseMigrationPreview = async () =>
  loadLegacyExpenseMigrationPreview(getAuthenticatedUser())

export const migrateLegacyExpenses = async () => {
  const user = getAuthenticatedUser()
  const preview = await loadLegacyExpenseMigrationPreview(user)
  const result = {
    migrated: 0,
    alreadyMigrated: 0,
    failed: 0,
    failures: [],
  }

  for (const record of preview.convertible) {
    const transactionId = `legacy_${record.id}`

    try {
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error("Authentication changed during migration.")
      }

      const reference = doc(
        db,
        "users",
        user.uid,
        TRANSACTIONS_COLLECTION,
        transactionId,
      )
      const created = await runTransaction(db, async (firestoreTransaction) => {
        const snapshot = await firestoreTransaction.get(reference)

        if (snapshot.exists()) return false

        firestoreTransaction.set(reference, record.transaction)
        return true
      })

      if (created) result.migrated += 1
      else result.alreadyMigrated += 1
    } catch (error) {
      result.failed += 1
      result.failures.push({
        id: record.id,
        message: error?.message || "The expense could not be migrated.",
      })
    }
  }

  return result
}
