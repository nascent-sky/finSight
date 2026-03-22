// src/pages/Analytics.jsx
import { useState, useEffect } from "react"
import Card from "../components/ui/Card"
import InvestmentSimulator from "../components/common/InvestmentSimulator"
import FinancialGoalPlanner from "../components/common/FinancialGoalPlanner"
import WealthProjectionCalculator from "../components/common/WealthProjectionCalculator"
import expenseService from "../services/expenseService"
import settingsService from "../services/settingsService"
import { BarChart3, PieChart as PieChartIcon } from "lucide-react"

const Analytics = () => {
  const [expenses, setExpenses] = useState([])
  const [monthlyIncome, setMonthlyIncome] = useState(Number(settingsService.getMonthlyIncome()) || 0)
  const [monthlyStats, setMonthlyStats] = useState({
    totalExpenses: 0,
    weeklyBreakdown: {},
    categoryBreakdown: {},
  })

  // Calculate expense analytics
  const calculateStats = (expenseList) => {
    const today = new Date()
    const currentMonth = today.getMonth()
    const currentYear = today.getFullYear()

    // Filter current month expenses
    const monthExpenses = (expenseList || []).filter(exp => {
      const expDate = new Date(exp.date)
      return expDate.getMonth() === currentMonth && expDate.getFullYear() === currentYear
    })

    // Weekly breakdown
    const weeklyBreakdown = {
      'Week 1 (1-7)': 0,
      'Week 2 (8-14)': 0,
      'Week 3 (15-21)': 0,
      'Week 4+ (22+)': 0,
    }

    const categoryBreakdown = {}
    let total = 0

    monthExpenses.forEach(exp => {
      const day = parseInt(exp.date.split('-')[2])
      const amount = Number(exp.amount) || 0

      if (day <= 7) weeklyBreakdown['Week 1 (1-7)'] += amount
      else if (day <= 14) weeklyBreakdown['Week 2 (8-14)'] += amount
      else if (day <= 21) weeklyBreakdown['Week 3 (15-21)'] += amount
      else weeklyBreakdown['Week 4+ (22+)'] += amount

      categoryBreakdown[exp.category || "Other"] = (categoryBreakdown[exp.category] || 0) + amount
      total += amount
    })

    return { totalExpenses: total, weeklyBreakdown, categoryBreakdown }
  }

  // Load expenses and recalc stats
  const loadExpenses = async () => {
    try {
      const stored = await expenseService.getExpenses()
      const expensesArray = Array.isArray(stored) ? stored : []
      setExpenses(expensesArray)
      setMonthlyStats(calculateStats(expensesArray))
    } catch (e) {
      console.error("Failed to load expenses", e)
    }
  }

  useEffect(() => {
    loadExpenses()

    // Handlers
    const handleExpenseAdded = (e) => {
      const { expense } = e.detail || {}
      if (expense) {
        setExpenses(prev => {
          const updated = [expense, ...prev]
          setMonthlyStats(calculateStats(updated))
          return updated
        })
      }
    }

    const handleExpenseDeleted = (e) => {
      const { id } = e.detail || {}
      if (id) {
        setExpenses(prev => {
          const updated = prev.filter(exp => exp.id !== id)
          setMonthlyStats(calculateStats(updated))
          return updated
        })
      }
    }

    const handleSettingsUpdated = (e) => {
      const { settings } = e.detail || {}
      if (settings && settings.monthlyIncome != null) {
        setMonthlyIncome(Number(settings.monthlyIncome))
      }
    }

    window.addEventListener('expenseAdded', handleExpenseAdded)
    window.addEventListener('expenseDeleted', handleExpenseDeleted)
    window.addEventListener('settingsUpdated', handleSettingsUpdated)

    return () => {
      window.removeEventListener('expenseAdded', handleExpenseAdded)
      window.removeEventListener('expenseDeleted', handleExpenseDeleted)
      window.removeEventListener('settingsUpdated', handleSettingsUpdated)
    }
  }, [])

  const leftoverMoney = monthlyIncome - monthlyStats.totalExpenses

  return (
    <div className="space-y-8">

      {/* Page Header */}
      <div className="rounded-2xl bg-linear-to-r from-blue-600 to-indigo-600 p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-white/20 p-2">
            <BarChart3 size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Analytics & Insights</h1>
            <p className="mt-1 opacity-90 text-sm">Track spending patterns and investment growth</p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card padding="lg">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Expenses</p>
            <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              ₹{monthlyStats.totalExpenses.toLocaleString()}
            </h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {monthlyIncome ? ((monthlyStats.totalExpenses / monthlyIncome) * 100).toFixed(1) : 0}% of income
            </p>
          </div>
        </Card>

        <Card padding="lg">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Leftover Money</p>
            <h3 className="mt-2 text-2xl font-bold text-green-600 dark:text-green-400">
              ₹{leftoverMoney.toLocaleString()}
            </h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {monthlyIncome ? ((leftoverMoney / monthlyIncome) * 100).toFixed(1) : 0}% of income
            </p>
          </div>
        </Card>

        <Card padding="lg">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Annual Potential Growth</p>
            <h3 className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
              ₹{(leftoverMoney * 12 * 0.09).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">at 9% ROI</p>
          </div>
        </Card>
      </section>

      {/* Category Breakdown */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card padding="lg" className="lg:col-span-1 bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <PieChartIcon size={20} />
            Category Distribution
          </h3>
          <div className="space-y-3">
            {Object.entries(monthlyStats.categoryBreakdown || {})
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([category, amount], idx) => {
                const percentage = ((amount / (monthlyStats.totalExpenses || 1)) * 100)
                const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-blue-500']
                return (
                  <div key={category || idx}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{category}</span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">{percentage.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${colors[idx % colors.length]}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </Card>

        {/* Weekly Breakdown */}
        <Card padding="lg" className="lg:col-span-2 bg-linear-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <BarChart3 size={20} />
            Weekly Spending Trends
          </h3>
          <div className="space-y-3">
            {Object.entries(monthlyStats.weeklyBreakdown || {}).map(([week, amount], idx) => {
              const percentage = Math.min((amount / Math.max(monthlyStats.totalExpenses, 5000)) * 100, 100)
              return (
                <div key={week || idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{week}</span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">₹{amount.toLocaleString()}</span>
                  </div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-linear-to-r from-blue-500 to-cyan-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </section>

      {/* High-Level Summary */}
      <Card padding="lg" className="bg-linear-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold">Avg Daily</p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              ₹{(monthlyStats.totalExpenses / 30).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold">Avg Weekly</p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              ₹{(monthlyStats.totalExpenses / 4).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold">5-Yr Potential</p>
            <p className="mt-1 text-lg font-bold text-green-600 dark:text-green-400">
              ₹{(leftoverMoney * 12 * Math.pow(1.09, 5)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-600 dark:text-gray-400 uppercase font-semibold">Categories</p>
            <p className="mt-1 text-lg font-bold text-blue-600 dark:text-blue-400">
              {Object.keys(monthlyStats.categoryBreakdown || {}).length}
            </p>
          </div>
        </div>
      </Card>

      {/* Investment & Financial Tools */}
      <InvestmentSimulator leftoverMoney={leftoverMoney} />
      <FinancialGoalPlanner />
      <WealthProjectionCalculator monthlyIncome={monthlyIncome} currentSavings={100000} />

      {/* Smart Insights */}
      <section className="grid gap-4 sm:grid-cols-2">
        <Card padding="lg" className="bg-linear-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
          <div className="flex items-start gap-3">
            <span className="text-3xl">🎯</span>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Wealth Building Strategy</h3>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                With ₹{leftoverMoney.toLocaleString()} monthly savings:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                <li>✓ 1 year: ₹{(leftoverMoney * 12 * 1.09).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</li>
                <li>✓ 5 years: ₹{(leftoverMoney * 12 * Math.pow(1.09, 5)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</li>
                <li>✓ 10 years: ₹{(leftoverMoney * 12 * Math.pow(1.09, 10)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</li>
              </ul>
            </div>
          </div>
        </Card>

        <Card padding="lg" className="bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
          <div className="flex items-start gap-3">
            <span className="text-3xl">🏆</span>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Recommended Action Plan</h3>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">For optimal growth:</p>
              <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                <li>✓ 20% to Emergency Fund</li>
                <li>✓ 30% to Savings Account</li>
                <li>✓ 40% to Investments (SIP)</li>
                <li>✓ 10% to Personal/Leisure</li>
              </ul>
            </div>
          </div>
        </Card>
      </section>

    </div>
  )
}

export default Analytics