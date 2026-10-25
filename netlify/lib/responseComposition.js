import { buildFinancialBlockCatalog } from "../../src/features/finance-ai/financialPresentation.js"
import { calculateHypotheticalReduction } from "../../src/features/finance-ai/financialContext.js"
import { formatExpenseAmount } from "../../src/components/analytics/expenseChartUtils.js"
const reviewCategories = new Set(["shopping", "entertainment"])
const scenarioKey = (block) => JSON.stringify([block.label, block.period, block.originalPaise, block.savingPaise, block.remainingPaise, block.reductionBps])
const scopeKey = (plan) => JSON.stringify([plan.period.start, plan.period.end, plan.category, plan.method, plan.comparison?.start, plan.comparison?.end])

// Presentation opt-in only: this never changes routing, query scope or tools.
export function purchaseDeferralRequested(question = "") {
  const text = question.toLowerCase()
  const cue = /\b(?:defer(?:red|ring)?|deferral|postpon(?:e|ing)|delay(?:ing)?|skip(?:ping)?|cancel(?:ling|ing)?)\b/.exec(text)
  if (!cue || /\b(?:not|never|without|don't|do not|avoid)\b(?:\s+\w+){0,3}\s*$/.test(text.slice(Math.max(0, cue.index - 40), cue.index))) return false
  return /\b(?:purchase|transaction|item|shopping)\b/.test(text) || /\b(?:that|the)\s+deferral\s+(?:option|scenario)\b/.test(text)
}

// Cloud-only presentation policy. The local/guest engine's layouts and maths
// are unchanged; these resources project its verified records and totals.
export function prepareCloudLayout(analysis, plan, prefix = "q0", extraCatalog = {}, { allowPurchaseDeferral = false } = {}) {
  const base = buildFinancialBlockCatalog(analysis, plan, prefix)
  const source = { ...base.catalog, ...extraCatalog }, catalog = {}, defaultIds = []
  const scope = scopeKey(plan)
  const mode = plan.reductionBps != null ? "scenario" : analysis.empty ? "empty" : plan.task === "reduce" ? "recommendations" : ["list", "largest"].includes(plan.intent) ? "records" : analysis.cards.length ? "comparison" : plan.intent === "cashflow" ? "cashflow" : ["categories", "breakdown", "percentages"].includes(plan.intent) ? "breakdown" : "total"
  const put = (id, block, factKeys = [], role = block.type, primary = true) => {
    if (plan.method && block.period) block = { ...block, period: `${block.period} · ${plan.method.toUpperCase()}` }
    if (plan.method && block.estimate) block = { ...block, estimate: { ...block.estimate, period: `${block.estimate.period} · ${plan.method.toUpperCase()}` } }
    catalog[id] = { block, factKeys, scope, role }
    if (primary) defaultIds.push(id)
  }
  if (mode === "scenario") {
    for (const id of [`${prefix}_expenses`, `${prefix}_reduction`]) {
      const resource = source[id]
      if (resource) put(id, resource.block, resource.factKeys)
    }
  } else if (mode === "recommendations") {
    const reviewRecords = plan.intent === "largest" ? analysis.stats.largest : analysis.stats.expenses
    const candidates = analysis.stats.categories.filter((category) => reviewCategories.has(category.name.toLowerCase()) && reviewRecords.some((record) => record.category === category.name)).slice(0, 2)
    const estimates = []
    candidates.forEach((category, i) => {
      const categoryRecords = reviewRecords.filter((record) => record.category === category.name)
      const evidence = [...categoryRecords].sort((a, b) => b.paise - a.paise || a.date.localeCompare(b.date))[0]
      if (!evidence) return
      const period = base.catalog[`${prefix}_expenses`].block.period
      const originalPaise = categoryRecords.reduce((sum, record) => sum + record.paise, 0)
      const gradual = calculateHypotheticalReduction(originalPaise, 2000)
      const smaller = calculateHypotheticalReduction(originalPaise, 1000)
      const estimate = allowPurchaseDeferral
        ? { type: "savings", label: `One optional ${category.name} purchase`, period, originalPaise, savingPaise: evidence.paise, remainingPaise: originalPaise - evidence.paise, reductionBps: null, hypothetical: true }
        : { type: "savings", label: `Gradual ${category.name} reduction`, period, ...gradual, hypothetical: true }
      const count = categoryRecords.length
      const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${evidence.date}T12:00:00Z`))
      const detail = allowPurchaseDeferral ? `If the purchase on ${date} was optional, consider deferring a similar purchase; this does not assume every purchase is flexible.`
        : plan.targetPaise ? "Review which part is flexible before choosing a limit; keep essential purchases protected."
          : `If part of this spending is flexible, a 10% scenario would save ${formatExpenseAmount(smaller.savingPaise / 100)}. Compare it with the 20% option below; neither assumes eliminating the category.`
      const recommendation = { type: "recommendation", title: `Review ${category.name} purchases`, text: `${count} ${plan.intent === "largest" ? "selected" : "recorded"} ${category.name} purchase${count === 1 ? "" : "s"} in this period. ${detail}`, ...(plan.targetPaise ? {} : { estimate }) }
      put(`${prefix}_review${i}`, recommendation)
      if (!plan.targetPaise) { put(`${prefix}_review${i}_estimate`, estimate, [], "embedded_estimate", false); estimates.push(estimate) }
    })
    put(`${prefix}_protect`, { type: "recommendation", title: candidates.length ? "Set a limit after checking flexibility" : "Review flexibility before choosing cuts", text: "Protect healthcare, education and essential food or transport. Compare like-for-like costs before choosing a spending limit; recorded amounts alone do not show which costs are safe to reduce." })
    const target = source[`${prefix}_target_plan`]
    if (plan.targetPaise && target) put(`${prefix}_target_plan`, { ...target.block, label: "Illustrative target scenario; flexibility unconfirmed" }, target.factKeys, "summary")
    else if (estimates.length > 1) {
      const originalPaise = estimates.reduce((sum, item) => sum + item.originalPaise, 0), savingPaise = estimates.reduce((sum, item) => sum + item.savingPaise, 0)
      put(`${prefix}_savings_summary`, { type: "savings", label: allowPurchaseDeferral ? "Combined optional-purchase scenario" : "Combined gradual-reduction scenario", period: estimates[0].period, originalPaise, savingPaise, remainingPaise: originalPaise - savingPaise, reductionBps: null, hypothetical: true }, [], "summary")
    }
  } else {
    base.blocks.forEach((block, i) => {
      const match = Object.entries(base.catalog).find(([, resource]) => resource.block === block)
      put(match?.[0] || `${prefix}_detail${i}`, block, match?.[1].factKeys || [], mode === "records" ? "record_context" : block.type)
    })
  }
  return { catalog, blocks: defaultIds.map((id) => catalog[id].block), allowedActions: base.allowedActions, policy: { mode, scope, defaultIds, narrative: mode === "records" ? "One short introduction; FinSight renders every selected transaction. Do not list records, amounts or dates." : mode === "recommendations" ? "One or two sentences explaining priorities. FinSight renders the recommendations and conditional estimates; do not repeat their category-by-category details, percentages or savings figures." : mode === "comparison" ? "One or two sentences explaining the chronological change. Use only comparison_* facts for the displayed trend." : "One or two useful sentences. Do not reproduce the prepared card as a second report." } }
}

// Identity includes scope and financial role, not just amount or object shape.
// Thus equal totals in distinct categories/methods/periods remain distinct.
function identity(resource) {
  const { block, scope = "" } = resource
  if (block.type === "metric") return JSON.stringify([scope, block.type, block.semantic, block.amountPaise, block.period])
  if (block.type === "comparison") { const c = block.card; return JSON.stringify([scope, block.type, c.metric, c.previousStart || c.previousLabel, c.currentStart || c.currentLabel, c.previousPaise, c.currentPaise]) }
  if (block.type === "savings") return JSON.stringify([scope, block.type, scenarioKey(block)])
  return JSON.stringify([scope, block])
}

export function selectPreparedBlocks({ catalog, defaultBlocks, suggested, policies = [], recordsAppended = false }) {
  const prepared = policies.length ? policies.flatMap((policy) => policy.defaultIds.map((id) => catalog[id]).filter(Boolean)) : defaultBlocks.map((block) => ({ block }))
  const candidates = [...prepared, ...suggested], seen = new Set(), selected = []
  const embedded = new Set(prepared.filter(({ block }) => block.type === "recommendation" && block.estimate).map(({ block, scope = "" }) => JSON.stringify([scope, scenarioKey(block.estimate)])))
  let recommendations = 0, comparisons = 0
  for (const resource of candidates) {
    const { block, scope = "", role } = resource
    if (recordsAppended && (role === "record_context" || !policies.length && ["list", "paragraph", "transaction_list", "ranked_expenses"].includes(block.type))) continue
    if (role === "embedded_estimate" || block.type === "savings" && embedded.has(JSON.stringify([scope, scenarioKey(block)]))) continue
    if (block.type === "recommendation" && recommendations >= 3 || block.type === "comparison" && comparisons >= 2) continue
    const key = identity(resource)
    if (seen.has(key)) continue
    seen.add(key); selected.push(resource)
    if (block.type === "recommendation") recommendations++
    if (block.type === "comparison") comparisons++
  }
  // A breakdown already contains its total. Keep one representation of that
  // scope, while retaining genuinely different income/net metrics.
  return selected.filter(({ block, scope = "" }) => block.type !== "metric" || !selected.some((other) => block.semantic === "expense" && other.coversScopes?.includes(scope) || other.block.type === "categories" && (other.scope || "") === scope && other.block.basis === (block.semantic === "income" ? "income" : "expenses") && block.semantic !== "net" && other.block.totalPaise === block.amountPaise))
}

export function narrativeFacts(facts, policies) {
  const records = new Set(policies.filter((policy) => policy.mode === "records").map((policy) => policy.defaultIds[0]?.split("_")[0]))
  const reductions = new Set(policies.filter((policy) => policy.mode === "recommendations").map((policy) => policy.defaultIds[0]?.split("_")[0]))
  const comparisons = new Set(policies.filter((policy) => policy.mode === "comparison").map((policy) => policy.defaultIds[0]?.split("_")[0]))
  return Object.fromEntries(Object.entries(facts).filter(([key]) => !([...records].some((prefix) => key.startsWith(`${prefix}_`) && !/_(?:record_status|expense_count|transaction_count|shown_records|omitted_records|current_expenses|period)$/.test(key)) || [...reductions].some((prefix) => key.startsWith(`${prefix}_c`) && /_cut(?:10|20)$/.test(key) || key.startsWith(`${prefix}_cut`)) || [...comparisons].some((prefix) => key.startsWith(`${prefix}_`) && !key.startsWith(`${prefix}_comparison_`) && !key.startsWith(`${prefix}_driver`) && key !== `${prefix}_record_status`))))
}

// Exact structured-data overlap only. Mixed explanatory/advice text survives;
// no keywords or guessed financial meaning are removed from generated prose.
export function uniqueNarrativeBlocks(narrative, prepared, recordValues = []) {
  const normalize = (text) => text.replaceAll("**", "").replace(/\s+/g, " ").trim().toLowerCase()
  const owned = new Set([...recordValues, ...prepared.flatMap((block) => block.type === "list" ? block.items : ["paragraph", "heading"].includes(block.type) ? [block.text] : [])].map(normalize))
  return narrative.flatMap((block) => {
    if (block.type === "list") { const items = block.items.filter((item) => !owned.has(normalize(item))); return items.length ? [{ ...block, items }] : [] }
    return ["paragraph", "heading"].includes(block.type) && owned.has(normalize(block.text)) ? [] : [block]
  })
}

// Navigation follows verified records in both successful and recovered replies.
export function appendOwnedBlocks(blocks, ownedBlocks) {
  if (!ownedBlocks.some((block) => ["ranked_expenses", "transaction_list"].includes(block.type))) return [...blocks, ...ownedBlocks]
  return [...blocks.filter((block) => block.type !== "actions"), ...ownedBlocks, ...blocks.filter((block) => block.type === "actions")]
}
