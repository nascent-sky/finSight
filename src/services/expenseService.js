// src/services/expenseService.js
import { db, auth } from "../firebase"
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
} from "firebase/firestore"

const STORAGE_KEY = 'finsight_expenses_v1'

/**
 * Get all expenses
 * - If user is logged in → fetch from Firestore
 * - If guest → fetch from localStorage
 */
export async function getExpenses() {
  const user = auth.currentUser
  if (user) {
    try {
      const q = query(collection(db, "expenses"), where("userId", "==", user.uid))
      const snapshot = await getDocs(q)
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    } catch (e) {
      console.error("Failed to fetch expenses from Firestore", e)
      return []
    }
  } else {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (e) {
      console.error("Failed to read expenses from localStorage", e)
      return []
    }
  }
}

/**
 * Add a new expense
 * - If user is logged in → save to Firestore
 * - If guest → save to localStorage
 */
export async function addExpense(expense) {
  const user = auth.currentUser
  if (user) {
    try {
      const docRef = await addDoc(collection(db, "expenses"), {
        ...expense,
        userId: user.uid,
        createdAt: new Date(),
      })
      const toAdd = { id: docRef.id, ...expense, userId: user.uid }
      window.dispatchEvent(new CustomEvent('expenseAdded', { detail: { expense: toAdd } }))
      return toAdd
    } catch (e) {
      console.error("Failed to save expense to Firestore", e)
      return null
    }
  } else {
    try {
      const list = await getExpenses() // ✅ await here
      const toAdd = { id: expense.id || Date.now(), ...expense }
      const updated = [toAdd, ...list]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      window.dispatchEvent(new CustomEvent('expenseAdded', { detail: { expense: toAdd } }))
      return toAdd
    } catch (e) {
      console.error("Failed to save expense to localStorage", e)
      return null
    }
  }
}

/**
 * Delete an expense by id
 * - If user is logged in → delete from Firestore
 * - If guest → delete from localStorage
 */
export async function deleteExpense(id) {
  const user = auth.currentUser
  if (user) {
    try {
      await deleteDoc(doc(db, "expenses", id))
      window.dispatchEvent(new CustomEvent('expenseDeleted', { detail: { id } }))
      return await getExpenses()
    } catch (e) {
      console.error("Failed to delete expense from Firestore", e)
      return []
    }
  } else {
    try {
      const list = await getExpenses() // ✅ await here
      const updated = list.filter(e => e.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
      window.dispatchEvent(new CustomEvent('expenseDeleted', { detail: { id } }))
      return updated
    } catch (e) {
      console.error("Failed to delete expense from localStorage", e)
      return []
    }
  }
}

// Default export for easier import
export default {
  getExpenses,
  addExpense,
  deleteExpense,
}