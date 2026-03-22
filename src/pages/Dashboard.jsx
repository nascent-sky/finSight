// src/pages/Dashboard.jsx
import { useState, useEffect } from "react"
import Card from "../components/ui/Card"
import Button from "../components/ui/Button"
import AISuggestions from "../components/common/AISuggestions"
import SmartAIAdvisor from "../components/common/SmartAIAdvisor"
import LifestyleExpenseTracker from "../components/common/LifestyleExpenseTracker"
import QuickAddExpenseModal from "../components/common/QuickAddExpenseModal"
import expenseService from "../services/expenseService"
import settingsService from "../services/settingsService"
import { ArrowUpRight, ArrowDownRight, Plus, TrendingUp, PieChart } from "lucide-react"
import { auth } from "../firebase"

const Dashboard = () => {
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false)
  const [recentExpenses, setRecentExpenses] = useState([])
  const [financialData, setFinancialData] = useState({
    monthlyIncome: settingsService.getMonthlyIncome(),
    totalExpenses: 0,
    expenses: [],
    savingsGoal: 5000,
    riskTolerance: settingsService.getSettings().riskTolerance,
  })

  const leftoverMoney = financialData.monthlyIncome - financialData.totalExpenses
  const savingsRate = ((leftoverMoney / financialData.monthlyIncome) * 100).toFixed(1)

  // Load expenses and settings
  const loadData = async () => {
    try {
      const stored = await expenseService.getExpenses()
      const settings = settingsService.getSettings()
      const expensesArray = Array.isArray(stored) ? stored : []

      setFinancialData(prev => ({
        ...prev,
        monthlyIncome: settings.monthlyIncome,
        riskTolerance: settings.riskTolerance,
        expenses: expensesArray,
        totalExpenses: expensesArray.reduce((sum, e) => sum + (e.amount || 0), 0),
      }))

      setRecentExpenses(expensesArray.slice(0, 5))
    } catch (err) {
      console.error("Failed to load expenses:", err)
    }
  }

  useEffect(() => {
    loadData()

    const unsubscribe = auth.onAuthStateChanged(() => {
      loadData()
    })

    // Listen for global expense changes
    const handleExpenseAdded = (e) => {
      const { expense } = e.detail || {}
      if (!expense) return
      setFinancialData(prev => ({
        ...prev,
        expenses: [expense, ...prev.expenses],
        totalExpenses: prev.totalExpenses + (expense.amount || 0),
      }))
      setRecentExpenses(prev => [expense, ...prev].slice(0, 5))
    }

    const handleExpenseDeleted = (e) => {
      const { id } = e.detail || {}
      if (!id) return
      setFinancialData(prev => {
        const deleted = prev.expenses.find(ex => ex.id === id)
        const newExpenses = prev.expenses.filter(ex => ex.id !== id)
        return {
          ...prev,
          expenses: newExpenses,
          totalExpenses: prev.totalExpenses - (deleted?.amount || 0),
        }
      })
      setRecentExpenses(prev => prev.filter(ex => ex.id !== id))
    }

    const handleSettingsUpdated = (e) => {
      const { settings } = e.detail || {}
      if (settings) {
        setFinancialData(prev => ({
          ...prev,
          monthlyIncome: settings.monthlyIncome,
          riskTolerance: settings.riskTolerance,
        }))
      }
    }

    window.addEventListener('expenseAdded', handleExpenseAdded)
    window.addEventListener('expenseDeleted', handleExpenseDeleted)
    window.addEventListener('settingsUpdated', handleSettingsUpdated)

    return () => {
      unsubscribe()
      window.removeEventListener('expenseAdded', handleExpenseAdded)
      window.removeEventListener('expenseDeleted', handleExpenseDeleted)
      window.removeEventListener('settingsUpdated', handleSettingsUpdated)
    }
  }, [])

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="rounded-2xl bg-linear-to-r from-indigo-600 to-purple-600 p-6 text-white shadow-lg">
        <h1 className="text-3xl font-bold">Welcome Back! 👋</h1>
        <p className="mt-2 opacity-90">
          You have ₹{leftoverMoney.toLocaleString()} leftover this month. Let AI help you make smart decisions!
        </p>
      </div>

      {/* Summary Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Income */}
        <Card padding="lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Income</p>
              <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
                ₹{financialData.monthlyIncome.toLocaleString()}
              </h3>
            </div>
            <div className="rounded-full bg-green-100 p-3 text-green-600 dark:bg-green-900/30 dark:text-green-400">
              <ArrowUpRight size={24} />
            </div>
          </div>
        </Card>

        {/* Total Expenses */}
        <Card padding="lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Total Expenses</p>
              <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
                ₹{financialData.totalExpenses.toLocaleString()}
              </h3>
            </div>
            <div className="rounded-full bg-red-100 p-3 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              <ArrowDownRight size={24} />
            </div>
          </div>
        </Card>

        {/* Leftover Money */}
        <Card padding="lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Leftover Money</p>
              <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
                ₹{leftoverMoney.toLocaleString()}
              </h3>
            </div>
            <div className="rounded-full bg-indigo-100 p-3 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
              <TrendingUp size={24} />
            </div>
          </div>
        </Card>

        {/* Savings Rate */}
        <Card padding="lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Savings Rate</p>
              <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
                {savingsRate}%
              </h3>
            </div>
            <div className="rounded-full bg-purple-100 p-3 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
              <PieChart size={24} />
            </div>
          </div>
        </Card>
      </section>

      {/* Quick Actions */}
      <section className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setIsAddExpenseOpen(true)} className="flex items-center gap-2">
          <Plus size={16} />
          Add Expense
        </Button>
        <Button variant="secondary">View Analytics</Button>
        <Button variant="secondary">Set Goals</Button>
      </section>

      {/* AI Suggestions */}
      <AISuggestions financialData={financialData} />

      {/* Smart AI Advisor */}
      <SmartAIAdvisor
        leftoverMoney={leftoverMoney}
        riskTolerance={financialData.riskTolerance}
        expenses={financialData.expenses}
      />

      {/* Recent Expenses */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Expenses</h2>
          <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300">
            View all
          </button>
        </div>

        <div className="space-y-2">
          {recentExpenses.length > 0 ? (
            recentExpenses.map((expense) => (
              <Card key={expense.id} padding="sm" className="hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">{expense.category}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {expense.note} • {new Date(expense.date).toLocaleDateString()}
                    </p>
                  </div>
                  <p className="font-semibold text-red-500 dark:text-red-400">
                    - ₹{expense.amount?.toLocaleString() ?? 0}
                  </p>
                </div>
              </Card>
            ))
          ) : (
            <Card padding="sm" className="text-center text-gray-500">
              <p>No expenses yet. Add one to get started!</p>
            </Card>
          )}
        </div>
      </section>

      {/* Lifestyle Tracker */}
      <LifestyleExpenseTracker />

      {/* Quick Add Modal */}
      <QuickAddExpenseModal
        isOpen={isAddExpenseOpen}
        onClose={() => setIsAddExpenseOpen(false)}
        onExpenseAdded={(expense) => {
          if (!expense) return
          setFinancialData(prev => ({
            ...prev,
            expenses: [expense, ...prev.expenses],
            totalExpenses: prev.totalExpenses + (expense.amount || 0),
          }))
          setRecentExpenses(prev => [expense, ...prev].slice(0, 5))
        }}
      />
    </div>
  )
}

export default Dashboard