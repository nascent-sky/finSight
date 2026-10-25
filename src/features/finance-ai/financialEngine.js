import { calculateComparison, MAX_MONEY_PAISE } from "./financialContext.js"
import { formatExpenseAmount } from "../../components/analytics/expenseChartUtils.js"
import { conversationContextFromPlan, localDateKey, monthStart, monthsBetween, shiftDay, shiftMonth } from "./questionPlanner.js"
import { buildFinancialPresentation } from "./financialPresentation.js"
import { chronologicalComparison } from "./responseBlocks.js"

const money = (paise) => formatExpenseAmount(paise / 100)
const percentage = (part, total) => total ? Math.round(part / total * 1000) / 10 : null
const add = (a, b) => {
  const value = a + b
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_PAISE) throw new Error("Recorded totals exceed the supported amount range.")
  return value
}
const sum = (records) => records.reduce((total, record) => add(total, record.paise), 0)
const transactionLine = (record) => `${money(record.paise)} · ${record.category}${record.category.toLowerCase() === "income" ? " (expense category)" : ""} · ${record.date} · ${record.method.toUpperCase()}`

// The browser builds this once per canonical feed update. The backend builds it
// only from its own authenticated Firestore retrieval, never from submitted totals.
export function createFinancialIndex(transactions, { now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
  const records = []
  const seen = new Set()
  let excluded = 0
  for (const record of transactions || []) {
    if (!record || /^__finsight_/.test(String(record.id || "")) || record.isSampleData || record.isSample || record.source === "sample") continue
    if (!["income", "expense"].includes(record.type)) continue
    const instant = record.datetime ? new Date(record.datetime) : new Date(NaN)
    const amount = Number(record.amount)
    const paise = Math.round((amount + Number.EPSILON) * 100)
    if (!Number.isFinite(instant.getTime()) || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(paise) || paise <= 0 || paise > MAX_MONEY_PAISE) { excluded++; continue }
    const id = String(record.id ?? "").trim()
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const parts = formatter.formatToParts(instant)
    const date = ["year", "month", "day"].map((type) => parts.find((part) => part.type === type).value).join("-")
    const category = String(record.category || "Other").trim() || "Other"
    records.push({ id, paise, type: record.type, category, method: ["cash", "upi"].includes(record.paymentMethod) ? record.paymentMethod : "other", date, at: instant.getTime() })
  }
  return { records, categoryNames: [...new Set(records.filter((record) => record.type === "expense").map((record) => record.category))], asOf: localDateKey(now, timezone), timezone, excluded }
}

function scopeStats(index, scope, plan) {
  const all = index.records.filter((record) => record.at <= plan.at && record.date >= scope.start && record.date < scope.end && (!plan.method || record.method === plan.method))
  const expenses = all.filter((record) => record.type === "expense" && (!plan.category || record.category.toLowerCase() === plan.category.toLowerCase()))
  const income = all.filter((record) => record.type === "income")
  const categoryTotals = new Map()
  const dailyTotals = new Map()
  const months = new Map()
  for (const record of all) {
    const month = record.date.slice(0, 7)
    const bucket = months.get(month) || { incomePaise: 0, expensePaise: 0, count: 0 }
    bucket.count++
    if (record.type === "income") bucket.incomePaise = add(bucket.incomePaise, record.paise)
    else if (!plan.category || record.category.toLowerCase() === plan.category.toLowerCase()) bucket.expensePaise = add(bucket.expensePaise, record.paise)
    months.set(month, bucket)
  }
  for (const record of expenses) {
    categoryTotals.set(record.category, add(categoryTotals.get(record.category) || 0, record.paise))
    dailyTotals.set(record.date, add(dailyTotals.get(record.date) || 0, record.paise))
  }
  const incomePaise = sum(income)
  const expensePaise = sum(expenses)
  return { expenses, incomePaise, expensePaise, netPaise: incomePaise - expensePaise, count: expenses.length + income.length,
    categories: [...categoryTotals].map(([name, paise]) => ({ name, paise })).sort((a, b) => b.paise - a.paise || a.name.localeCompare(b.name)),
    largest: [...expenses].sort((a, b) => b.paise - a.paise || a.date.localeCompare(b.date)).slice(0, 5),
    days: [...dailyTotals].sort((a, b) => b[1] - a[1]), months }
}

export function analyseFinancialQuery(index, plan) {
  if (["clarify", "interpret", "conversation"].includes(plan.route)) return { answer: plan.message, cards: [], asOf: plan.asOf, source: "local", context: null }
  const stats = scopeStats(index, plan.period, plan)
  const prior = plan.comparison ? scopeStats(index, plan.comparison, plan) : null
  const hasRelevantRecords = plan.intent === "income" ? stats.incomePaise > 0 || prior?.incomePaise > 0
    : plan.intent === "cashflow" ? Boolean(stats.count || prior?.count) : Boolean(stats.expenses.length || prior?.expenses.length)
  const facts = {}
  const cards = {}
  const put = (key, label, value) => { facts[key] = { label, value: String(value) } }
  const subject = plan.category ? `${plan.category} expenses` : "Recorded expenses"
  const incomeComparison = plan.intent === "income"
  const comparisonSubject = incomeComparison ? "Recorded income" : subject
  const clippedEnd = plan.period.end > shiftDay(plan.asOf, 1) ? shiftDay(plan.asOf, 1) : plan.period.end
  const partial = clippedEnd < plan.period.end
  const note = `${plan.period.label}${partial && !/to date/.test(plan.period.label) ? " (through " + plan.asOf + ")" : ""}${prior ? ` compared with ${plan.comparison.label}` : ""}. ${plan.method ? `Payments: ${plan.method.toUpperCase()}. ` : ""}${partial ? `The current period is partial through ${plan.asOf}. ` : ""}Recorded transactions only; missing entries do not establish actual zero spending.`
  put("period", "Requested period", plan.period.label)
  put("as_of", "Records through local date", plan.asOf)
  put("category", "Selected category", plan.category || "all categories")
  put("current_expenses", `${subject}: requested period`, money(stats.expensePaise))
  put("current_income", "Recorded income for requested period", money(stats.incomePaise))
  put("current_net", "Recorded income minus selected expenses (not account balance)", money(stats.netPaise))
  put("expense_count", "Selected expense record count", stats.expenses.length)
  put("transaction_count", "Selected expenses plus income record count", stats.count)
  put("income_share", "Selected expenses as share of recorded income", stats.incomePaise ? `${percentage(stats.expensePaise, stats.incomePaise)}%` : "unavailable (no recorded income)")
  const series = []
  const count = Math.max(1, monthsBetween(monthStart(plan.period.start), shiftMonth(shiftDay(clippedEnd, -1), 1)))
  for (let index = 0; index < count; index++) {
    const month = shiftMonth(plan.period.start, index).slice(0, 7)
    series.push({ month, ...(stats.months.get(month) || { incomePaise: 0, expensePaise: 0, count: 0 }) })
  }
  const emptyMonths = series.filter((month) => month.count === 0).length
  put("empty_months", "Requested elapsed calendar months with no retrieved records (not proof of no activity)", emptyMonths)
  const sortedCategories = stats.categories
  if (["breakdown", "categories", "percentages"].includes(plan.intent) || plan.route === "cloud") {
    sortedCategories.slice(0, 10).forEach((category, index) => {
      put(`c${index}_name`, "Recorded category", category.name)
      put(`c${index}_amount`, `${category.name}: recorded expenses`, money(category.paise))
      put(`c${index}_share`, `${category.name}: share of selected expenses`, `${percentage(category.paise, stats.expensePaise)}%`)
      put(`c${index}_income_share`, `${category.name}: share of recorded income`, stats.incomePaise ? `${percentage(category.paise, stats.incomePaise)}%` : "unavailable (no recorded income)")
    })
    put("other_category_count", "Additional categories outside the top category breakdown; totals include them", Math.max(0, sortedCategories.length - 10))
  }
  if (plan.intent === "largest" || (plan.route === "cloud" && (plan.category || prior))) {
    stats.largest.forEach((record, index) => put(`t${index}`, `Selected expense ranked ${index + 1}; authoritative type expense; no merchant, note or ID shared`, transactionLine(record)))
  }
  if (plan.route === "cloud") {
    put("recorded_spending_days", "Number of days with selected expense records, not a frequency forecast", stats.days.length)
    if (stats.days.length) {
      put("peak_day", "Date with the highest selected recorded spending", stats.days[0][0])
      put("peak_day_expenses", "Selected recorded spending on that date", money(stats.days[0][1]))
      put("average_expense", "Mean amount per selected expense record, rounded to paise", money(Math.round(stats.expensePaise / stats.expenses.length)))
    }
    series.forEach((month, index) => {
      put(`month${index}_label`, "Calendar month", month.month)
      put(`month${index}_expenses`, `${month.month}: selected recorded expenses`, money(month.expensePaise))
      put(`month${index}_income`, `${month.month}: recorded income`, money(month.incomePaise))
      put(`month${index}_net`, `${month.month}: income minus selected expenses`, money(month.incomePaise - month.expensePaise))
    })
    sortedCategories.slice(0, 5).forEach((category, index) => {
      for (const cut of [10, 20]) put(`c${index}_cut${cut}`, `Hypothetical ${cut}% cut in ${category.name} over the requested period, not a promise or monthly forecast`, money(Math.round(category.paise * cut / 100)))
    })
    if (plan.targetPaise && Number.isSafeInteger(plan.targetPaise) && plan.targetPaise <= MAX_MONEY_PAISE) {
      put("savings_target", "User-requested monthly savings target", money(plan.targetPaise))
      // Only a single month can support a monthly target-to-current-cash-flow comparison.
      if (count === 1 && !plan.category && !plan.method) put("savings_gap", "Gap from this recorded month's cash flow to the monthly target; partial month is not a forecast", money(Math.max(0, plan.targetPaise - stats.netPaise)))
    }
  }
  if (prior) {
    put("previous_period", "Comparison period", plan.comparison.label)
    const comparison = calculateComparison(incomeComparison ? prior.incomePaise : prior.expensePaise, incomeComparison ? stats.incomePaise : stats.expensePaise)
    const expenseComparison = calculateComparison(prior.expensePaise, stats.expensePaise)
    put("previous_expenses", `${subject}: comparison period`, money(prior.expensePaise))
    put("expense_change", `${subject}: signed absolute change`, `${expenseComparison.changePaise > 0 ? "+" : ""}${money(expenseComparison.changePaise)}`)
    put("expense_change_percentage", `${subject}: signed percentage change`, expenseComparison.percentage == null ? "unavailable (no previous recorded amount)" : `${expenseComparison.percentage > 0 ? "+" : ""}${expenseComparison.percentage}%`)
    put("previous_income", "Recorded income for comparison period", money(prior.incomePaise))
    put("income_change", "Signed change in recorded income", money(stats.incomePaise - prior.incomePaise))
    if (hasRelevantRecords) {
      const id = incomeComparison ? "income" : "expenses"
      cards[id] = { id, title: comparisonSubject, previousLabel: plan.comparison.label, currentLabel: plan.period.label, previousStart: plan.comparison.start, currentStart: plan.period.start, metric: incomeComparison ? "income" : "expense", note, ...comparison }
      const chronological = chronologicalComparison(cards[id])
      put("comparison_previous_period", "Earlier period in the chronological comparison card", chronological.previousLabel)
      put("comparison_current_period", "Later period in the chronological comparison card", chronological.currentLabel)
      put("comparison_previous_amount", "Verified amount in the earlier comparison period", money(chronological.previousPaise))
      put("comparison_current_amount", "Verified amount in the later comparison period", money(chronological.currentPaise))
      put("comparison_change", "Verified later minus earlier amount; matches the chronological comparison card", `${chronological.changePaise > 0 ? "+" : ""}${money(chronological.changePaise)}`)
      put("comparison_percentage", "Verified chronological change percentage; N/A when the earlier recorded amount is zero", chronological.percentage == null ? "N/A" : `${chronological.percentage > 0 ? "+" : ""}${chronological.percentage}%`)
    }
    if (plan.route === "cloud" && !plan.category) {
      const names = new Set([...stats.categories, ...prior.categories].map((category) => category.name))
      const changes = [...names].map((name) => ({ name, delta: (stats.categories.find((category) => category.name === name)?.paise || 0) - (prior.categories.find((category) => category.name === name)?.paise || 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8)
      changes.forEach((change, index) => put(`driver${index}`, "Category contribution to the recorded expense change (not a proven cause)", `${change.name} · ${change.delta > 0 ? "+" : ""}${money(change.delta)}`))
    }
  }
  let answer
  if (!hasRelevantRecords) answer = `I found no recorded transactions matching this ${plan.intent === "income" ? "income" : plan.intent === "cashflow" ? "cash flow" : "expense"} question for ${plan.period.label}${plan.category ? ` in ${plan.category}` : ""}${plan.method ? ` paid by ${plan.method.toUpperCase()}` : ""}. There isn’t enough recorded data to draw a conclusion about your actual finances.`
  else if (plan.task === "reduce") {
    const candidates = stats.categories.slice(0, 3)
    answer = `For ${plan.period.label}${plan.method ? ` via ${plan.method.toUpperCase()}` : ""}, your ${plan.category || "recorded"} expenses total ${money(stats.expensePaise)}. Start by reviewing the largest costs in this scope:\n${candidates.map((category) => `• ${category.name}: ${money(category.paise)}. A hypothetical 10% reduction would free ${money(Math.round(category.paise / 10))} over this period.`).join("\n")}\nWhich of these costs are flexible? Protect essential expenses; these scenarios are not guaranteed savings.${plan.targetPaise ? ` Your requested target is ${money(plan.targetPaise)}; these records alone cannot establish whether it is achievable.` : ""}`
  }
  else if (plan.intent === "list") {
    const ordered = [...stats.expenses].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
    const shown = ordered.slice(0, 50)
    answer = `${stats.expenses.length} recorded expense${stats.expenses.length === 1 ? "" : "s"} for ${plan.period.label}${plan.category ? ` in ${plan.category}` : ""}${plan.method ? ` via ${plan.method.toUpperCase()}` : ""}, totalling ${money(stats.expensePaise)}:\n${shown.map((record) => `• ${transactionLine(record)}`).join("\n")}${ordered.length > shown.length ? `\nShowing the latest ${shown.length} of ${ordered.length} matching expenses. Narrow the date range to see the remaining records; the total includes all matches.` : ""}`
  }
  else if (plan.intent === "largest") answer = stats.largest.length ? `Your largest recorded expenses for ${plan.period.label}${plan.category ? ` in ${plan.category}` : ""}${plan.method ? ` via ${plan.method.toUpperCase()}` : ""}:\n${stats.largest.map((record) => `• ${transactionLine(record)}`).join("\n")}${stats.expenses.length > 5 ? `\nShowing the largest 5 of ${stats.expenses.length} matching expenses.` : ""}` : `No matching expense records were found for ${plan.period.label}.`
  else if (plan.intent === "cashflow") answer = `For ${plan.period.label}, you recorded ${money(stats.incomePaise)} in income and ${money(stats.expensePaise)} in expenses. Net cash flow is ${money(stats.netPaise)}. This is not your account balance.`
  else if (plan.intent === "income" && !prior) answer = `You recorded ${money(stats.incomePaise)} in income for ${plan.period.label}.`
  else if (["categories", "breakdown", "percentages"].includes(plan.intent) && !prior) answer = stats.categories.length ? `Your recorded spending for ${plan.period.label}${plan.method ? ` via ${plan.method.toUpperCase()}` : ""} totals ${money(stats.expensePaise)}.\n${stats.categories.slice(0, 5).map((category) => `• ${category.name}: ${money(category.paise)} (${plan.intent === "percentages" ? stats.incomePaise ? `${percentage(category.paise, stats.incomePaise)}% of recorded income` : "income share unavailable: no recorded income" : `${percentage(category.paise, stats.expensePaise)}% of recorded expenses`})`).join("\n")}${stats.categories.length > 5 ? "\nThis list shows the largest categories; the total includes every matching category." : ""}` : `There are no matching recorded expenses for ${plan.period.label}.`
  else if (prior) {
    const before = incomeComparison ? prior.incomePaise : prior.expensePaise
    const after = incomeComparison ? stats.incomePaise : stats.expensePaise
    const change = calculateComparison(before, after)
    answer = `${comparisonSubject} ${incomeComparison ? "was" : "were"} ${money(after)} for ${plan.period.label}, compared with ${money(before)} for ${plan.comparison.label}. ${change.changePaise === 0 ? "The recorded amounts are unchanged." : `That is ${money(Math.abs(change.changePaise))} ${change.changePaise > 0 ? "more" : "less"}${change.percentage == null ? "; a percentage change is unavailable without a previous recorded amount" : ` (${Math.abs(change.percentage)}%)`}.`}`
  } else answer = `You recorded ${money(stats.expensePaise)} in ${plan.category ? `${plan.category} expenses` : "expenses"} for ${plan.period.label}${plan.method ? ` via ${plan.method.toUpperCase()}` : ""}.`
  if (hasRelevantRecords && plan.task === "analyse" && prior && plan.intent !== "income") {
    const drivers = stats.categories.map((category) => ({ ...category, change: category.paise - (prior.categories.find((other) => other.name === category.name)?.paise || 0) })).filter((category) => category.change > 0).sort((a, b) => b.change - a.change).slice(0, 3)
    if (drivers.length) answer += `\nLargest recorded category increases:\n${drivers.map((category) => `• ${category.name}: +${money(category.change)}`).join("\n")}\nThese entries show contributions to the change; they do not establish why the spending occurred.`
  }
  if (hasRelevantRecords && partial && !/to date/.test(plan.period.label)) answer += `\n\nRecords through ${plan.asOf}; this period is incomplete.`
  const analysis = { answer, cards: Object.values(cards), facts, cardMap: cards, stats, series, empty: !hasRelevantRecords, note, asOf: plan.asOf, source: "local", context: conversationContextFromPlan(plan) }
  analysis.presentation = buildFinancialPresentation(analysis, plan)
  return analysis
}

export function publicFinancialAnswer(analysis) {
  return { answer: analysis.answer, cards: analysis.cards, asOf: analysis.asOf, source: analysis.source, context: analysis.context, ...(analysis.presentation ? { presentation: analysis.presentation } : {}) }
}
