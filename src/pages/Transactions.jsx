import { useEffect, useMemo, useRef, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { useLocation, useNavigate } from "react-router-dom"
import {
  Car,
  CircleDollarSign,
  Edit3,
  Film,
  Filter,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Lightbulb,
  MoreVertical,
  Plane,
  Plus,
  Repeat,
  ShoppingBag,
  Tag,
  Trash2,
  Utensils,
  WalletCards,
} from "lucide-react"

import Card from "../components/ui/Card"
import Button from "../components/ui/Button"
import Input from "../components/ui/Input"
import Modal from "../components/ui/Modal"
import VoiceRecorder from "../components/common/VoiceRecorder"
import { ToastContainer } from "../components/common/Toast"
import { auth } from "../firebase"
import { parseExpenseFromTranscript } from "../hooks/useVoiceToExpense"
import {
  isIncomeSource,
  normalizeIncomeSourcePerson,
  rememberIncomeSource,
  subscribeToIncomeSources,
} from "../services/incomeSourceService"
import {
  addTransaction,
  deleteTransaction,
  subscribeToTransactions,
  updateTransaction,
} from "../services/transactionService"
import { addVoiceTransaction } from "../services/voiceTransactionService"

const filters = [
  { label: "All", value: "all" },
  { label: "Cash", value: "cash" },
  { label: "UPI", value: "upi" },
]

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

const categoryIcons = {
  "food & dining": Utensils,
  food: Utensils,
  dining: Utensils,
  entertainment: Film,
  shopping: ShoppingBag,
  utilities: Lightbulb,
  transport: Car,
  transportation: Car,
  subscription: Repeat,
  healthcare: HeartPulse,
  health: HeartPulse,
  housing: Home,
  rent: Home,
  education: GraduationCap,
  travel: Plane,
  gifts: Gift,
  salary: CircleDollarSign,
  income: CircleDollarSign,
}

const formatAmount = (amount) =>
  Number(amount || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })

