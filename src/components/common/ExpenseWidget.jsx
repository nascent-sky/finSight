import { Plus, Mic } from "lucide-react"
import Card from "../ui/Card"
import { useState } from 'react'
import { useVoiceToExpense } from '../../hooks/useVoiceToExpense'
import expenseService from '../../services/expenseService'
import { showToast } from '../../utils/toastStore'

const ExpenseWidget = () => {
  const [isProcessing, setIsProcessing] = useState(false)

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
  } = useVoiceToExpense((expense) => {
    // on recognized
    if (expense && expense.amount > 0) {
      const added = expenseService.addExpense({
        amount: expense.amount,
        category: expense.category,
        note: expense.note || expense.merchant || 'Voice input',
        date: new Date().toISOString().split('T')[0],
        merchant: expense.merchant,
      })
      showToast(`Saved: ₹${added.amount} - ${added.category}`, 'success', 3000)
    }
  })

  const handleQuickAdd = () => {
    const amountRaw = window.prompt('Quick add amount (numbers only)')
    if (!amountRaw) return
    const amount = parseFloat(amountRaw.replace(/[^0-9.]/g, ''))
    if (isNaN(amount) || amount <= 0) return showToast('Invalid amount', 'error')
    const category = window.prompt('Category', 'Food & Dining') || 'Other'
    const note = window.prompt('Note (optional)', '') || ''

    setIsProcessing(true)
    const added = expenseService.addExpense({ amount, category, note, date: new Date().toISOString().split('T')[0] })
    showToast(`✓ Expense saved: ₹${added.amount}`, 'success', 2500)
    setIsProcessing(false)
  }

  const handleMicClick = () => {
    if (isListening) stopListening()
    else startListening()
  }

  return (
    <div className="fixed bottom-24 right-4 z-50 hidden sm:block">
      <Card className="w-56">
        <p className="mb-2 text-sm font-medium">Quick Add Expense</p>

        <div className="flex gap-2">
          <button
            onClick={handleQuickAdd}
            disabled={isProcessing}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-2 py-2 text-sm text-white"
          >
            <Plus size={16} />
            Add
          </button>

          <button
            onClick={handleMicClick}
            className={`rounded-lg p-2 text-gray-700 hover:bg-gray-200 ${isListening ? 'bg-red-500 text-white' : 'bg-gray-100'}`}
            title={isListening ? 'Stop listening' : 'Start voice input'}
          >
            <Mic size={16} />
          </button>
        </div>

        {transcript && (
          <p className="mt-2 text-xs text-gray-500 italic">"{transcript}"</p>
        )}
      </Card>
    </div>
  )
}

export default ExpenseWidget
