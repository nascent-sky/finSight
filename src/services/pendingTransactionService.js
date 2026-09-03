const DATABASE_NAME = "finsight_pending_transactions_v1"
const DATABASE_VERSION = 1
const STORE_NAME = "transactions"

export const PENDING_TRANSACTIONS_CHANGED_EVENT = "pendingTransactionsChanged"

const openDatabase = () => {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline transaction storage is unavailable."))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" })
        store.createIndex("uid", "uid", { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const performRequest = async (mode, createRequest) => {
  const database = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const request = createRequest(store)
    let result

    request.onsuccess = () => {
      result = request.result
    }
    transaction.oncomplete = () => {
      database.close()
      resolve(result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error || request.error)
    }
    transaction.onabort = () => {
      database.close()
      reject(transaction.error || request.error)
    }
  })
}

const createKey = (uid, id) => `${uid}:${id}`

const emitPendingTransactionsChanged = (uid) => {
  if (typeof window === "undefined") return

  window.dispatchEvent(
    new CustomEvent(PENDING_TRANSACTIONS_CHANGED_EVENT, { detail: { uid } }),
  )
}

export const getPendingTransactions = async (uid) => {
  if (!uid) return []

  const records = await performRequest("readonly", (store) =>
    store.index("uid").getAll(uid),
  )

  return Array.isArray(records) ? records : []
}

export const getPendingTransaction = async (uid, id) => {
  if (!uid || !id) return null

  return performRequest("readonly", (store) => store.get(createKey(uid, id)))
}

export const addPendingTransaction = async (uid, id, transaction) => {
  const record = {
    key: createKey(uid, id),
    uid,
    id,
    transaction,
  }

  try {
    await performRequest("readwrite", (store) => store.add(record))
    emitPendingTransactionsChanged(uid)
    return { created: true, record }
  } catch (error) {
    if (error?.name === "ConstraintError") {
      return { created: false, record }
    }
    throw error
  }
}

export const deletePendingTransaction = async (uid, id) => {
  await performRequest("readwrite", (store) => store.delete(createKey(uid, id)))
  emitPendingTransactionsChanged(uid)
}

export const updatePendingTransaction = async (uid, id, transaction) => {
  const record = {
    key: createKey(uid, id),
    uid,
    id,
    transaction,
  }

  await performRequest("readwrite", (store) => store.put(record))
  emitPendingTransactionsChanged(uid)
  return record
}

export const subscribeToPendingTransactions = (uid, callback) => {
  if (typeof window === "undefined" || typeof callback !== "function") {
    return () => {}
  }

  const handleChange = (event) => {
    if (event.detail?.uid === uid) callback()
  }

  window.addEventListener(PENDING_TRANSACTIONS_CHANGED_EVENT, handleChange)
  return () => window.removeEventListener(PENDING_TRANSACTIONS_CHANGED_EVENT, handleChange)
}