const formatDatetime = (datetime) => {
  const date = new Date(datetime)
  if (Number.isNaN(date.getTime())) return "Date unavailable"

  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const toDatetimeLocal = (datetime) => {
  const date = new Date(datetime)
  if (Number.isNaN(date.getTime())) return ""

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}

const createAddFormState = () => ({
  amount: "",
  type: "expense",
  datetime: toDatetimeLocal(new Date()),
  person: "",
  paymentMethod: "cash",
  category: "Other",
  note: "",
})

const SWIPE_ACTION_WIDTH = 144

const TransactionRow = ({
  transaction,
  activeTab,
  incomeSources,
  rememberingPerson,
  isSwipeOpen,
  isDesktopMenuOpen,
  isDeleting,
  onSwipeOpen,
  onDesktopMenuToggle,
  onEdit,
  onDelete,
  onRememberIncomeSource,
}) => {
  const [dragOffset, setDragOffset] = useState(null)
  const touchState = useRef(null)
  const currentOffset = useRef(0)
  const category = transaction.category || "Other"
  const CategoryIcon = categoryIcons[category.toLowerCase()] || Tag
  const isIncome = transaction.type === "income"
  const isRemembered = isIncomeSource(transaction.person, incomeSources)
  const canRemember =
    activeTab === "expense" && isIncome && transaction.person?.trim() && !isRemembered
  const isRemembering =
    rememberingPerson === normalizeIncomeSourcePerson(transaction.person)
  const restingOffset = isSwipeOpen ? -SWIPE_ACTION_WIDTH : 0
  const translateX = dragOffset ?? restingOffset

  const handleTouchStart = (event) => {
    const touch = event.touches[0]
    touchState.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: restingOffset,
      direction: null,
    }
    currentOffset.current = restingOffset
  }

  const handleTouchMove = (event) => {
    const gesture = touchState.current
    if (!gesture) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - gesture.startX
    const deltaY = touch.clientY - gesture.startY

    if (!gesture.direction && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8) {
      gesture.direction = Math.abs(deltaX) > Math.abs(deltaY) * 1.2
        ? "horizontal"
        : "vertical"
    }

    if (gesture.direction !== "horizontal") return

    event.preventDefault()
    const nextOffset = Math.max(
      -SWIPE_ACTION_WIDTH,
      Math.min(0, gesture.startOffset + deltaX),
    )
    currentOffset.current = nextOffset
    setDragOffset(nextOffset)
  }

  const finishTouch = () => {
    const wasHorizontal = touchState.current?.direction === "horizontal"
    touchState.current = null

    if (!wasHorizontal) {
      setDragOffset(null)
      return
    }

    onSwipeOpen(currentOffset.current < -SWIPE_ACTION_WIDTH / 2)
    setDragOffset(null)
  }

  return (
    <article
      data-transaction-row={transaction.id}
      className="theme-card relative overflow-hidden rounded-xl border"
    >
      <div className="absolute inset-y-0 right-0 flex w-36 md:hidden">
        <button
          type="button"
          onClick={() => onEdit(transaction)}
          className="flex w-1/2 flex-col items-center justify-center gap-1 bg-blue-600 text-xs font-semibold text-white"
        >
          <Edit3 size={18} /> Edit
        </button>
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => onDelete(transaction)}
          className="flex w-1/2 flex-col items-center justify-center gap-1 bg-red-600 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Trash2 size={18} /> {isDeleting ? "Deleting" : "Delete"}
        </button>
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={finishTouch}
        onTouchCancel={finishTouch}
        className={`theme-card relative flex touch-pan-y items-center gap-3 p-3 sm:gap-4 ${
          dragOffset == null ? "transition-transform duration-200 ease-out" : ""
        }`}
        style={{ transform: `translateX(${translateX}px)` }}
      >
        <div className="theme-panel theme-accent-text flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <CategoryIcon size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="theme-text truncate text-sm font-semibold sm:text-base">{category}</h2>
            {transaction.person ? (
              <span className="theme-muted-text truncate text-xs sm:text-sm">
                · {transaction.person}
              </span>
            ) : null}
          </div>
          {transaction.note ? (
            <p className="theme-muted-text mt-0.5 truncate text-xs sm:text-sm">
              {transaction.note}
            </p>
          ) : null}
          <div className="theme-muted-text mt-1 flex flex-wrap gap-x-2 text-[11px] sm:text-xs">
            <span>{formatDatetime(transaction.datetime)}</span>
            <span aria-hidden="true">·</span>
            <span className="uppercase">{transaction.paymentMethod}</span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={`text-sm font-bold sm:text-base ${
              isIncome
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {isIncome ? "+" : "−"}₹{formatAmount(transaction.amount)}
          </p>
          {canRemember ? (
            <button
              type="button"
              disabled={Boolean(rememberingPerson)}
              onClick={() => onRememberIncomeSource(transaction.person)}
              className="theme-accent-text mt-1 block text-[11px] font-semibold hover:underline disabled:cursor-wait disabled:opacity-60"
            >
              {isRemembering ? "Moving..." : "Move to income"}
            </button>
          ) : null}

          <div className="mt-1 hidden justify-end gap-1 md:flex">
            {isDesktopMenuOpen ? (
              <>
                <button
                  type="button"
                  title="Edit transaction"
                  onClick={() => onEdit(transaction)}
                  className="theme-muted-text rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <Edit3 size={16} />
                </button>
                <button
                  type="button"
                  title="Delete transaction"
                  disabled={isDeleting}
                  onClick={() => onDelete(transaction)}
                  className="rounded-md p-1.5 text-red-600 hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={16} />
                </button>
              </>
            ) : (
              <button
                type="button"
                title="Transaction actions"
                aria-label="Transaction actions"
                onClick={() => onDesktopMenuToggle(transaction.id)}
                className="theme-muted-text rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <MoreVertical size={17} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

const Transactions = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("expense")
  const [activeFilter, setActiveFilter] = useState("all")
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [incomeSources, setIncomeSources] = useState([])
  const [areTransactionsLoading, setAreTransactionsLoading] = useState(true)
  const [areIncomeSourcesLoading, setAreIncomeSourcesLoading] = useState(true)
  const [rememberingPerson, setRememberingPerson] = useState("")
  const [openSwipeId, setOpenSwipeId] = useState(null)
  const [openDesktopMenuId, setOpenDesktopMenuId] = useState(null)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [editFormError, setEditFormError] = useState("")
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addForm, setAddForm] = useState(createAddFormState)
  const [addFormError, setAddFormError] = useState("")
  const [isSavingAdd, setIsSavingAdd] = useState(false)
  const [isVoiceAdd, setIsVoiceAdd] = useState(false)
  const [error, setError] = useState("")
  const handledVoiceTranscript = useRef(null)

  useEffect(() => {
    let unsubscribeTransactions = () => {}
    let unsubscribeIncomeSources = () => {}

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeTransactions()
      unsubscribeIncomeSources()
      setTransactions([])
      setIncomeSources([])
      setError("")
      setAreTransactionsLoading(true)

      unsubscribeTransactions = subscribeToTransactions(
        (nextTransactions) => {
          setTransactions(nextTransactions)
          setAreTransactionsLoading(false)
        },
        (subscriptionError) => {
          setError(subscriptionError?.message || "Could not load transactions right now.")
          setAreTransactionsLoading(false)
        },
      )

      if (!user) {
        setAreIncomeSourcesLoading(false)
        return
      }

      setAreIncomeSourcesLoading(true)
      unsubscribeIncomeSources = subscribeToIncomeSources(
        (nextIncomeSources) => {
          setIncomeSources(nextIncomeSources)
          setAreIncomeSourcesLoading(false)
        },
        (subscriptionError) => {
          setError(subscriptionError?.message || "Could not load income sources right now.")
          setAreIncomeSourcesLoading(false)
        },
      )
    })

    return () => {
      unsubscribeAuth()
      unsubscribeTransactions()
      unsubscribeIncomeSources()
    }
  }, [])

  useEffect(() => {
    const transcript = new URLSearchParams(location.search).get("voice")?.trim()
    if (!transcript) {
      handledVoiceTranscript.current = null
      return
    }
    if (handledVoiceTranscript.current === transcript) return

    handledVoiceTranscript.current = transcript
    const voiceExpense = parseExpenseFromTranscript(transcript)

    if (!Number.isFinite(voiceExpense.amount) || voiceExpense.amount <= 0) {
      setFeedback({
        type: "error",
        message: "Could not detect a valid amount from the voice expense.",
      })
      return
    }

    setAddForm({
      amount: String(voiceExpense.amount),
      type: "expense",
      datetime: toDatetimeLocal(new Date()),
      person: "",
      paymentMethod: "cash",
      category: voiceExpense.category || "Other",
      note:
        voiceExpense.note ||
        voiceExpense.merchant ||
        voiceExpense.originalTranscript ||
        "Voice input",
    })
    setAddFormError("")
    setIsVoiceAdd(true)
    setIsAddModalOpen(true)
  }, [location.search])

  useEffect(() => {
    if (!openSwipeId && !openDesktopMenuId) return undefined

    const closeActionsWhenClickingElsewhere = (event) => {
      const row = event.target.closest?.("[data-transaction-row]")
      const rowId = row?.dataset.transactionRow

      if (openSwipeId && rowId !== openSwipeId) setOpenSwipeId(null)
      if (openDesktopMenuId && rowId !== openDesktopMenuId) {
        setOpenDesktopMenuId(null)
      }
    }

    document.addEventListener("pointerdown", closeActionsWhenClickingElsewhere, true)
    return () => {
      document.removeEventListener("pointerdown", closeActionsWhenClickingElsewhere, true)
    }
  }, [openDesktopMenuId, openSwipeId])

  useEffect(() => {
    if (!feedback) return undefined

    const timeout = window.setTimeout(() => setFeedback(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const isLoading = areTransactionsLoading || areIncomeSourcesLoading

  const visibleTransactions = useMemo(
    () =>
      transactions.filter((transaction) => {
        const matchesTab =
          activeTab === "expense" ||
          (transaction.type === "income" &&
            isIncomeSource(transaction.person, incomeSources))
        const matchesPaymentMethod =
          activeFilter === "all" || transaction.paymentMethod === activeFilter

        return matchesTab && matchesPaymentMethod
      }),
    [activeFilter, activeTab, incomeSources, transactions],
  )

  const handleRememberIncomeSource = async (person) => {
    const normalizedPerson = normalizeIncomeSourcePerson(person)
    if (!normalizedPerson || rememberingPerson) return

    setRememberingPerson(normalizedPerson)
    setError("")

    try {
      await rememberIncomeSource(person)
    } catch (rememberError) {
      setError(rememberError?.message || "Could not remember this income source.")
    } finally {
      setRememberingPerson("")
    }
  }

  const handleVoiceExpenseDetected = async (voiceExpense) => {
    return addVoiceTransaction(voiceExpense)
  }

  const openEditTransaction = (transaction) => {
    setOpenSwipeId(null)
    setOpenDesktopMenuId(null)
    setEditFormError("")
    setEditingTransaction(transaction)
    setEditForm({
      amount: String(transaction.amount ?? ""),
      datetime: toDatetimeLocal(transaction.datetime),
      type: transaction.type,
      person: transaction.person ?? "",
      paymentMethod: transaction.paymentMethod,
      category: transaction.category || "Other",
      note: transaction.note ?? "",
    })
  }

  const closeEditTransaction = () => {
    if (isSavingEdit) return
    setEditingTransaction(null)
    setEditForm(null)
    setEditFormError("")
  }

  const handleEditField = (event) => {
    const { name, value } = event.target
    setEditForm((current) => ({ ...current, [name]: value }))
  }

  const handleSaveEdit = async (event) => {
    event.preventDefault()
    if (!editingTransaction || !editForm || isSavingEdit) return

    const amount = Number(editForm.amount)
    const date = new Date(editForm.datetime)
    if (!Number.isFinite(amount) || amount <= 0) {
      setEditFormError("Amount must be greater than zero.")
      return
    }
    if (Number.isNaN(date.getTime())) {
      setEditFormError("Choose a valid date and time.")
      return
    }

    setIsSavingEdit(true)
    setEditFormError("")

    try {
      await updateTransaction(editingTransaction.id, {
        amount,
        datetime: date.toISOString(),
        type: editForm.type,
        person: editForm.person,
        paymentMethod: editForm.paymentMethod,
        category: editForm.category.trim() || "Other",
        note: editForm.note,
      })
      setEditingTransaction(null)
      setEditForm(null)
      setFeedback({ type: "success", message: "Transaction updated." })
    } catch (saveError) {
      setEditFormError(saveError?.message || "Could not update this transaction.")
    } finally {
      setIsSavingEdit(false)
    }
  }

  const clearVoiceParameter = () => {
    const parameters = new URLSearchParams(location.search)
    if (!parameters.has("voice")) return

    parameters.delete("voice")
    const query = parameters.toString()
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { replace: true })
  }

  const openAddTransaction = () => {
    setIsVoiceAdd(false)
    setAddForm(createAddFormState())
    setAddFormError("")
    setIsAddModalOpen(true)
  }

  const closeAddTransaction = () => {
    if (isSavingAdd) return
    setIsAddModalOpen(false)
    setAddFormError("")
    if (isVoiceAdd) {
      setIsVoiceAdd(false)
      clearVoiceParameter()
    }
  }

  const handleAddField = (event) => {
    const { name, value } = event.target
    setAddForm((current) => ({ ...current, [name]: value }))
  }

  const handleAddTransaction = async (event) => {
    event.preventDefault()
    if (isSavingAdd) return

    const amount = Number(addForm.amount)
    const date = new Date(addForm.datetime)
    if (!Number.isFinite(amount) || amount <= 0) {
      setAddFormError("Amount must be greater than zero.")
      return
    }
    if (Number.isNaN(date.getTime())) {
      setAddFormError("Choose a valid date and time.")
      return
    }

    setIsSavingAdd(true)
    setAddFormError("")

    try {
      await addTransaction({
        amount,
        datetime: date.toISOString(),
        type: isVoiceAdd ? "expense" : addForm.type,
        person: isVoiceAdd ? "" : addForm.person,
        paymentMethod: isVoiceAdd ? "cash" : addForm.paymentMethod,
        category: addForm.category || "Other",
        note: addForm.note,
      })
      setIsAddModalOpen(false)
      setAddForm(createAddFormState())
      setFeedback({
        type: "success",
        message: isVoiceAdd ? "Voice expense added." : "Transaction added.",
      })
      if (isVoiceAdd) {
        setIsVoiceAdd(false)
        clearVoiceParameter()
      }
    } catch (saveError) {
      setAddFormError(saveError?.message || "Could not add this transaction.")
    } finally {
      setIsSavingAdd(false)
    }
  }

  const handleDeleteTransaction = async (transaction) => {
    setOpenSwipeId(null)
    setOpenDesktopMenuId(null)

    const label = transaction.person || transaction.category || "this transaction"
    const sign = transaction.type === "income" ? "+" : "−"
    const confirmed = window.confirm(
      `Delete ${label} (${sign}₹${formatAmount(transaction.amount)})?`,
    )
    if (!confirmed) return

    setDeletingId(transaction.id)
    try {
      await deleteTransaction(transaction.id)
      setFeedback({ type: "success", message: "Transaction deleted." })
    } catch (deleteError) {
      setFeedback({
        type: "error",
        message: deleteError?.message || "Could not delete this transaction.",
      })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <ToastContainer />

      <div className="theme-hero rounded-2xl p-6 shadow-lg">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <p className="mt-2 opacity-90">Your expenses and income in one place</p>
      </div>

      <VoiceRecorder onExpenseDetected={handleVoiceExpenseDetected} />

      <div className="grid grid-cols-2 gap-3" role="tablist" aria-label="Transaction view">
        {[
          { label: "Expense", value: "expense" },
          { label: "Income", value: "income" },
        ].map((tab) => {
          const isActive = activeTab === tab.value

          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.value)}
              className={`theme-card rounded-xl border px-4 py-4 text-sm font-semibold transition-all ${
                isActive
                  ? "border-indigo-600 text-indigo-600 ring-2 ring-indigo-500/20 dark:text-indigo-400"
                  : "theme-muted-text hover:-translate-y-0.5"
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex justify-end">
        <div className="relative">
          <button
            type="button"
            aria-label="Filter transactions"
            aria-expanded={isFilterOpen}
            onClick={() => setIsFilterOpen((open) => !open)}
            className="theme-card theme-muted-text flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Filter size={18} />
            {filters.find((filter) => filter.value === activeFilter)?.label}
          </button>

          {isFilterOpen ? (
            <div className="theme-card absolute right-0 z-20 mt-2 min-w-36 rounded-xl border p-1 shadow-lg">
              {filters.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => {
                    setActiveFilter(filter.value)
                    setIsFilterOpen(false)
                  }}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    activeFilter === filter.value
                      ? "bg-indigo-600 text-white"
                      : "theme-text hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
        </Card>
      ) : null}

      {isLoading ? (
        <Card padding="lg" className="text-center">
          <p className="theme-muted-text">Loading transactions...</p>
        </Card>
      ) : visibleTransactions.length === 0 && !error ? (
        <Card padding="lg" className="text-center">
          <WalletCards className="theme-muted-text mx-auto" size={32} />
          <p className="theme-text mt-3 font-semibold">No transactions found</p>
          <p className="theme-muted-text mt-1 text-sm">
            There are no transactions matching this view and filter.
          </p>
        </Card>
      ) : (
        <section className="space-y-3" aria-live="polite">
          {visibleTransactions.map((transaction) => (
            <TransactionRow
              key={transaction.id}
              transaction={transaction}
              activeTab={activeTab}
              incomeSources={incomeSources}
              rememberingPerson={rememberingPerson}
              isSwipeOpen={openSwipeId === transaction.id}
              isDesktopMenuOpen={openDesktopMenuId === transaction.id}
              isDeleting={deletingId === transaction.id}
              onSwipeOpen={(isOpen) => {
                setOpenDesktopMenuId(null)
                setOpenSwipeId(isOpen ? transaction.id : null)
              }}
              onDesktopMenuToggle={(id) => {
                setOpenSwipeId(null)
                setOpenDesktopMenuId((current) => current === id ? null : id)
              }}
              onEdit={openEditTransaction}
              onDelete={handleDeleteTransaction}
              onRememberIncomeSource={handleRememberIncomeSource}
            />
          ))}
        </section>
      )}

      {feedback ? (
        <div
          role="status"
          className={`fixed right-4 top-20 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
            feedback.type === "success"
              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900 dark:text-green-200"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900 dark:text-red-200"
          }`}
        >
          {feedback.message}
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Add transaction"
        onClick={openAddTransaction}
        className="theme-button-primary fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full shadow-xl md:bottom-6 md:right-6"
      >
        <Plus size={26} />
      </button>

      <Modal
        isOpen={Boolean(editingTransaction && editForm)}
        onClose={closeEditTransaction}
        title="Edit Transaction"
        isDismissable={!isSavingEdit}
        className="max-h-[90vh] overflow-y-auto"
      >
        {editForm ? (
          <form className="space-y-4" onSubmit={handleSaveEdit}>
            <Input
              label="Amount"
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={editForm.amount}
              onChange={handleEditField}
            />
            <Input
              label="Date and time"
              name="datetime"
              type="datetime-local"
              required
              value={editForm.datetime}
              onChange={handleEditField}
            />

            <div className="grid grid-cols-2 gap-3">
              <label className="theme-muted-text space-y-1 text-sm font-medium">
                <span>Type</span>
                <select
                  name="type"
                  value={editForm.type}
                  onChange={handleEditField}
                  className="theme-input w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>
              <label className="theme-muted-text space-y-1 text-sm font-medium">
                <span>Payment</span>
                <select
                  name="paymentMethod"
                  value={editForm.paymentMethod}
                  onChange={handleEditField}
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
              value={editForm.person}
              onChange={handleEditField}
            />
            <Input
              label="Category"
              name="category"
              value={editForm.category}
              onChange={handleEditField}
              placeholder="Other"
            />
            <label className="theme-muted-text block space-y-1 text-sm font-medium">
              <span>Note</span>
              <textarea
                name="note"
                rows="3"
                value={editForm.note}
                onChange={handleEditField}
                className="theme-input w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
              />
            </label>

            {editFormError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{editFormError}</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                disabled={isSavingEdit}
                onClick={closeEditTransaction}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingEdit}>
                {isSavingEdit ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        isOpen={isAddModalOpen}
        onClose={closeAddTransaction}
        title={isVoiceAdd ? "Add Voice Expense" : "Add Transaction"}
        isDismissable={!isSavingAdd}
        className="max-h-[90vh] overflow-y-auto"
      >
        <form className="space-y-4" onSubmit={handleAddTransaction}>
          <Input
            label="Amount"
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            autoFocus
            value={addForm.amount}
            onChange={handleAddField}
          />
          <Input
            label="Date and time"
            name="datetime"
            type="datetime-local"
            required
            value={addForm.datetime}
            onChange={handleAddField}
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="theme-muted-text space-y-1 text-sm font-medium">
              <span>Type</span>
              <select
                name="type"
                value={addForm.type}
                onChange={handleAddField}
                disabled={isVoiceAdd}
                className="theme-input w-full rounded-lg border px-3 py-2 text-sm"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label className="theme-muted-text space-y-1 text-sm font-medium">
              <span>Payment</span>
              <select
                name="paymentMethod"
                value={addForm.paymentMethod}
                onChange={handleAddField}
                disabled={isVoiceAdd}
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
            value={addForm.person}
            onChange={handleAddField}
            disabled={isVoiceAdd}
          />

          <label className="theme-muted-text block space-y-1 text-sm font-medium">
            <span>Category</span>
            <select
              name="category"
              value={addForm.category}
              onChange={handleAddField}
              className="theme-input w-full rounded-lg border px-3 py-2 text-sm"
            >
              {transactionCategories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="theme-muted-text block space-y-1 text-sm font-medium">
            <span>Note</span>
            <textarea
              name="note"
              rows="3"
              value={addForm.note}
              onChange={handleAddField}
              className="theme-input w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            />
          </label>

          {addFormError ? (
            <p className="text-sm text-red-600 dark:text-red-400">{addFormError}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              disabled={isSavingAdd}
              onClick={closeAddTransaction}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSavingAdd}>
              {isSavingAdd ? "Saving..." : "Save transaction"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default Transactions
