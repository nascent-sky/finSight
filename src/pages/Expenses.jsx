import { useState, useEffect } from "react"
import Card from "../components/ui/Card"
import Input from "../components/ui/Input"
import Button from "../components/ui/Button"
import SmartExpenseAnalyzer from "../components/common/SmartExpenseAnalyzer"
import VoiceRecorder from "../components/common/VoiceRecorder"
import expenseService from "../services/expenseService"
import { Trash2 } from 'lucide-react'
import { ToastContainer } from "../components/common/Toast"
import { Search, Filter, Plus } from "lucide-react"

const Expenses = () => {
  const [expenses, setExpenses] = useState([
    { id: 101, category: "Food & Dining", amount: 350, note: "Lunch at Starbucks", date: "2026-02-08" },
    { id: 102, category: "Transport", amount: 250, note: "Uber ride to office", date: "2026-02-08" },
    { id: 103, category: "Entertainment", amount: 500, note: "Movie tickets", date: "2026-02-07" },
    { id: 104, category: "Shopping", amount: 1200, note: "Online shopping clothes", date: "2026-02-07" },
    { id: 105, category: "Utilities", amount: 800, note: "Electricity bill", date: "2026-02-06" },
    { id: 106, category: "Food & Dining", amount: 450, note: "Dinner at restaurant", date: "2026-02-06" },
    { id: 107, category: "Subscription", amount: 199, note: "Netflix monthly", date: "2026-02-05" },
    { id: 108, category: "Healthcare", amount: 500, note: "Doctor visit", date: "2026-02-05" },
  ])

  const [searchTerm, setSearchTerm] = useState("")
  const [selectedCategory, setSelectedCategory] = useState("All")

  const categories = ["All", "Food & Dining", "Entertainment", "Shopping", "Utilities", "Transport", "Subscription", "Healthcare"]

  const filteredExpenses = expenses.filter((expense) => {
    const matchesSearch =
      expense.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      expense.note.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesCategory = selectedCategory === "All" || expense.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  const categoryExpenses = categories
    .filter((cat) => cat !== "All")
    .map((cat) => {
      const total = expenses
        .filter((exp) => exp.category === cat)
        .reduce((sum, exp) => sum + exp.amount, 0)
      return {
        category: cat,
        amount: total,
        percentage: (total / expenses.reduce((sum, exp) => sum + exp.amount, 0)) * 100,
      }
    })

  const handleVoiceExpenseDetected = (newExpense) => {
    const added = expenseService.addExpense({
      amount: newExpense.amount,
      category: newExpense.category,
      note: newExpense.note || newExpense.merchant || 'Voice input',
      date: newExpense.date || new Date().toISOString().split('T')[0],
      merchant: newExpense.merchant,
    })
    setExpenses((prev) => [added, ...prev])
  }

  useEffect(() => {
    // Load persisted expenses on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const loaded = expenseService.getExpenses()
    if (loaded && loaded.length > 0) {
      setExpenses(loaded)
    }
  }, [])

  useEffect(() => {
    // Listen for global events from quick-add widget or other components
    const onExpenseAdded = (e) => {
      const { expense } = e.detail || {}
      if (expense) setExpenses((prev) => [expense, ...prev])
    }

    const onExpensesUpdated = (e) => {
      const { expenses: updated } = e.detail || {}
      if (updated) setExpenses(updated)
    }

    const onExpenseDeleted = (e) => {
      const { id } = e.detail || {}
      if (id) setExpenses((prev) => prev.filter((ex) => ex.id !== id))
    }

    window.addEventListener('expenseAdded', onExpenseAdded)
    window.addEventListener('expensesUpdated', onExpensesUpdated)
    window.addEventListener('expenseDeleted', onExpenseDeleted)

    return () => {
      window.removeEventListener('expenseAdded', onExpenseAdded)
      window.removeEventListener('expensesUpdated', onExpensesUpdated)
      window.removeEventListener('expenseDeleted', onExpenseDeleted)
    }
  }, [])

  const handleQuickAdd = async () => {
    // Simple quick-add using prompts to avoid large UI changes; easy to replace with modal later
    const amountRaw = window.prompt('Enter amount (numbers only)')
    if (!amountRaw) return
    const amount = parseFloat(amountRaw.replace(/[^0-9.]/g, ''))
    if (isNaN(amount) || amount <= 0) return alert('Invalid amount')
    const category = window.prompt('Category (e.g. Food & Dining)', 'Food & Dining') || 'Other'
    const note = window.prompt('Note (optional)', '') || ''

    const added = expenseService.addExpense({
      amount,
      category,
      note,
      date: new Date().toISOString().split('T')[0],
    })
    setExpenses((prev) => [added, ...prev])
  }

  const handleDelete = (id) => {
    if (!confirm('Delete this expense?')) return
    expenseService.deleteExpense(id)
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div className="space-y-6">
      <ToastContainer />
      
      {/* Page Header */}
      <div className="rounded-2xl bg-linear-to-r from-emerald-600 to-teal-600 p-6 text-white shadow-lg">
        <h1 className="text-3xl font-bold">Expenses</h1>
        <p className="mt-2 opacity-90">
          View, manage, and optimize your spending patterns
        </p>
      </div>

      {/* Voice Recorder */}
      <VoiceRecorder onExpenseDetected={handleVoiceExpenseDetected} />

      {/* Smart Expense Analyzer */}
      <SmartExpenseAnalyzer expenses={categoryExpenses} />

      {/* Expense Management Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Recent Transactions
          </h2>
          <Button onClick={handleQuickAdd} className="flex items-center gap-2">
            <Plus size={16} />
            Add Expense
          </Button>
        </div>

        {/* Filters */}
        <Card padding="lg">
          <div className="space-y-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Search
                </label>
                <div className="relative">
                  <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    placeholder="Search by category or note"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>

            {/* Category Chips */}
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    selectedCategory === cat
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Expense List */}
        <section className="space-y-2">
          {filteredExpenses.length > 0 ? (
            filteredExpenses.map((expense) => (
              <Card
                key={expense.id}
                padding="md"
                className="hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="text-2xl">
                      {expense.category === "Food & Dining"
                        ? "🍽️"
                        : expense.category === "Entertainment"
                        ? "🎬"
                        : expense.category === "Shopping"
                        ? "🛍️"
                        : expense.category === "Utilities"
                        ? "💡"
                        : expense.category === "Transport"
                        ? "🚗"
                        : expense.category === "Subscription"
                        ? "📱"
                        : expense.category === "Healthcare"
                        ? "🏥"
                        : "📦"}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {expense.category}
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {expense.note} • {new Date(expense.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                    <div className="text-right flex items-center gap-3">
                      <p className="font-bold text-red-500 dark:text-red-400">
                        - ₹{expense.amount.toLocaleString()}
                      </p>
                      <button
                        onClick={() => handleDelete(expense.id)}
                        title="Delete expense"
                        className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                </div>
              </Card>
            ))
          ) : (
            <Card padding="lg" className="text-center">
              <p className="text-gray-500 dark:text-gray-400">
                No expenses found matching your filters
              </p>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}

export default Expenses
