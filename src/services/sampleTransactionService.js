const SAMPLE_EXPENSES = [
  { amount: 320, person: "Local cafe", paymentMethod: "upi", category: "Food & Dining", note: "Breakfast and coffee", hour: 9, minute: 15 },
  { amount: 850, person: "Grocery store", paymentMethod: "upi", category: "Food & Dining", note: "Weekly groceries", hour: 18, minute: 40 },
  { amount: 180, person: "Metro", paymentMethod: "upi", category: "Transport", note: "Metro recharge", hour: 8, minute: 20 },
  { amount: 460, person: "Fuel station", paymentMethod: "cash", category: "Transport", note: "Fuel", hour: 19, minute: 5 },
  { amount: 1299, person: "Clothing store", paymentMethod: "upi", category: "Shopping", note: "Clothing", hour: 16, minute: 30 },
  { amount: 599, person: "Cinema", paymentMethod: "upi", category: "Entertainment", note: "Movie tickets", hour: 20, minute: 10 },
  { amount: 2140, person: "Electricity board", paymentMethod: "upi", category: "Utilities", note: "Electricity bill", hour: 11, minute: 45 },
  { amount: 749, person: "Internet provider", paymentMethod: "upi", category: "Utilities", note: "Broadband bill", hour: 12, minute: 25 },
  { amount: 680, person: "Pharmacy", paymentMethod: "cash", category: "Healthcare", note: "Medicines", hour: 17, minute: 35 },
  { amount: 1500, person: "Learning platform", paymentMethod: "upi", category: "Education", note: "Online course", hour: 14, minute: 10 },
  { amount: 240, person: "Street food vendor", paymentMethod: "cash", category: "Food & Dining", note: "Evening snacks", hour: 19, minute: 50 },
  { amount: 350, person: "Book shop", paymentMethod: "cash", category: "Education", note: "Books and stationery", hour: 13, minute: 20 },
  { amount: 899, person: "Streaming service", paymentMethod: "upi", category: "Subscription", note: "Annual subscription", hour: 10, minute: 5 },
  { amount: 275, person: "", paymentMethod: "cash", category: "Other", note: "Household supplies", hour: 15, minute: 55 },
]

const createSampleDatetime = (index, total, now) => {
  const currentDay = now.getDate()
  const day = Math.max(1, Math.round(currentDay - ((index * currentDay) / total)))
  const sample = SAMPLE_EXPENSES[index]
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    day,
    sample.hour,
    sample.minute,
    0,
    0,
  )

  if (date > now) {
    date.setTime(now.getTime() - (index + 1) * 10 * 60 * 1000)
  }

  return date.toISOString()
}

export const getSampleTransactions = () => {
  const now = new Date()

  return SAMPLE_EXPENSES.map((sample, index) => ({
    amount: sample.amount,
    datetime: createSampleDatetime(index, SAMPLE_EXPENSES.length, now),
    type: "expense",
    person: sample.person,
    paymentMethod: sample.paymentMethod,
    category: sample.category,
    note: sample.note,
  }))
}
