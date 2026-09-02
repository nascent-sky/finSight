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
  const [expenses, setExpenses] = useState([])
  const [hasResolved, setHasResolved] = useState(false)

  useEffect(() => {
    let unsubscribeTransactions = () => {}

    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      unsubscribeTransactions()
      setExpenses([])
      setHasResolved(false)

      unsubscribeTransactions = subscribeToTransactions(
        (transactions) => {
          setExpenses(
            transactions
              .filter((transaction) => transaction.type === "expense")
              .map(toExpenseRecord),
          )
          setHasResolved(true)
        },
        () => {
          setExpenses([])
          setHasResolved(false)
        },
      )
    })

    return () => {
      unsubscribeAuth()
      unsubscribeTransactions()
    }
  }, [])

  const isSampleData = hasResolved && expenses.length === 0
  const visibleExpenses = useMemo(() => {
    if (!isSampleData) return expenses

    return getSampleTransactions().map((transaction, index) =>
      toExpenseRecord({
        id: `__finsight_sample_display_only_${index}`,
        ...transaction,
      }),
    )
  }, [expenses, isSampleData])

  return { expenses: visibleExpenses, isSampleData }
}

export default useExpenseTransactions
