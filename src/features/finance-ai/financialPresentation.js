import { calculateHypotheticalReduction } from "./financialContext.js"
import { comparisonBlock, responsePresentation } from "./responseBlocks.js"
import { formatExpenseAmount } from "../../components/analytics/expenseChartUtils.js"
import { shiftDay } from "./questionPlanner.js"

const money = (paise) => formatExpenseAmount(paise / 100)
const periodLabel = (plan) => `${plan.period.label}${plan.period.end > shiftDay(plan.asOf, 1) && !/to date/.test(plan.period.label) ? " · incomplete period" : ""}`
const shortDate = (date, plan) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(plan.period.start.slice(0, 4) !== shiftDay(plan.period.end, -1).slice(0, 4) ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
export const financialRecordSummary = (record, plan) => `${record.category}${record.type === "expense" && record.category.toLowerCase() === "income" ? " (expense category)" : ""} · ${money(record.paise)} · ${shortDate(record.date, plan)} · ${record.method.toUpperCase()}`
const savings = (name, originalPaise, bps, period) => ({ type: "savings", label: name, period, ...calculateHypotheticalReduction(originalPaise, bps), hypothetical: true })

export function transactionPeriodLabel(start, end) {
  const last = shiftDay(end, -1)
  const format = (date, options) => new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))
  if (start === last) return format(start, { day: "numeric", month: "short", year: "numeric" })
  if (start.slice(0, 7) === last.slice(0, 7)) return `${Number(start.slice(8))}–${format(last, { day: "numeric", month: "long", year: "numeric" })}`
  return `${format(start, { day: "numeric", month: "short", ...(start.slice(0, 4) !== last.slice(0, 4) ? { year: "numeric" } : {}) })} – ${format(last, { day: "numeric", month: "short", year: "numeric" })}`
}

function transactionTitle(plan) {
  if (plan.intent === "largest") return "Largest Expenses"
  const { start, end } = plan.period
  if (end === shiftDay(start, 1)) return start === plan.asOf ? "Today's Expenses" : start === shiftDay(plan.asOf, -1) ? "Yesterday's Expenses" : "Daily Expenses"
  const week = (Number(start.slice(8)) - 1) / 7
  if (Number.isInteger(week) && week >= 0 && week < 4 && end === shiftDay(start, 7)) return `${["First", "Second", "Third", "Fourth"][week]} Week Expenses`
  return "Expenses"
}

// One program-owned projection for both list orders. Keys encode canonical IDs
// without displaying them or adding them to provider evidence. Missing IDs in
// legacy local feeds use their position in the canonical feed, never row values.
export function transactionListBlock(stats, plan, records) {
  const ranked = plan.intent === "largest"
  const key = (record) => record.id ? `tx-${Array.from(record.id, (char) => char.codePointAt(0).toString(16)).join("-")}` : `legacy-${stats.expenses.indexOf(record)}`
  return { type: ranked ? "ranked_expenses" : "transaction_list", label: transactionTitle(plan), period: `${transactionPeriodLabel(plan.period.start, plan.period.end)}${plan.period.end > shiftDay(plan.asOf, 1) ? " · incomplete period" : ""}`, start: plan.period.start, end: plan.period.end,
    category: plan.category || null, method: plan.method || null, totalPaise: stats.expensePaise, totalCount: stats.expenses.length,
    items: records.slice(0, ranked ? 5 : 50).map((record) => ({ rowKey: key(record), category: record.category, amountPaise: record.paise, date: record.date, method: record.method, share: stats.expensePaise ? Math.round(record.paise / stats.expensePaise * 1000) / 10 : null })) }
}

