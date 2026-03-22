import { useState, useEffect } from "react"
import Card from "../components/ui/Card"
import Button from "../components/ui/Button"
import Input from "../components/ui/Input"
import settingsService from "../services/settingsService"
import { DollarSign, User, Lightbulb } from "lucide-react"

const Settings = () => {
  const [monthlyIncome, setMonthlyIncome] = useState(45000)
  const [riskTolerance, setRiskTolerance] = useState("medium")
  const [isSaved, setIsSaved] = useState(false)

  // Load settings on mount
  useEffect(() => {
    const settings = settingsService.getSettings()
    setMonthlyIncome(settings.monthlyIncome)
    setRiskTolerance(settings.riskTolerance)
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl bg-linear-to-r from-indigo-600 to-purple-600 p-6 text-white shadow-lg">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-white/20 p-2">
            <User size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Settings & Profile</h1>
            <p className="mt-1 opacity-90 text-sm">Configure your financial profile</p>
          </div>
        </div>
      </div>

      {/* Success Message */}
      {isSaved && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          ✅ Settings saved successfully!
        </div>
      )}

      {/* Monthly Income Settings */}
      <Card padding="lg" className="bg-linear-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-2 border-green-200 dark:border-green-800">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3 shrink-0">
            <DollarSign size={24} className="text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Monthly Income
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Set your monthly income. This helps FinSight calculate your leftover money and investment recommendations.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Total Monthly Income (₹)
                </label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={monthlyIncome}
                    onChange={(e) => setMonthlyIncome(parseInt(e.target.value) || 0)}
                    placeholder="45000"
                    className="flex-1"
                  />
                  <Button onClick={handleSaveIncome} className="px-6">
                    Save
                  </Button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  💡 Your current monthly income: ₹{monthlyIncome.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Risk Tolerance Settings */}
      <Card padding="lg" className="bg-linear-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-2 border-blue-200 dark:border-blue-800">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-3 shrink-0">
            <Lightbulb size={24} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Investment Risk Profile
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Choose your investment risk tolerance. This determines which investment recommendations you receive.
            </p>
            <div className="space-y-3">
              {[
                {
                  value: "low",
                  label: "🛡️ Conservative (Low Risk)",
                  description: "Safety first - Fixed deposits, bonds, savings accounts",
                },
                {
                  value: "medium",
                  label: "⚖️ Balanced (Medium Risk)",
                  description: "Mix of stability and growth - Mutual funds, index funds, FDs",
                },
                {
                  value: "high",
                  label: "🚀 Aggressive (High Risk)",
                  description: "Growth focused - Stocks, growth funds, crypto",
                },
              ].map((option) => (
                <label key={option.value} className="flex items-center p-3 border-2 rounded-lg cursor-pointer transition-all" style={{
                  borderColor: riskTolerance === option.value ? '#3b82f6' : '#e5e7eb',
                  backgroundColor: riskTolerance === option.value ? '#eff6ff' : 'transparent',
                }}>
                  <input
                    type="radio"
                    name="risk"
                    value={option.value}
                    checked={riskTolerance === option.value}
                    onChange={(e) => setRiskTolerance(e.target.value)}
                    className="w-4 h-4"
                  />
                  <div className="ml-3 flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">{option.label}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">{option.description}</p>
                  </div>
                </label>
              ))}
              <Button onClick={handleSaveRiskTolerance} className="w-full mt-4">
                Save Risk Profile
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Income Breakdown Guide */}
      <Card padding="lg" className="bg-linear-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
          📊 How Income is Used
        </h3>
        <div className="grid gap-3">
          <div className="flex items-center gap-3 p-2">
            <span className="text-2xl">💰</span>
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">Monthly Income</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Your total earnings per month</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2">
            <span className="text-2xl">📊</span>
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">Expenses Tracking</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Calculates what % of income you spend</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2">
            <span className="text-2xl">💡</span>
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">AI Recommendations</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Suggests how to invest your leftover money</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-2">
            <span className="text-2xl">📈</span>
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">Savings Goal</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Helps track if you're meeting goals</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Example Calculation */}
      <Card padding="lg">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-3">
          📋 Example Calculation
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Monthly Income:</span>
            <span className="font-semibold">₹{monthlyIncome.toLocaleString()}</span>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
          <div className="flex justify-between text-gray-600 dark:text-gray-400">
            <span>Total Expenses (example):</span>
            <span>₹15,000</span>
          </div>
          <div className="flex justify-between text-green-600 dark:text-green-400 font-semibold">
            <span>Leftover Money:</span>
            <span>₹{(monthlyIncome - 15000).toLocaleString()}</span>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-3">
            ✅ Your leftover money will be allocated based on your <strong>{riskTolerance}</strong> risk profile
          </p>
        </div>
      </Card>
    </div>
  )
}

export default Settings
