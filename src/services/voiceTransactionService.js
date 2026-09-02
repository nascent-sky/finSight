import { addTransaction } from "./transactionService"

export const buildVoiceTransaction = (voiceExpense = {}) => ({
  amount: Number(voiceExpense.amount),
  datetime: new Date().toISOString(),
  type: "expense",
  person: "",
  paymentMethod: "cash",
  category: voiceExpense.category || "Other",
  note:
    voiceExpense.note ||
    voiceExpense.merchant ||
    voiceExpense.originalTranscript ||
    "Voice input",
})

export const addVoiceTransaction = (voiceExpense) =>
  addTransaction(buildVoiceTransaction(voiceExpense))
