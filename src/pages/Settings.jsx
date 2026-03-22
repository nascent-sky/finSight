import { useEffect, useState } from "react"
import { DollarSign, Download, Lightbulb, User } from "lucide-react"

import Card from "../components/ui/Card"
import Button from "../components/ui/Button"
import Input from "../components/ui/Input"
import settingsService from "../services/settingsService"
import { EXPENSES_CHANGED_EVENT, getGuestExpenses } from "../services/dataService"

const Settings = () => {
  const initialSettings = settingsService.getSettings()
  const [monthlyIncome, setMonthlyIncome] = useState(initialSettings.monthlyIncome)
  const [riskTolerance, setRiskTolerance] = useState(initialSettings.riskTolerance)
  const [isSaved, setIsSaved] = useState(false)
  const [guestExpenseCount, setGuestExpenseCount] = useState(() => getGuestExpenses().length)

  useEffect(() => {
    const refreshGuestExpenseCount = () => {
      setGuestExpenseCount(getGuestExpenses().length)
    }

    window.addEventListener(EXPENSES_CHANGED_EVENT, refreshGuestExpenseCount)

    return () => {
      window.removeEventListener(EXPENSES_CHANGED_EVENT, refreshGuestExpenseCount)
    }
  }, [])

  const handleSaveIncome = () => {
    if (monthlyIncome && monthlyIncome > 0) {
      settingsService.updateSettings({ monthlyIncome })
      setIsSaved(true)
      setTimeout(() => setIsSaved(false), 3000)
    }
  }

  const handleSaveRiskTolerance = () => {
    settingsService.updateSettings({ riskTolerance })
    setIsSaved(true)
    setTimeout(() => setIsSaved(false), 3000)
  }

  const downloadFile = (filename, content, mimeType) => {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const buildGuestExpenseCsv = (expenses) => {
    const headers = [
      "id",
      "date",
      "category",
      "amount",
      "note",
      "merchant",
      "createdAt",
      "updatedAt",
      "timestamp",
    ]
    const escapeValue = (value) => `"${String(value ?? "").replace(/"/g, "\"\"")}"`

    return [
      headers.join(","),
      ...expenses.map((expense) =>
        headers.map((header) => escapeValue(expense[header])).join(","),
      ),
    ].join("\n")
  }

  const handleExport = (format) => {
    const guestExpenses = getGuestExpenses()
    if (!guestExpenses.length) return

    const dateStamp = new Date().toISOString().slice(0, 10)

    if (format === "json") {
      downloadFile(
        `finsight-guest-expenses-${dateStamp}.json`,
        JSON.stringify(guestExpenses, null, 2),
        "application/json",
      )
      return
    }

    downloadFile(
      `finsight-guest-expenses-${dateStamp}.csv`,
      buildGuestExpenseCsv(guestExpenses),
      "text/csv;charset=utf-8",
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-linear-to-r from-indigo-600 to-purple-600 p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-white/20 p-2">
            <User size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Settings & Profile</h1>
            <p className="mt-1 text-sm opacity-90">Configure your financial profile</p>
          </div>
        </div>
      </div>

      {isSaved ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
          Settings saved successfully!
        </div>
      ) : null}

      <Card
        padding="lg"
        className="border-2 border-green-200 bg-linear-to-br from-green-50 to-emerald-50 dark:border-green-800 dark:from-green-900/20 dark:to-emerald-900/20"
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-full bg-green-100 p-3 dark:bg-green-900/30">
            <DollarSign size={24} className="text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
              Monthly Income
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Set your monthly income. This helps FinSight calculate your leftover
              money and investment recommendations.
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Total Monthly Income (Rs)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={monthlyIncome}
                    onChange={(event) =>
                      setMonthlyIncome(parseInt(event.target.value, 10) || 0)
                    }
                    placeholder="45000"
                    className="flex-1"
                  />
                  <Button onClick={handleSaveIncome} className="px-6">
                    Save
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Your current monthly income: Rs {monthlyIncome.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        padding="lg"
        className="border-2 border-blue-200 bg-linear-to-br from-blue-50 to-indigo-50 dark:border-blue-800 dark:from-blue-900/20 dark:to-indigo-900/20"
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-full bg-blue-100 p-3 dark:bg-blue-900/30">
            <Lightbulb size={24} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h2 className="mb-4 text-xl font-semibold text-gray-900 dark:text-white">
              Investment Risk Profile
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Choose your investment risk tolerance. This determines which investment
              recommendations you receive.
            </p>
            <div className="space-y-3">
              {[
                {
                  value: "low",
                  label: "Conservative (Low Risk)",
                  description: "Safety first - Fixed deposits, bonds, savings accounts",
                },
                {
                  value: "medium",
                  label: "Balanced (Medium Risk)",
                  description: "Mix of stability and growth - Mutual funds, index funds, FDs",
                },
                {
                  value: "high",
                  label: "Aggressive (High Risk)",
                  description: "Growth focused - Stocks, growth funds, crypto",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center rounded-lg border-2 p-3 transition-all"
                  style={{
                    borderColor: riskTolerance === option.value ? "#3b82f6" : "#e5e7eb",
                    backgroundColor: riskTolerance === option.value ? "#eff6ff" : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="risk"
                    value={option.value}
                    checked={riskTolerance === option.value}
                    onChange={(event) => setRiskTolerance(event.target.value)}
                    className="h-4 w-4"
                  />
                  <div className="ml-3 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">{option.label}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {option.description}
                    </p>
                  </div>
                </label>
              ))}
              <Button onClick={handleSaveRiskTolerance} className="mt-4 w-full">
                Save Risk Profile
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        padding="lg"
        className="bg-linear-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20"
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-full bg-amber-100 p-3 dark:bg-amber-900/30">
            <Download size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
              Guest Data Backup
            </h2>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              Export guest-mode expenses before switching accounts or for your own backup.
            </p>
            <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
              Guest expenses available: {guestExpenseCount}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => handleExport("json")}
                disabled={guestExpenseCount === 0}
              >
                Export JSON
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleExport("csv")}
                disabled={guestExpenseCount === 0}
              >
                Export CSV
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="lg" className="bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
        <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">How Income is Used</h3>
        <div className="grid gap-3">
          <div className="flex items-center gap-3 p-2">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Monthly Income</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Your total earnings per month
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Expenses Tracking</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Calculates what percentage of income you spend
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">AI Recommendations</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Suggests how to invest your leftover money
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Savings Goal</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Helps track if you are meeting goals
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="lg">
        <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Example Calculation</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Monthly Income:</span>
            <span className="font-semibold">Rs {monthlyIncome.toLocaleString()}</span>
          </div>
          <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Total Expenses (example):</span>
            <span>Rs 15,000</span>
          </div>
          <div className="flex justify-between font-semibold text-green-600 dark:text-green-400">
            <span>Leftover Money:</span>
            <span>Rs {(monthlyIncome - 15000).toLocaleString()}</span>
          </div>
          <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
          <p className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            Your leftover money will be allocated based on your{" "}
            <strong>{riskTolerance}</strong> risk profile.
          </p>
        </div>
      </Card>
    </div>
  )
}

export default Settings
