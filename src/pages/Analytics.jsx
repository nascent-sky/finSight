import { useEffect, useMemo, useState } from "react"
import { BarChart3 } from "lucide-react"

import Card from "../components/ui/Card"
import CategoryExpenseChart from "../components/analytics/CategoryExpenseChart"
import {
  getMonthKey,
  getMonthLabel,
  getMonthlyExpenseStats,
} from "../components/analytics/expenseChartUtils"
import InvestmentSimulator from "../components/common/InvestmentSimulator"
import FinancialGoalPlanner from "../components/common/FinancialGoalPlanner"
import WealthProjectionCalculator from "../components/common/WealthProjectionCalculator"
import useExpenseTransactions from "../hooks/useExpenseTransactions"
import settingsService from "../services/settingsService"

const Analytics = () => {
  const { transactions, isReady, loadError } = useExpenseTransactions()
  const [selectedMonth, setSelectedMonth] = useState(() => getMonthKey())
  const [monthlyIncome, setMonthlyIncome] = useState(
    Number(settingsService.getMonthlyIncome()) || 0,
  )

  useEffect(() => {
    const handleSettingsUpdated = (event) => {
      const { settings } = event.detail || {}
      if (settings?.monthlyIncome == null) return
      setMonthlyIncome(Number(settings.monthlyIncome) || 0)
    }

    window.addEventListener("settingsUpdated", handleSettingsUpdated)

    return () => {
      window.removeEventListener("settingsUpdated", handleSettingsUpdated)
    }
  }, [])
  const monthlyStats = useMemo(
    () => getMonthlyExpenseStats(transactions, selectedMonth),
    [transactions, selectedMonth],
  )
  const monthLabel = getMonthLabel(selectedMonth)

  const leftoverMoney = monthlyIncome - monthlyStats.totalExpenses

  return (
    <div className="w-full min-w-0 space-y-8">
      <div className="theme-hero rounded-2xl p-6 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-white/20 p-2">
            <BarChart3 size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Analytics & Insights</h1>
            <p className="mt-1 text-sm opacity-90">
              Track spending patterns and investment growth
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="theme-text text-lg font-semibold">Monthly overview</h2>
        <label className="theme-muted-text flex items-center gap-3 text-sm">
          <span>Month</span>
          <input
            type="month"
            value={selectedMonth}
            onChange={(event) => {
              if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) setSelectedMonth(event.target.value)
            }}
            className="theme-input min-w-0 rounded-lg border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card padding="lg">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Expenses</p>
            <h3 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
              Rs {monthlyStats.totalExpenses.toLocaleString()}
            </h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {monthlyIncome
                ? ((monthlyStats.totalExpenses / monthlyIncome) * 100).toFixed(1)
                : 0}
              % of income
            </p>
          </div>
        </Card>

        <Card padding="lg">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">Leftover Money</p>
            <h3 className="mt-2 text-2xl font-bold text-green-600 dark:text-green-400">
              Rs {leftoverMoney.toLocaleString()}
            </h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              {monthlyIncome ? ((leftoverMoney / monthlyIncome) * 100).toFixed(1) : 0}% of
              income
            </p>
          </div>
        </Card>

        <Card padding="lg">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Annual Potential Growth
            </p>
            <h3 className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
              Rs {(leftoverMoney * 12 * 0.09).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </h3>
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">at 9% ROI</p>
          </div>
        </Card>
      </section>

      <section className="space-y-4">
        <CategoryExpenseChart
          key={`${selectedMonth}:${isReady}:${monthlyStats.categories.length > 0}`}
          categories={monthlyStats.categories}
          totalExpenses={monthlyStats.totalExpenses}
          monthLabel={monthLabel}
          isReady={isReady}
          loadError={loadError}
        />

        <Card
          padding="lg"
          className="bg-linear-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20"
        >
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
            <BarChart3 size={20} />
            Weekly Spending Trends
          </h3>
          <div className="space-y-3">
            {Object.entries(monthlyStats.weeklyBreakdown || {}).map(([week, amount], index) => {
              const percentage = Math.min(
                (amount / Math.max(monthlyStats.totalExpenses, 5000)) * 100,
                100,
              )

              return (
                <div key={week || index}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {week}
                    </span>
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      Rs {amount.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
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

      <Card
        padding="lg"
        className="bg-linear-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20"
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
              Avg Daily
            </p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              Rs {(monthlyStats.totalExpenses / 30).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
              Avg Weekly
            </p>
            <p className="mt-1 text-lg font-bold text-gray-900 dark:text-white">
              Rs {(monthlyStats.totalExpenses / 4).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
              5-Yr Potential
            </p>
            <p className="mt-1 text-lg font-bold text-green-600 dark:text-green-400">
              Rs {(leftoverMoney * 12 * Math.pow(1.09, 5)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase text-gray-600 dark:text-gray-400">
              Categories
            </p>
            <p className="mt-1 text-lg font-bold text-blue-600 dark:text-blue-400">
              {monthlyStats.categories.length}
            </p>
          </div>
        </div>
      </Card>

      <InvestmentSimulator leftoverMoney={leftoverMoney} />
      <FinancialGoalPlanner />
      <WealthProjectionCalculator monthlyIncome={monthlyIncome} currentSavings={100000} />

      <section className="grid gap-4 sm:grid-cols-2">
        <Card
          padding="lg"
          className="bg-linear-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20"
        >
          <div className="flex items-start gap-3">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Wealth Building Strategy
              </h3>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                With Rs {leftoverMoney.toLocaleString()} monthly savings:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                <li>1 year: Rs {(leftoverMoney * 12 * 1.09).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</li>
                <li>5 years: Rs {(leftoverMoney * 12 * Math.pow(1.09, 5)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</li>
                <li>10 years: Rs {(leftoverMoney * 12 * Math.pow(1.09, 10)).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</li>
              </ul>
            </div>
          </div>
        </Card>

        <Card
          padding="lg"
          className="bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20"
        >
          <div className="flex items-start gap-3">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Recommended Action Plan
              </h3>
              <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                For optimal growth:
              </p>
              <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                <li>20% to Emergency Fund</li>
                <li>30% to Savings Account</li>
                <li>40% to Investments (SIP)</li>
                <li>10% to Personal/Leisure</li>
              </ul>
            </div>
          </div>
        </Card>
      </section>
    </div>
  )
}

export default Analytics
