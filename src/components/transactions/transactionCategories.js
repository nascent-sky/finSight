export const TRANSACTION_CATEGORIES = Object.freeze([
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
])

export const normalizeTransactionCategory = (category) =>
  String(category ?? "").trim() || "Other"

export const getTransactionCategoryOptions = (currentCategory) => {
  const category = normalizeTransactionCategory(currentCategory)
  // Preserve imported and custom categories when editing, rather than silently
  // showing the first option because the current value is absent from the list.
  return TRANSACTION_CATEGORIES.includes(category)
    ? TRANSACTION_CATEGORIES
    : [...TRANSACTION_CATEGORIES, category]
}