export function buildFinancialBlockCatalog(analysis, plan, prefix = "q0") {
  const catalog = {}, blocks = [], allowedActions = []
  if (!analysis.stats || !plan.period) return { catalog, blocks, allowedActions }
  const { stats } = analysis, period = periodLabel(plan)
  const put = (id, block, factKeys = []) => { catalog[`${prefix}_${id}`] = { block, factKeys: factKeys.map((key) => `${prefix}_${key}`) }; return block }
  const expense = put("expenses", { type: "metric", label: plan.category ? `${plan.category} expenses` : "Recorded expenses", semantic: "expense", amountPaise: stats.expensePaise, period }, ["current_expenses"])
  const income = put("income", { type: "metric", label: "Recorded income", semantic: "income", amountPaise: stats.incomePaise, period }, ["current_income"])
  const net = put("net", { type: "metric", label: "Net cash flow", semantic: "net", amountPaise: stats.netPaise, period }, ["current_net"])
  const top = stats.categories.slice(0, 5)
  const denominator = plan.intent === "percentages" ? stats.incomePaise : stats.expensePaise
  const categories = top.length ? put("categories", { type: "categories", period, basis: plan.intent === "percentages" ? "income" : "expenses", totalPaise: denominator,
    items: top.map((category) => ({ label: category.name, amountPaise: category.paise, share: denominator ? Math.round(category.paise / denominator * 1000) / 10 : null })), otherCount: Math.max(0, stats.categories.length - top.length) }, ["current_expenses", ...top.flatMap((_, i) => [`c${i}_name`, `c${i}_amount`])]) : null
  if (plan.reductionBps == null) top.forEach((category, i) => {
    for (const rate of [10, 20]) put(`c${i}_cut${rate}`, savings(category.name, category.paise, rate * 100, period), [`c${i}_cut${rate}`, `cut${rate}_rate`])
  })
  const requestedSaving = plan.reductionBps != null ? put("reduction", savings(plan.category || "Selected expenses", stats.expensePaise, plan.reductionBps, period), ["reduction_rate", "reduction_amount", "reduction_remaining"]) : null
  for (const card of analysis.cards) put(`comparison_${card.id}`, comparisonBlock({ ...card, id: `${prefix}_${card.id}` }), ["comparison_previous_period", "comparison_current_period", "comparison_previous_amount", "comparison_current_amount", "comparison_change", "comparison_percentage"])
  if (analysis.empty) {
    blocks.push({ type: "paragraph", text: `No recorded ${plan.intent === "income" ? "income" : "expenses"} match this scope.` }, { type: "notice", tone: "caution", text: "There is not enough recorded data to draw a conclusion about your actual finances." })
    allowedActions.push("transactions")
  } else if (requestedSaving) {
    blocks.push(expense, requestedSaving)
    allowedActions.push("transactions")
  } else if (plan.task === "reduce") {
    blocks.push({ type: "heading", text: "Ways to make room" })
    top.slice(0, 3).forEach((category, i) => blocks.push({ type: "recommendation", title: `Review ${category.name}`, text: "If this cost is flexible, consider a smaller spending limit. Protect essential expenses.", estimate: catalog[`${prefix}_c${i}_cut10`].block }))
    blocks.push({ type: "notice", tone: "caution", text: "These are separate hypothetical options for this period, not guaranteed or achieved savings." })
    allowedActions.push("analytics")
  } else if (analysis.cards.length) {
    blocks.push(...analysis.cards.map((card) => catalog[`${prefix}_comparison_${card.id}`].block))
    allowedActions.push("analytics")
  } else if (plan.intent === "cashflow") {
    blocks.push(income, expense, net, { type: "paragraph", text: "Net cash flow is recorded income minus expenses, not your account balance." })
    allowedActions.push("analytics")
  } else if (["breakdown", "categories", "percentages"].includes(plan.intent) && categories) {
    blocks.push(categories)
    allowedActions.push("analytics", "transactions")
  } else if (["list", "largest"].includes(plan.intent)) {
    const ordered = plan.intent === "largest" ? stats.largest : [...stats.expenses].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    const shown = ordered.slice(0, plan.intent === "largest" ? 5 : 50)
    if (shown.length) blocks.push(transactionListBlock(stats, plan, shown))
    allowedActions.push("transactions")
  } else {
    blocks.push(plan.intent === "income" ? income : expense)
    allowedActions.push("transactions")
  }
  return { catalog, blocks, allowedActions }
}

export function buildFinancialPresentation(analysis, plan) {
  const result = buildFinancialBlockCatalog(analysis, plan)
  return responsePresentation([...result.blocks, ...(result.allowedActions.length ? [{ type: "actions", ids: result.allowedActions }] : [])])
}
