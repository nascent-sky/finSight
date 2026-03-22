// src/pages/AddExpense.jsx
import { useState } from "react"
import { Mic, MicOff } from "lucide-react"
import Card from "../components/ui/Card"
import Input from "../components/ui/Input"
import Button from "../components/ui/Button"
import expenseService from "../services/expenseService"

const categories = [
  "Food & Dining",
  "Transport",
  "Shopping",
  "Bills",
  "Entertainment",
  "Health",
]

const AddExpense = () => {
  const [amount, setAmount] = useState("")
  const [selectedCategory, setSelectedCategory] = useState(categories[0])
  const [note, setNote] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [isListening, setIsListening] = useState(false)
  const [saving, setSaving] = useState(false)

  // Save expense to Firestore or localStorage
  const handleSave = async () => {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) return alert("Enter a valid amount")

    setSaving(true)
    try {
      const added = await expenseService.addExpense({
        amount: amt,
        category: selectedCategory,
        note,
        date,
      })
      if (added) {
        // Trigger global event to update other components
        window.dispatchEvent(new CustomEvent('expenseAdded', { detail: { expense: added } }))
        alert("Expense saved successfully!")
        // Reset inputs
        setAmount("")
        setNote("")
        setDate(new Date().toISOString().split('T')[0])
        setSelectedCategory(categories[0])
      }
    } catch (e) {
      console.error("Failed to save expense", e)
      alert("Failed to save expense")
    }
    setSaving(false)
  }

  // Handle voice input (placeholder, connect your voice detection logic)
  const handleVoiceToggle = () => {
    setIsListening(!isListening)
    if (!isListening) {
      // TODO: Start voice recognition and detect amount/category/note/date
      // Example:
      // const voiceExpense = { amount: 500, category: "Food & Dining", note: "Lunch", date: "2026-03-03" }
      // const added = await expenseService.addExpense(voiceExpense)
      // window.dispatchEvent(new CustomEvent('expenseAdded', { detail: { expense: added } }))
    } else {
      // Stop voice recognition
    }
  }

  return (
    <div className="relative space-y-6 pb-24">

      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold">Add Expense</h1>
        <p className="text-sm text-gray-500">Record your spending easily</p>
      </div>

      {/* Amount Input */}
      <Card>
        <div className="text-center">
          <p className="mb-2 text-sm text-gray-500">Amount</p>
          <input
            type="number"
            placeholder="₹0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full border-none bg-transparent text-center text-4xl font-semibold focus:outline-none"
          />
        </div>
      </Card>

      {/* Category Selection */}
      <Card>
        <p className="mb-3 text-sm font-medium">Category</p>
        <div className="grid grid-cols-3 gap-3">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`rounded-lg border py-3 text-sm hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 ${
                selectedCategory === category ? "bg-indigo-600 text-white" : "border-gray-200 text-gray-700"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </Card>

      {/* Other Inputs */}
      <Card>
        <div className="space-y-4">
          <Input
            label="Note"
            placeholder="e.g. Lunch with friends"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </Card>

      {/* Voice Input */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Voice input</p>
            <p className="text-sm text-gray-500">
              {isListening ? "Listening..." : "Tap to add expense using voice"}
            </p>
          </div>
          <button
            onClick={handleVoiceToggle}
            className={`rounded-full p-3 text-white transition ${
              isListening ? "bg-red-500 animate-pulse" : "bg-indigo-600"
            }`}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        </div>
      </Card>

      {/* Bottom Save Button */}
      <div className="fixed bottom-16 left-0 right-0 z-40 px-4 md:static md:px-0">
        <Button onClick={handleSave} className="w-full py-3 text-base" disabled={saving}>
          {saving ? "Saving..." : "Save Expense"}
        </Button>
      </div>
    </div>
  )
}

export default AddExpense