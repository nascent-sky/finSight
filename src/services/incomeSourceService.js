import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore"

import { auth, db } from "../firebase"

const requireUser = () => {
  const user = auth.currentUser

  if (!user?.uid) {
    throw new Error("A logged-in user is required to manage income sources.")
  }

  return user
}

export const normalizeIncomeSourcePerson = (person) =>
  String(person ?? "").trim().toLowerCase()

export const isIncomeSource = (person, incomeSources) => {
  const normalizedPerson = normalizeIncomeSourcePerson(person)

  return (
    normalizedPerson !== "" &&
    incomeSources.some(
      (incomeSource) => normalizeIncomeSourcePerson(incomeSource.person) === normalizedPerson,
    )
  )
}

export const rememberIncomeSource = async (person) => {
  const user = requireUser()
  const normalizedPerson = normalizeIncomeSourcePerson(person)

  if (!normalizedPerson) {
    throw new Error("An income source must have a person name.")
  }

  const sourceId = encodeURIComponent(normalizedPerson)
  await setDoc(doc(db, "users", user.uid, "incomeSources", sourceId), {
    person: normalizedPerson,
  })

  return { id: sourceId, person: normalizedPerson }
}

export const removeIncomeSource = async (person) => {
  const user = requireUser()
  const normalizedPerson = normalizeIncomeSourcePerson(person)

  if (!normalizedPerson) {
    throw new Error("An income source must have a person name.")
  }

  const sourceId = encodeURIComponent(normalizedPerson)
  await deleteDoc(doc(db, "users", user.uid, "incomeSources", sourceId))

  return { id: sourceId, person: normalizedPerson }
}

export const subscribeToIncomeSources = (callback, errorCallback) => {
  const user = requireUser()

  return onSnapshot(
    collection(db, "users", user.uid, "incomeSources"),
    (snapshot) => {
      callback(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })))
    },
    errorCallback,
  )
}
