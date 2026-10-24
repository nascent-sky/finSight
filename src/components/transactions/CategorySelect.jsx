import {
  getTransactionCategoryOptions,
  normalizeTransactionCategory,
} from "./transactionCategories"

const CategorySelect = ({ value, onChange, disabled = false }) => (
  <label className="theme-muted-text block min-w-0 space-y-1 text-sm font-medium">
    <span>Category</span>
    <select
      name="category"
      value={normalizeTransactionCategory(value)}
      onChange={onChange}
      disabled={disabled}
      required
      className="theme-input w-full min-w-0 max-w-full rounded-lg border px-3 py-2 text-sm"
    >
      {getTransactionCategoryOptions(value).map((category) => (
        <option key={category} value={category}>{category}</option>
      ))}
    </select>
  </label>
)

export default CategorySelect
