import { auth } from "../firebase"
import { createFinanceChatClient } from "./financeChatClient.js"

const client = createFinanceChatClient({ getCurrentUser: () => auth.currentUser })

export const requestFinanceChat = client.requestChat
export const requestFinanceRoute = client.requestRoute
export const requestFinanceCapabilities = client.requestCapabilities
export const requestFinanceDemo = client.requestDemo
