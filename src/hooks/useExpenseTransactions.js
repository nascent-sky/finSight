import { useEffect, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"

import { auth } from "../firebase"
import { subscribeToTransactions } from "../services/transactionService"

const toExpenseRecord = (transaction) => ({
  ...transaction,
  date: transaction.datetime,
})

const useExpenseTransactions = () => {
  const [expenses, setExpenses] = useState([])

  useEffect(() => {
    let unsubscribeTransactions = () => {}

    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      unsubscribeTransactions()
      setExpenses([])

      unsubscribeTransactions = subscribeToTransactions(
        (transactions) => {
          setExpenses(
            transactions
              .filter((transaction) => transaction.type === "expense")
              .map(toExpenseRecord),
          )
        },
        () => setExpenses([]),
      )
    })

    return () => {
      unsubscribeAuth()
      unsubscribeTransactions()
    }
  }, [])

  return expenses
}

export default useExpenseTransactions

