import { useState } from "react"

import { addTransaction } from "../../services/transactionService"
import Button from "../ui/Button"
import Input from "../ui/Input"
import Modal from "../ui/Modal"

const transactionCategories = [
  "Other",
  "Food & Dining",
  "Transport",
  "Shopping",
  "Utilities",
  "Entertainment",
  "Subscription",
  "Healthcare",
  "Housing",
  "Education",
  "Travel",
  "Gifts",
  "Income",
]

const toDatetimeLocal = (datetime) => {
  const date = new Date(datetime)
  if (Number.isNaN(date.getTime())) return ""

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

const createFormState = (initialTransaction, forceExpense) => ({
  amount: initialTransaction?.amount == null ? "" : String(initialTransaction.amount),
  type: forceExpense ? "expense" : initialTransaction?.type || "expense",
  datetime: toDatetimeLocal(initialTransaction?.datetime || new Date()),
  person: forceExpense ? "" : initialTransaction?.person || "",
  paymentMethod: forceExpense
    ? "cash"
    : initialTransaction?.paymentMethod || "cash",
  category: initialTransaction?.category || "Other",
  note: initialTransaction?.note || "",
})

const AddTransactionForm = ({ forceExpense, initialTransaction, onClose, onSaved }) => {
  const [form, setForm] = useState(() => createFormState(initialTransaction, forceExpense))
  const [error, setError] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const handleField = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isSaving) return

    const amount = Number(form.amount)
    const date = new Date(form.datetime)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Amount must be greater than zero.")
      return
    }
    if (Number.isNaN(date.getTime())) {
      setError("Choose a valid date and time.")
      return
    }

    setIsSaving(true)
    setError("")

    try {
      const savedTransaction = await addTransaction({
        amount,
        datetime: date.toISOString(),
        type: forceExpense ? "expense" : form.type,
        person: forceExpense ? "" : form.person,
        paymentMethod: forceExpense ? "cash" : form.paymentMethod,
        category: form.category || "Other",
        note: form.note,
      })
      onSaved?.(savedTransaction)
      onClose()
    } catch (saveError) {
      setError(saveError?.message || "Could not add this transaction.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={isSaving ? undefined : onClose}
      title={forceExpense ? "Add Voice Expense" : "Add Transaction"}
      isDismissable={!isSaving}
      className="max-h-[90vh] overflow-y-auto"
    >
      <form className="min-w-0 space-y-4" onSubmit={handleSubmit}>
        <Input
          label="Amount"
          name="amount"
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          required
          autoFocus
          value={form.amount}
          onChange={handleField}
        />
        <Input
          label="Date and time"
          name="datetime"
          type="datetime-local"
          required
          value={form.datetime}
          onChange={handleField}
        />

        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="theme-muted-text min-w-0 space-y-1 text-sm font-medium">
            <span>Type</span>
            <select
              name="type"
              value={form.type}
              onChange={handleField}
              disabled={forceExpense}
              className="theme-input w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </label>
          <label className="theme-muted-text min-w-0 space-y-1 text-sm font-medium">
            <span>Payment</span>
            <select
              name="paymentMethod"
              value={form.paymentMethod}
              onChange={handleField}
              disabled={forceExpense}
              className="theme-input w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </select>
          </label>
        </div>

        <Input
          label="Person"
          name="person"
          value={form.person}
          onChange={handleField}
          disabled={forceExpense}
        />

        <label className="theme-muted-text block space-y-1 text-sm font-medium">
          <span>Category</span>
          <select
            name="category"
            value={form.category}
            onChange={handleField}
            className="theme-input w-full rounded-lg border px-3 py-2 text-sm"
          >
            {transactionCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>

        <label className="theme-muted-text block space-y-1 text-sm font-medium">
          <span>Note</span>
          <textarea
            name="note"
            rows="3"
            value={form.note}
            onChange={handleField}
            className="theme-input w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          />
        </label>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save transaction"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

const AddTransactionModal = ({
  forceExpense = false,
  initialTransaction = null,
  isOpen,
  onClose,
  onSaved,
}) => {
  if (!isOpen) return null

  return (
    <AddTransactionForm
      forceExpense={forceExpense}
      initialTransaction={initialTransaction}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}

export default AddTransactionModal
