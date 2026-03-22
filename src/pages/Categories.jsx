import { useState, useEffect } from "react"
import { Plus, Trash2 } from "lucide-react"

import Card from "../components/ui/Card"
import Button from "../components/ui/Button"
import Input from "../components/ui/Input"
import Modal from "../components/ui/Modal"
import expenseService from "../services/expenseService"

const initialCategories = [
  { id: 1, name: "Food & Dining", emoji: "🍽️" },
  { id: 2, name: "Transport", emoji: "🚗" },
  { id: 3, name: "Shopping", emoji: "🛍️" },
  { id: 4, name: "Utilities", emoji: "💡" },
  { id: 5, name: "Entertainment", emoji: "🎬" },
  { id: 6, name: "Healthcare", emoji: "🏥" },
  { id: 7, name: "Subscription", emoji: "📱" },
  { id: 8, name: "Other", emoji: "📦" },
]

const Categories = () => {
  const [categories, setCategories] = useState(initialCategories)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newCategory, setNewCategory] = useState({ name: "", emoji: "📦" })
  const [expenses, setExpenses] = useState([])

  // Calculate actual spending per category
  const getCategorySpending = (categoryName) => {
    return expenses
      .filter((exp) => exp.category === categoryName)
      .reduce((sum, exp) => sum + exp.amount, 0)
  }

  const handleAddCategory = () => {
    if (newCategory.name) {
      setCategories([
        ...categories,
        {
          id: Math.max(...categories.map((c) => c.id), 0) + 1,
          name: newCategory.name,
          emoji: newCategory.emoji || "📦",
        },
      ])
      setNewCategory({ name: "", emoji: "📦" })
      setIsModalOpen(false)
    }
  }

  const handleDeleteCategory = (id) => {
    setCategories(categories.filter((c) => c.id !== id))
  }

  // Load expenses and listen for changes
  useEffect(() => {
    const loadExpenses = () => {
      const stored = expenseService.getExpenses()
      setExpenses(stored)
    }

    loadExpenses()

    const handleExpenseAdded = (e) => {
      const { expense } = e.detail || {}
      if (expense) {
        setExpenses(prev => [expense, ...prev])
      }
    }

    const handleExpenseDeleted = (e) => {
      const { id } = e.detail || {}
      if (id) {
        setExpenses(prev => prev.filter(ex => ex.id !== id))
      }
    }

    window.addEventListener('expenseAdded', handleExpenseAdded)
    window.addEventListener('expenseDeleted', handleExpenseDeleted)

    return () => {
      window.removeEventListener('expenseAdded', handleExpenseAdded)
      window.removeEventListener('expenseDeleted', handleExpenseDeleted)
    }
  }, [])

  return (
    <div className="space-y-6">
      
      {/* Page Header */}
      <div className="rounded-2xl bg-linear-to-r from-pink-600 to-rose-600 p-6 text-white shadow-lg">
        <h1 className="text-3xl font-bold">Expense Categories</h1>
        <p className="mt-2 opacity-90 text-sm">
          Track your spending across categories
        </p>
      </div>

      {/* Categories Grid */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Your Categories
          </h2>
          <Button
            size="sm"
            className="flex items-center gap-2 w-full sm:w-auto"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} />
            Add Category
          </Button>
        </div>

        {/* Category Grid - Responsive */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const spending = getCategorySpending(category.name)

            return (
              <Card key={category.id} padding="lg" className="hover:shadow-lg transition-shadow">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-3xl">{category.emoji}</span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                          {category.name}
                        </h3>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteCategory(category.id)}
                      className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {/* Spending Info */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Spent</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        ₹{spending.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </section>

      {/* Add Category Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Add New Category"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Category Name
            </label>
            <Input
              placeholder="e.g., Education"
              value={newCategory.name}
              onChange={(e) =>
                setNewCategory({ ...newCategory, name: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Emoji (optional)
            </label>
            <Input
              placeholder="e.g., 📚"
              value={newCategory.emoji}
              maxLength={2}
              onChange={(e) =>
                setNewCategory({ ...newCategory, emoji: e.target.value })
              }
            />
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button onClick={handleAddCategory} className="flex-1">
              Add Category
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default Categories
