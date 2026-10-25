import { TRANSACTION_CATEGORIES } from "../../components/transactions/transactionCategories.js"
import { normalizeQuestion, isContinuation, hasUnresolvedMeaning, localConversationReply } from "./questionLanguage.js"

export const MAX_RETRIEVAL_MONTHS = 36
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
const monthPattern = MONTHS.map((name) => `${name.slice(0, 3)}(?:${name.slice(3)})?`).join("|")
const counts = { one: 1, two: 2, three: 3, six: 6, twelve: 12, eighteen: 18, twentyfour: 24, thirtysix: 36 }
const aliases = { "Food & Dining": ["food", "dining", "groceries"], Transport: ["transport", "transportation"], Subscription: ["subscription", "subscriptions"], Healthcare: ["healthcare", "health"], Housing: ["housing", "rent"], Utilities: ["utilities", "bills"] }
const normalize = normalizeQuestion
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const contains = (question, value) => new RegExp(`(?:^|[^a-z0-9])${escape(normalize(value))}(?=$|[^a-z0-9])`, "i").test(question)

export function localDateKey(date = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date)
  const get = (type) => parts.find((part) => part.type === type).value
  return `${get("year")}-${get("month")}-${get("day")}`
}
export const monthStart = (month) => `${month.slice(0, 7)}-01`
export function shiftMonth(month, offset) {
  const [year, number] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, number - 1 + offset, 1))
  return date.toISOString().slice(0, 10)
}
export function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
const monthLabel = (month) => new Date(`${monthStart(month)}T12:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" })
export function monthsBetween(start, end) {
  const a = start.slice(0, 7).split("-").map(Number)
  const b = end.slice(0, 7).split("-").map(Number)
  return (b[0] - a[0]) * 12 + b[1] - a[1]
}
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
const period = (start, end, label) => ({ start, end, label })

function resolvePeriod(question, asOf, previous, broad) {
  const current = monthStart(asOf)
  const year = Number(asOf.slice(0, 4))
  const compare = /compar|\bversus\b|\bvs\b|increas|decreas|higher|lower|more than|less than|spend(?:ing)? (?:more|less)|improv/.test(question) && !/income\s+(?:versus|vs|and)\s+expenses?/.test(question)
  const dates = [...question.matchAll(/\b((?:19|20)\d{2}-\d{2}(?:-\d{2})?)\b/g)].map((match) => match[1])
  const naturalDay = new RegExp(`\\b\\d{1,2}\\s+(?:${monthPattern})\\b|\\b(?:${monthPattern})\\s+(?:[0-2]?\\d|3[01])\\b`)
  if (!dates.length && (/quarter|fortnight/.test(question) || naturalDay.test(question))) return { error: "Please specify that day or quarter range with ISO dates (YYYY-MM-DD) so I can preserve the exact requested boundaries." }
  let selected, comparison
  if (dates.length) {
    if (dates.length > 2 || dates.some((date) => !validDate(date.length === 7 ? `${date}-01` : date))) return { error: "Please use valid dates, for example from 2025-01-01 to 2025-12-31." }
    const first = dates[0].length === 7 ? `${dates[0]}-01` : dates[0]
    if (dates.length === 2 && compare && !/\bfrom\b|\bthrough\b|\bbetween\b/.test(question)) {
      selected = dates[0].length === 7 ? period(monthStart(first), shiftMonth(first, 1), monthLabel(first)) : period(first, shiftDay(first, 1), first)
      const second = dates[1].length === 7 ? `${dates[1]}-01` : dates[1]
      comparison = dates[1].length === 7 ? period(second, shiftMonth(second, 1), monthLabel(second)) : period(second, shiftDay(second, 1), second)
    } else {
      const last = dates.at(-1)
      const end = dates.length === 1 && /\bsince\b/.test(question) ? shiftDay(asOf, 1) : last.length === 7 ? shiftMonth(last, 1) : shiftDay(last, 1)
      selected = period(first, end, dates.length === 1 && !/\bsince\b/.test(question) ? (first === last ? first : monthLabel(first)) : `${first} through ${shiftDay(end, -1)}`)
    }
  } else if (/\ball time\b|entire history|all (?:my )?history|ever\b/.test(question)) {
    return { error: `Please choose a date range of up to ${MAX_RETRIEVAL_MONTHS} calendar months so I can retrieve the complete requested period safely.` }
  } else if (/\btoday\b|\byesterday\b/.test(question)) {
    const day = /yesterday/.test(question) ? shiftDay(asOf, -1) : asOf
    selected = period(day, shiftDay(day, 1), day)
  } else if (/\b(?:this|current|last|previous) week\b/.test(question)) {
    const weekday = (new Date(`${asOf}T12:00:00Z`).getUTCDay() + 6) % 7
    const monday = shiftDay(asOf, -weekday)
    const start = /(?:last|previous) week/.test(question) && !compare ? shiftDay(monday, -7) : monday
    selected = period(start, shiftDay(start, 7), `${start} through ${shiftDay(start, 6)} (Monday–Sunday)`)
    if (compare) comparison = period(shiftDay(start, -7), start, `${shiftDay(start, -7)} through ${shiftDay(start, -1)} (Monday–Sunday)`)
  } else if (/\b(?:last|past)\s+(\d+|seven|thirty)\s+days?\b/.test(question)) {
    const value = question.match(/\b(?:last|past)\s+(\d+|seven|thirty)\s+days?\b/)[1]
    const days = Number(value) || { seven: 7, thirty: 30 }[value]
    if (!days || days > 366) return { error: "Please choose a day range of up to 366 days, or use named calendar months." }
    const start = shiftDay(asOf, 1 - days)
    selected = period(start, shiftDay(asOf, 1), `${start} through ${asOf} (including today)`)
  } else if (/\b(?:last|past)\s+([\w]+)\s+months?\b/.test(question)) {
    const value = question.match(/\b(?:last|past)\s+([\w]+)\s+months?\b/)[1]
    const count = Number(value) || counts[value]
    if (!count || count > MAX_RETRIEVAL_MONTHS) return { error: `I can analyse up to ${MAX_RETRIEVAL_MONTHS} calendar months at a time. Please choose a smaller explicit range.` }
    selected = period(shiftMonth(current, 1 - count), shiftMonth(current, 1), `${count} calendar months including ${monthLabel(current)} to date`)
  } else {
    const named = [...question.matchAll(new RegExp(`\\b(${monthPattern})\\b(?:\\s+((?:19|20)\\d{2}))?`, "g"))]
    const years = [...question.matchAll(/\b((?:19|20)\d{2})\b/g)].map((match) => Number(match[1]))
    if (named.length) {
      const resolve = (match) => {
        const number = MONTHS.findIndex((name) => name.startsWith(match[1].slice(0, 3))) + 1
        const selectedYear = Number(match[2]) || years.at(-1) || (number > Number(current.slice(5, 7)) ? year - 1 : year)
        return `${selectedYear}-${String(number).padStart(2, "0")}-01`
      }
      if (named.length > 2) return { error: "Please ask about one period or a comparison between two periods." }
      const first = resolve(named[0])
      if (named.length === 2 && !compare) {
        const last = resolve(named[1])
        selected = period(first, shiftMonth(last, 1), `${monthLabel(first)} through ${monthLabel(last)}`)
      } else {
        selected = period(first, shiftMonth(first, 1), monthLabel(first))
        if (named[1]) { const second = resolve(named[1]); comparison = period(second, shiftMonth(second, 1), monthLabel(second)) }
      }
    } else if (/\blast year\b|\bprevious year\b|\bthis year\b|\bytd\b|year to date/.test(question) || years.length) {
      if (years.length > 2) return { error: "Please choose one year or a comparison between two years." }
      const selectedYear = years[0] || (/\b(?:last|previous) year\b/.test(question) && !/\bthis year\b/.test(question) ? year - 1 : year)
      const endingYear = years.length === 2 && !compare ? years[1] : selectedYear
      selected = period(`${selectedYear}-01-01`, `${endingYear + 1}-01-01`, `${selectedYear}${endingYear !== selectedYear ? " through " + endingYear : selectedYear === year ? " to date" : ""}`)
      if (compare) { const other = years[1] || selectedYear - 1; comparison = period(`${other}-01-01`, `${other + 1}-01-01`, String(other)) }
    } else if (/\blast month\b|\bprevious month\b/.test(question) && (!compare || !/\b(?:with|versus|vs)\s+(?:last|previous) month\b|\bthis month\b/.test(question))) {
      const start = shiftMonth(current, -1)
      selected = period(start, current, monthLabel(start))
    } else if (/month before that/.test(question) && previous) {
      const start = shiftMonth(previous.period.start, -1)
      selected = period(start, shiftMonth(start, 1), monthLabel(start))
    } else if (/\bweek\b|\bweeks\b|quarter|fortnight|\bdays\b|\byears\b/.test(question)) {
      return { error: "Please specify that period with dates (YYYY-MM-DD), named months, a year, or a number of calendar months." }
    } else if (/\bthis month\b|\bcurrent month\b/.test(question)) {
      selected = period(current, shiftMonth(current, 1), `${monthLabel(current)} to date`)
    } else if (previous && isContinuation(question)) {
      selected = previous.period
    } else {
      const start = broad ? shiftMonth(current, -5) : current
      selected = period(start, shiftMonth(current, 1), broad ? `${monthLabel(start)} through ${monthLabel(current)} to date` : `${monthLabel(current)} to date`)
    }
  }
  if (compare && !comparison && /\b(?:with|versus|vs)\s+(?:last|previous) month\b/.test(question)) {
    const start = shiftMonth(current, -1)
    comparison = period(start, current, monthLabel(start))
  }
  if (compare && !comparison) {
    if (selected.start.slice(8) !== "01" || selected.end.slice(8) !== "01") {
      const days = Math.round((Date.parse(selected.end) - Date.parse(selected.start)) / 86400000)
      comparison = period(shiftDay(selected.start, -days), selected.start, `${shiftDay(selected.start, -days)} through ${shiftDay(selected.start, -1)}`)
    } else {
      const count = Math.max(1, monthsBetween(selected.start, selected.end))
      comparison = period(shiftMonth(selected.start, -count), selected.start, count === 1 ? monthLabel(shiftMonth(selected.start, -1)) : `${count} preceding calendar months`)
    }
  }
  const start = comparison && comparison.start < selected.start ? comparison.start : selected.start
  const end = comparison && comparison.end > selected.end ? comparison.end : selected.end
  if (selected.start >= selected.end || selected.start > asOf || comparison?.start > asOf) return { error: "That period is invalid or entirely in the future. Please choose a period with recorded history." }
  if (monthsBetween(monthStart(start), shiftMonth(shiftDay(end, -1), 1)) > MAX_RETRIEVAL_MONTHS) return { error: `That request spans more than ${MAX_RETRIEVAL_MONTHS} calendar months. Please choose a smaller range; I won’t silently shorten it.` }
  const ranges = [selected, comparison].filter(Boolean).map(({ start, end }) => ({ start, end })).sort((a, b) => a.start.localeCompare(b.start))
  if (ranges.length === 2 && ranges[0].end >= ranges[1].start) ranges.splice(0, 2, { start, end })
  return { period: selected, comparison, retrieval: { start, end, ranges } }
}

function resolveOne(question, previous, { asOf, categoryNames }) {
  let text = normalize(question)
  if (!text || text.length > 1200) return { route: "clarify", message: "Please send a question of up to 1,200 characters." }
  const social = localConversationReply(question)
  if (social) return { route: "conversation", message: social, preserveContext: true }
  text = text.replace(/^(?:hi|hello|hey)(?: there)?[ ,!.]+/, "").replace(/[,! .]+(?:thanks|thank you)[!. ]*$/, "")
  const followup = isContinuation(text)
  const clarify = (message) => ({ route: "clarify", message, preserveContext: followup })
  if (followup && !previous && !/expense|spen[dt]|income|purchas|food|cash flow/.test(text)) return clarify("What spending or result do you mean? Choose expenses, income, a category, or a period to start.")
  const names = [...new Set([...categoryNames, ...TRANSACTION_CATEGORIES])].filter((name) => !["income", "other"].includes(normalize(name)) || new RegExp(`(?:category|on)\\s+${escape(normalize(name))}|${escape(normalize(name))}\\s+(?:category|expenses?)`).test(text))
  if (/\bexcluding\b|\bexcept\b|\bother than\b|\bwithout\b/.test(text)) return { route: "clarify", message: "Please ask about all categories or one named category. Exclusion filters need a more explicit supported scope so I don’t return a misleading total." }
  if (/\b(?:under|above|below|less than|more than|over)\s*(?:₹|rs|inr)?\s*\d/.test(text) || /\b(?:only|just)\s+(?:weekends|weekdays)|\b(?:merchant|person|note|description)\b/.test(text)) return clarify("I can filter by category, cash or UPI, and date. Which of those should I use? Amount, merchant and weekday filters are not supported yet.")
  if (/\bcash\b/.test(text) && /\bupi\b/.test(text)) return clarify("Do you want cash expenses, UPI expenses, or all payment methods?")
  const mentioned = new Set(names.filter((name) => contains(text, name)))
  for (const [name, values] of Object.entries(aliases)) {
    if (values.some((value) => contains(text, value)) && ![...mentioned].some((actual) => values.includes(normalize(actual)))) mentioned.add(name)
  }
  if (mentioned.size > 1) return { route: "clarify", message: "Please choose one category or ask for an all-category breakdown. I can compare periods for the selected scope without silently dropping a category." }
  let category = names.sort((a, b) => b.length - a.length).find((name) => contains(text, name)) || null
  if (!category) category = Object.entries(aliases).find(([, values]) => values.some((value) => contains(text, value)))?.[0] || null
  const explicitCategory = category
  if (!category && followup && !/all categor|all spending|all expenses/.test(text)) category = previous?.category || null
  if (!category) {
    const requested = text.match(/(?:spent|spend|spending|expenses?)\s+(?:on|for)\s+(.+?)(?=\s+(?:this|last|previous|in|during|from|since|over|paid|via)\b|[?.!]|$)/)?.[1]?.trim()
    if (requested && !/^(?:the )?(?:month|year|all categories|everything)$/.test(requested) && !/^(?:(?:19|20)\d{2}\b|this\b|last\b|past\b|previous\b|today\b|yesterday\b)/.test(requested)) category = requested
  }
  const broad = /habits|patterns|routine|improv|previous months|over time|spending trends/.test(text)
  // Currency/savings amounts such as ₹2000 are not calendar years.
  const dateText = text.replace(/(?:₹|rs\.?\s*|inr\s*|sav(?:e|ing|ings)\s+)[\d,]+(?:\.\d+)?(?:\s*(?:k|lakh|crore|thousand))?/g, " ")
  const dates = resolvePeriod(dateText, asOf, previous, broad)
  if (dates.error) return { route: "clarify", message: dates.error }
  const complex = /\bwhy\b|\bhow\b(?!\s+(?:much|many))|sav(e|ing)|\breduce\b|habits|patterns|routine|recommend|suggest|advice|improv|analy[sz]e|explain|\bshould\b|\bhelp\b/.test(text)
  if (/\btransactions?\b/.test(text) && !/expense|spen[dt]|purchas|contribut|income/.test(text) && !previous) return clarify("Should I use expense transactions or income totals? Transactions can include both; please choose a type.")
  if (/\bincome\b/.test(text) && /\blist\b|itemi[sz]e|individual|\beach\b/.test(text) && !/expense|spen[dt]/.test(text)) return clarify("I can list individual expenses or calculate income totals and comparisons. Which would you like?")
  if (/\b(?:biggest|largest|highest)\b.*\bincome\b/.test(text)) return { route: "clarify", message: "I can calculate recorded income totals and income comparisons, or show the largest expense records. Please choose which you want to explore." }
  let intent = /percent|share|consume.*income/.test(text) ? "percentages"
    : /biggest.*categor|largest.*categor|highest.*categor|top.*categor|which categor|what.*categor/.test(text) ? "categories"
    : /biggest|largest|highest|\btop\b|most expensive|contribut.*most/.test(text) ? "largest"
      : /income\s+(?:versus|vs|and)\s+expenses?|net cash|cash flow|cashflow/.test(text) ? "cashflow"
        : /percent|share|consume.*income/.test(text) ? "percentages"
          : /where.*(?:money|expenses?|spen[dt])|breakdown|rundown|by categor/.test(text) ? "breakdown"
            : /\bincome\b|\bearn(?:ed)?\b/.test(text) && !/expense|spen[dt]/.test(text) ? "income"
              : /\blist\b|itemi[sz]e|\beach\b|individual|everything.*spent|what did i (?:buy|purchase)|show.*today.*(?:expenses|purchases)|(?:show|give|all).*transactions|show all .*expenses/.test(text) ? "list"
                : dates.comparison ? "comparison" : "expenses"
  if (followup && !/biggest|largest|highest|contribut|\blist\b|individual|income|cash flow|percent|compar|total/.test(text) && previous) intent = previous.intent
  // A comparison changes the operation, while retaining the referenced metric.
  if (dates.comparison && followup && previous?.intent === "income") intent = "income"
  const supported = /spen[dt]|expenses?|purchas|\bbuy\b|transactions?|income|earn|cash flow|cashflow|money go|categor|percent|net cash|compar/.test(text) || category || (followup && previous) || /sav(e|ing)/.test(text)
  if (/\b(?:merchant|amazon|swiggy|zomato|person|note|description)\b/.test(text)) return { route: "clarify", message: "Merchant names, people and notes are excluded from financial AI retrieval. Please ask about a category, payment method, or period instead." }
  const relatedFollowup = followup && (explicitCategory || /expense|spen[dt]|purchas|income|sav|reduc|compar|contribut|month|week|today|yesterday|\b(?:it|that|those|them)\b/.test(text))
  const target = /sav(e|ing)|target/.test(text) ? text.match(/(?:₹|rs\.?\s*|inr\s*|save\s+)([\d,]+(?:\.\d+)?)(?:\s*(k|thousand|lakh|crore))?/i) : null
  if (target?.[1]?.split(".")[1]?.length > 2) return { route: "clarify", message: "Please specify a savings amount with at most two decimal places." }
  const multiplier = { k: 1000, thousand: 1000, lakh: 100000, crore: 10000000 }
  const targetPaise = target ? Math.round(Number(target[1].replaceAll(",", "")) * (multiplier[target[2]] || 1) * 100) : followup ? previous?.targetPaise || null : null
  if (target && (!Number.isSafeInteger(targetPaise) || targetPaise <= 0 || targetPaise > 9e12)) return clarify("Please choose a positive savings amount within the supported range, with at most two decimal places.")
  const method = /\bcash\b/.test(text) && !/cash flow|cashflow|net cash/.test(text) ? "cash" : /\bupi\b/.test(text) ? "upi" : /all payment|any payment/.test(text) ? null : followup ? previous?.method || null : null
  const resolved = { route: complex ? "cloud" : "local", intent, category, method,
    ...dates, targetPaise, task: /sav(e|ing)|reduce/.test(text) ? "reduce" : complex ? "analyse" : null,
    thinking: broad || /every month|routine|habit|analy[sz]e|improv/.test(text) ? "MEDIUM" : "LOW" }
  if (!supported || hasUnresolvedMeaning(text, [category, ...Object.values(aliases).flat(), "k", "thousand", "lakh", "crore"])) return { route: "interpret", message: previous && relatedFollowup ? `Do you mean the ${previous.category || "recorded expenses"} for ${previous.period.label}, or a different scope?` : "Should I total expenses, list transactions, rank categories, or compare periods? Include a date or period if needed.", preserveContext: Boolean(relatedFollowup), candidate: resolved,
    constraints: { period: new RegExp(`\\btoday\\b|yesterday|\\b(?:last|this|previous|past|current)\\b|\\b20\\d{2}\\b|\\b(?:${monthPattern})\\b`).test(dateText) ? dates.period : null, comparison: dates.comparison || null, method: /\bupi\b/.test(text) ? "upi" : /\bcash\b/.test(text) ? "cash" : null, category,
      intent: /\blist\b|individual|biggest|largest|contribut.*most/.test(text) ? intent : null } }
  return resolved
}

// Context comes from bounded user questions, never from model-selected database
// paths, client totals, or a client user ID. Literal dates override prior scope.
export function planFinancialQuestion(question, history = [], { now = new Date(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, categoryNames = [], context } = {}) {
  const asOf = localDateKey(now, timezone)
  let previous = context ? validateConversationContext(context, { asOf }) : null
  for (const message of context !== undefined ? [] : history.slice(-10)) {
    if (message.role !== "user") continue
    const plan = resolveOne(message.content, previous, { asOf, categoryNames })
    if (plan.period) previous = plan
    else if (!plan.preserveContext) previous = null
  }
  return { ...resolveOne(question, previous, { asOf, categoryNames }), asOf, timezone, at: now.getTime() }
}

export const FINANCIAL_INTENTS = ["expenses", "income", "cashflow", "list", "largest", "categories", "breakdown", "percentages", "comparison"]
const invalidScope = () => { throw Object.assign(new Error("The conversation scope is invalid. Start a new chat or specify a smaller date range."), { status: 400 }) }
function checkedPeriod(value, asOf) {
  if (!value || Object.keys(value).some((key) => !["start", "end", "label"].includes(key)) || !validDate(value.start) || !validDate(value.end) || value.start >= value.end || value.start > asOf) invalidScope()
  if (monthsBetween(monthStart(value.start), shiftMonth(shiftDay(value.end, -1), 1)) > MAX_RETRIEVAL_MONTHS) invalidScope()
  const label = value.end === shiftDay(value.start, 1) ? value.start : value.start.endsWith("-01") && value.end === shiftMonth(value.start, 1) ? monthLabel(value.start) : `${value.start} through ${shiftDay(value.end, -1)}`
  return period(value.start, value.end, label)
}

// This contract holds requested scope, never totals, records, IDs or identity.
// A client-supplied scope is untrusted intent and cannot select database paths.
export function validateConversationContext(value, { asOf }) {
  if (value == null) return null
  if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["version", "intent", "period", "comparison", "category", "method", "metric", "targetPaise", "selection"].includes(key))) invalidScope()
  if (value.version !== 1 || !FINANCIAL_INTENTS.includes(value.intent) || ![null, "cash", "upi"].includes(value.method) || !["expenses", "income", "net"].includes(value.metric)) invalidScope()
  if (value.category !== null && (typeof value.category !== "string" || !value.category.trim() || value.category.length > 80)) invalidScope()
  if (value.targetPaise != null && (!Number.isSafeInteger(value.targetPaise) || value.targetPaise <= 0 || value.targetPaise > 9e12)) invalidScope()
  const selected = checkedPeriod(value.period, asOf)
  const comparison = value.comparison ? checkedPeriod(value.comparison, asOf) : null
  const first = comparison && comparison.start < selected.start ? comparison.start : selected.start
  const last = comparison && comparison.end > selected.end ? comparison.end : selected.end
  if (monthsBetween(monthStart(first), shiftMonth(shiftDay(last, -1), 1)) > MAX_RETRIEVAL_MONTHS) invalidScope()
  const selection = value.selection
  if (selection && (Object.keys(selection).some((key) => !["kind", "order", "limit"].includes(key)) || !["scope", "transactions"].includes(selection.kind) || !["amount_desc", "date_desc"].includes(selection.order) || ![5, 50].includes(selection.limit))) invalidScope()
  return { version: 1, intent: value.intent, period: selected, comparison, category: value.category, method: value.method, metric: value.metric, targetPaise: value.targetPaise || null, selection: selection ? { kind: selection.kind, order: selection.order, limit: selection.limit } : null }
}

export function conversationContextFromPlan(plan) {
  if (!plan.period) return null
  return { version: 1, intent: plan.intent, period: plan.period, comparison: plan.comparison || null, category: plan.category, method: plan.method,
    metric: plan.intent === "income" ? "income" : plan.intent === "cashflow" ? "net" : "expenses", targetPaise: plan.targetPaise || null,
    selection: { kind: ["largest", "list"].includes(plan.intent) ? "transactions" : "scope", order: plan.intent === "largest" ? "amount_desc" : "date_desc", limit: plan.intent === "largest" ? 5 : 50 } }
}

// Gemini may propose only this typed, read-only operation. Dates and filters are
// validated here before the application constructs its fixed Firestore query.
export function validateInterpretedIntent(output, { now = new Date(), timezone, context } = {}) {
  const allowed = ["status", "intent", "start", "end", "comparisonStart", "comparisonEnd", "category", "method", "explain", "reference"]
  if (!output || Object.keys(output).some((key) => !allowed.includes(key)) || !["resolved", "clarify"].includes(output.status)) invalidScope()
  const asOf = localDateKey(now, timezone)
  if (output.status === "clarify") return { route: "clarify", message: "Which financial metric, category and period should I use? I need a more precise scope to answer that reliably.", asOf, preserveContext: Boolean(context) }
  if (!FINANCIAL_INTENTS.includes(output.intent) || typeof output.explain !== "boolean" || typeof output.reference !== "boolean" || ![null, "cash", "upi"].includes(output.method)) invalidScope()
  if (output.reference && !context) invalidScope()
  const selected = checkedPeriod({ start: output.start, end: output.end }, asOf)
  if (Boolean(output.comparisonStart) !== Boolean(output.comparisonEnd)) invalidScope()
  const comparison = output.comparisonStart ? checkedPeriod({ start: output.comparisonStart, end: output.comparisonEnd }, asOf) : null
  if (output.intent === "comparison" && !comparison) invalidScope()
  const plan = { intent: output.intent, category: output.category, method: output.method, period: selected, comparison, targetPaise: null }
  validateConversationContext(conversationContextFromPlan(plan), { asOf })
  const start = comparison && comparison.start < selected.start ? comparison.start : selected.start
  const end = comparison && comparison.end > selected.end ? comparison.end : selected.end
  const ranges = [selected, comparison].filter(Boolean).map(({ start, end }) => ({ start, end })).sort((a, b) => a.start.localeCompare(b.start))
  if (ranges.length === 2 && ranges[0].end >= ranges[1].start) ranges.splice(0, 2, { start, end })
  return { ...plan, route: output.explain ? "cloud" : "local", task: output.explain ? "analyse" : null, retrieval: { start, end, ranges }, asOf, timezone, at: now.getTime(), thinking: "LOW" }
}
