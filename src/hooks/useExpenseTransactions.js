import { useEffect, useMemo, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"

import { auth } from "../firebase"
import { getSampleTransactions } from "../services/sampleTransactionService"
import { subscribeToTransactions } from "../services/transactionService"

const toExpenseRecord = (transaction) => ({
  ...transaction,
  date: transaction.datetime,
})

const useExpenseTransactions = () => {
  const [transactions, setTransactions] = useState([])
  const [hasResolved, setHasResolved] = useState(false)

  useEffect(() => {
    let unsubscribeTransactions = () => {}

    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      unsubscribeTransactions()
      setTransactions([])
      setHasResolved(false)

      unsubscribeTransactions = subscribeToTransactions(
        (nextTransactions) => {
          setTransactions(nextTransactions)
          setHasResolved(true)
        },
        () => {
          setHasResolved(true)
        },
      )
    })

    return () => {
      unsubscribeAuth()
      unsubscribeTransactions()
    }
  }, [])

  const expenses = useMemo(
    () => transactions
      .filter((transaction) => transaction.type === "expense")
      .map(toExpenseRecord),
    [transactions],
  )
  const isSampleData = hasResolved && transactions.length === 0
  const visibleExpenses = useMemo(() => {
    if (!isSampleData) return expenses

    return getSampleTransactions().map((transaction, index) =>
      toExpenseRecord({
        id: `__finsight_sample_display_only_${index}`,
        ...transaction,
      }),
    )
  }, [expenses, isSampleData])

  return { expenses: visibleExpenses, isSampleData, transactions }
}

export default useExpenseTransactions
