import { getSampleTransactions } from "../../services/sampleTransactionService.js"

// The existing category lists define names, but do not define colors. Keep these
// tied to names (rather than spending rank) so colors stay consistent across months.
const CATEGORY_COLORS = new Map(Object.entries({
  "food & dining": "#ef956c",
  transport: "#65a3e8",
  shopping: "#a58ae0",
  utilities: "#e9bc56",
  entertainment: "#e580aa",
  healthcare: "#50b6a0",
  subscription: "#7c87d5",
  housing: "#bd8b67",
  education: "#83b567",
  travel: "#54b6cf",
  gifts: "#cd8ac6",
  other: "#94a3b8",
}))

export const getCategoryColor = (name) => {
  const key = name.trim().toLowerCase()
  if (CATEGORY_COLORS.has(key)) return CATEGORY_COLORS.get(key)

  // Imported/custom categories get a deterministic color without mutating data.
  let hash = 0
  for (const character of key) hash = (Math.imul(31, hash) + character.codePointAt(0)) | 0
  return `hsl(${((hash % 360) + 360) % 360} 52% 61%)`
}

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const fractionalInrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export const formatExpenseAmount = (amount) =>
  (Number.isInteger(Math.round(amount * 100) / 100) ? inrFormatter : fractionalInrFormatter).format(amount)

export const formatExpensePercentage = (percentage) =>
  percentage > 0 && percentage < 0.1 ? "<0.1%" : `${percentage.toFixed(1)}%`

export const getMonthKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`

export const getMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split("-").map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  })
}

export const getMonthlyExpenseStats = (transactions, monthKey) => {
  const weeklyPaise = [0, 0, 0, 0]
  const categoryPaise = new Map()
  let totalPaise = 0

  for (const transaction of transactions) {
    // Match the transaction model, not the display tab or category name. Income
    // (including received transfers) and any future transfer type stay excluded.
    if (transaction.type !== "expense" || !transaction.datetime) continue
    const date = new Date(transaction.datetime)
    if (Number.isNaN(date.getTime()) || getMonthKey(date) !== monthKey) continue

    const amount = Number(transaction.amount)
    const paise = Math.round((amount + Number.EPSILON) * 100)
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(paise) || paise <= 0) continue

    const name = String(transaction.category || "Other").trim() || "Other"
    categoryPaise.set(name, (categoryPaise.get(name) || 0) + paise)
    weeklyPaise[Math.min(3, Math.floor((date.getDate() - 1) / 7))] += paise
    totalPaise += paise
  }

  const categories = [...categoryPaise].map(([name, paise]) => ({
    name,
    amount: paise / 100,
    percentage: (paise / totalPaise) * 100,
    fill: getCategoryColor(name),
  })).sort((left, right) => right.amount - left.amount || left.name.localeCompare(right.name, "en"))

  return {
    totalExpenses: totalPaise / 100,
    categories,
    weeklyBreakdown: Object.fromEntries(
      ["Week 1 (1-7)", "Week 2 (8-14)", "Week 3 (15-21)", "Week 4+ (22+)"].map(
        (week, index) => [week, weeklyPaise[index] / 100],
      ),
    ),
  }
}

// Display-only data. Reuse FinSight's INR examples without subscribing to, or
// writing through, any transaction/persistence service. Return only chart values.
export const getCategoryExpensePreview = () => {
  const now = new Date()
  const datetime = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString()
  const { categories, totalExpenses } = getMonthlyExpenseStats(
    getSampleTransactions().map((transaction) => ({ ...transaction, datetime })),
    getMonthKey(now),
  )
  return { categories, totalExpenses }
}

const LABEL_HEIGHT = 52
const LABEL_GAP = 60
const CHART_HEIGHT = 360

export const getExpensePieLayout = (categories, width) => {
  const externalLabels = width >= 640
  const height = externalLabels ? CHART_HEIGHT : 280
  const cx = width / 2
  const cy = height / 2
  const radius = Math.max(0, Math.min(externalLabels ? 148 : 122, width / 2 - 24))
  if (!externalLabels) return { height, cx, cy, radius, labels: [] }

  const labelWidth = Math.max(0, cx - radius - 56)
  const minY = 32
  const maxY = height - 32
  const capacity = Math.floor((maxY - minY) / LABEL_GAP) + 1
  const sides = { left: [], right: [] }
  let angle = 90

  categories.forEach((category, index) => {
    const sweep = (category.percentage / 100) * 360
    const midAngle = categories.length === 1 ? 30 : angle - sweep / 2
    angle -= sweep
    const radians = (-midAngle * Math.PI) / 180
    const side = Math.cos(radians) < 0 ? "left" : "right"

    // Keep every slice proportional. Very small slices and dense label clusters
    // remain fully available in the breakdown instead of distorting pie angles.
    if (category.percentage < 1 || sides[side].length >= capacity) return
    const direction = side === "left" ? -1 : 1
    sides[side].push({
      index,
      name: category.name,
      side,
      startX: cx + Math.cos(radians) * (radius + 3),
      startY: cy + Math.sin(radians) * (radius + 3),
      elbowX: cx + Math.cos(radians) * (radius + 18),
      elbowY: cy + Math.sin(radians) * (radius + 18),
      railX: cx + direction * (radius + 28),
      endX: side === "left" ? labelWidth + 22 : width - labelWidth - 22,
      textX: side === "left" ? 12 : width - labelWidth - 12,
      desiredY: cy + Math.sin(radians) * (radius + 22),
      width: labelWidth,
      height: LABEL_HEIGHT,
    })
  })

  const labels = Object.values(sides).flatMap((sideLabels) => {
    // Preserve perimeter order to avoid crossing leaders. A forward pass separates
    // labels; a backward pass keeps the whole column inside the SVG viewport.
    sideLabels.sort((left, right) => left.desiredY - right.desiredY || left.index - right.index)
    sideLabels.forEach((label, index) => {
      label.y = Math.max(minY, label.desiredY, index ? sideLabels[index - 1].y + LABEL_GAP : minY)
    })
    for (let index = sideLabels.length - 1; index >= 0; index -= 1) {
      const label = sideLabels[index]
      label.y = Math.min(label.y, index === sideLabels.length - 1 ? maxY : sideLabels[index + 1].y - LABEL_GAP)
      label.path = `M ${label.startX} ${label.startY} L ${label.elbowX} ${label.elbowY} C ${label.railX} ${label.elbowY}, ${label.railX} ${label.y}, ${label.endX} ${label.y}`
    }
    return sideLabels
  })

  return { height, cx, cy, radius, labels }
}
