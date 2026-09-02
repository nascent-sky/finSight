import { useEffect, useMemo, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import {
  Car,
  CircleDollarSign,
  Film,
  Filter,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Lightbulb,
  Plane,
  Repeat,
  ShoppingBag,
  Tag,
  Utensils,
  WalletCards,
} from "lucide-react"

import Card from "../components/ui/Card"
import { auth } from "../firebase"
import { subscribeToTransactions } from "../services/transactionService"

const filters = [
  { label: "All", value: "all" },
  { label: "Cash", value: "cash" },
  { label: "UPI", value: "upi" },
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

const Transactions = () => {
  const [activeTab, setActiveTab] = useState("expense")
  const [activeFilter, setActiveFilter] = useState("all")
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [transactions, setTransactions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let unsubscribeTransactions = () => {}

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeTransactions()
      setTransactions([])
      setError("")

      if (!user) {
        setIsLoading(false)
        setError("Sign in to view your transactions.")
        return
      }

      setIsLoading(true)
      unsubscribeTransactions = subscribeToTransactions(
        (nextTransactions) => {
          setTransactions(nextTransactions)
          setError("")
          setIsLoading(false)
        },
        (subscriptionError) => {
          setError(subscriptionError?.message || "Could not load transactions right now.")
          setIsLoading(false)
        },
      )
    })

    return () => {
      unsubscribeAuth()
      unsubscribeTransactions()
    }
  }, [])

  const visibleTransactions = useMemo(
    () =>
      transactions.filter((transaction) => {
        const matchesTab = activeTab === "expense" || transaction.type === "income"
        const matchesPaymentMethod =
          activeFilter === "all" || transaction.paymentMethod === activeFilter

        return matchesTab && matchesPaymentMethod
      }),
    [activeFilter, activeTab, transactions],
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="theme-hero rounded-2xl p-6 shadow-lg">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <p className="mt-2 opacity-90">Your expenses and income in one place</p>
      </div>

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
          {visibleTransactions.map((transaction) => {
            const category = transaction.category || "Other"
            const CategoryIcon = categoryIcons[category.toLowerCase()] || Tag
            const isIncome = transaction.type === "income"

            return (
              <Card key={transaction.id} className="transition-shadow hover:shadow-md">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="theme-panel theme-accent-text flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                    <CategoryIcon size={21} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h2 className="theme-text font-semibold">{category}</h2>
                      {transaction.person ? (
                        <span className="theme-muted-text text-sm">· {transaction.person}</span>
                      ) : null}
                    </div>
                    {transaction.note ? (
                      <p className="theme-muted-text mt-0.5 truncate text-sm">
                        {transaction.note}
                      </p>
                    ) : null}
                    <div className="theme-muted-text mt-1 flex flex-wrap gap-x-2 text-xs">
                      <span>{formatDatetime(transaction.datetime)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="uppercase">{transaction.paymentMethod}</span>
                    </div>
                  </div>

                  <p
                    className={`shrink-0 text-right font-bold ${
                      isIncome
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {isIncome ? "+" : "−"}₹{formatAmount(transaction.amount)}
                  </p>
                </div>
              </Card>
            )
          })}
        </section>
      )}
    </div>
  )
}

export default Transactions
