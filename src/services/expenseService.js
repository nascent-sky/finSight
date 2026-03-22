// Lightweight expense persistence using localStorage
const STORAGE_KEY = 'finsight_expenses_v1'

function getExpenses() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to read expenses from localStorage', e)
    return []
  }
}

function saveExpenses(expenses) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses))
    // Emit a global event so other components can react
    window.dispatchEvent(new CustomEvent('expensesUpdated', { detail: { expenses } }))
  } catch (e) {
    console.error('Failed to save expenses to localStorage', e)
  }
}

function addExpense(expense) {
  const list = getExpenses()
  const toAdd = { id: expense.id || Date.now(), ...expense }
  const updated = [toAdd, ...list]
  saveExpenses(updated)
  // emit a specific event for just the added expense
  window.dispatchEvent(new CustomEvent('expenseAdded', { detail: { expense: toAdd } }))
  return toAdd
}

function deleteExpense(id) {
  const list = getExpenses()
  const updated = list.filter((e) => e.id !== id)
  saveExpenses(updated)
  window.dispatchEvent(new CustomEvent('expenseDeleted', { detail: { id } }))
  return updated
}

export default {
  getExpenses,
  saveExpenses,
  addExpense,
  deleteExpense,
}
