import { auth } from "../firebase"
import { createFinanceChatClient } from "./financeChatClient.js"
import { subscribeToTransactions } from "./transactionService"
import { createAccountRecordSubscription } from "../features/finance-ai/financeSession.js"

const client = createFinanceChatClient({ getCurrentUser: () => auth.currentUser })

export const requestFinanceChat = client.requestChat
export const requestFinanceRoute = client.requestRoute
export const requestFinanceCapabilities = client.requestCapabilities
export const requestFinanceDemo = client.requestDemo
export const subscribeFinanceRecords = createAccountRecordSubscription({ getCurrentUser: () => auth.currentUser, subscribeRecords: subscribeToTransactions })
