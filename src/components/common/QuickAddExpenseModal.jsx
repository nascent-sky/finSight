import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import expenseService from '../../services/expenseService'
import { showToast } from '../../utils/toastStore'

const QuickAddExpenseModal = ({ isOpen, onClose, onExpenseAdded }) => {
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Food & Dining')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const categories = [
    'Food & Dining',
    'Entertainment',
    'Shopping',
    'Utilities',
    'Transport',
    'Subscription',
    'Healthcare',
    'Other',
  ]

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ''))
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }

    setIsSubmitting(true)
    
    try {
      const newExpense = expenseService.addExpense({
        amount: parsedAmount,
        category,
        note: note || 'Manual entry',
        date: new Date().toISOString().split('T')[0],
      })

      showToast(`✓ Expense saved: ₹${parsedAmount}`, 'success', 2500)
      
      if (onExpenseAdded) {
        onExpenseAdded(newExpense)
      }

      // Reset form
      setAmount('')
      setCategory('Food & Dining')
      setNote('')
      onClose()
    } catch {
      showToast('Failed to save expense', 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Quick Add Expense">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Amount
          </label>
          <Input
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Note (Optional)
          </label>
          <Input
            type="text"
            placeholder="What did you spend on?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="flex-1"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving...' : 'Save Expense'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default QuickAddExpenseModal
