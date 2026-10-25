import { modelValidationError } from "./modelValidation.js"
import { chronologicalComparison } from "../../src/features/finance-ai/responseBlocks.js"
import { formatExpenseAmount } from "../../src/components/analytics/expenseChartUtils.js"
import { NARRATIVE_CONTRADICTION_RULES } from "../../src/features/finance-ai/financeRouting.js"

export const NARRATIVE_CONTRADICTIONS = NARRATIVE_CONTRADICTION_RULES
export const isNarrativeContradiction = (error) => error?.origin === "model_output" && NARRATIVE_CONTRADICTIONS.includes(error.validation?.rule)
const money = (paise) => formatExpenseAmount(paise / 100)
const normalized = (text) => text.toLowerCase().replace(/\s+/g, " ").trim()
const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, i, 1))))
const mentionsMonth = (text, month) => month === "May" ? /\bMay\b|\b(?:in|during|for)\s+may\b/.test(text) : new RegExp(`\\b${month}\\b`, "i").test(text)

// A typed receipt of the CURRENT authenticated tool results, never chat history
// or model-provided totals. Notes, identities and transaction IDs are excluded.
export function buildNarrativeEvidence(index, plan, analysis, id = "q0") {
  const scope = (range, key) => {
    if (!index && key === "previous") {
      const card = analysis.cards[0], amount = card && (card.previousStart === range.start ? card.previousPaise : card.currentPaise)
      return { key, start: range.start, end: range.end, label: range.label, category: plan.category, method: plan.method, recordCount: null, hasRecords: amount == null ? null : amount > 0, expenseCount: null, expenseTotalPaise: card?.metric !== "income" ? amount ?? null : null, incomeCount: null, incomeTotalPaise: card?.metric === "income" ? amount ?? null : null, categories: [], categoriesComplete: false }
    }
    const rows = (index?.records || analysis.stats.expenses).filter((record) => record.at <= plan.at && record.date >= range.start && record.date < range.end && (!plan.method || record.method === plan.method))
    const expenses = rows.filter((record) => record.type === "expense" && (!plan.category || record.category.toLowerCase() === plan.category.toLowerCase()))
    const income = rows.filter((record) => record.type === "income")
    const categories = new Map()
    for (const row of expenses) {
      const entry = categories.get(row.category) || { name: row.category, recordCount: 0, amountPaise: 0 }
      entry.recordCount++; entry.amountPaise += row.paise; categories.set(row.category, entry)
    }
    const incomeCount = index ? income.length : analysis.stats.count - analysis.stats.expenses.length
    const incomeTotalPaise = index ? income.reduce((sum, row) => sum + row.paise, 0) : analysis.stats.incomePaise
    const recordCount = plan.intent === "income" ? incomeCount : plan.intent === "cashflow" ? expenses.length + incomeCount : expenses.length
    return { key, start: range.start, end: range.end, label: range.label, category: plan.category, method: plan.method, recordCount, hasRecords: recordCount > 0,
      expenseCount: expenses.length, expenseTotalPaise: expenses.reduce((sum, row) => sum + row.paise, 0), incomeCount, incomeTotalPaise,
      categories: [...categories.values()].sort((a, b) => b.amountPaise - a.amountPaise || a.name.localeCompare(b.name)), categoriesComplete: true }
  }
  const ranked = plan.intent === "income" ? (index?.records || []).filter((row) => row.type === "income" && row.at <= plan.at && row.date >= plan.period.start && row.date < plan.period.end && (!plan.method || row.method === plan.method)).sort((a, b) => b.paise - a.paise).slice(0, 5) : plan.intent === "list" ? [...analysis.stats.expenses].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, 5) : analysis.stats.largest
  return { id, authority: "current_verified_tools", intent: plan.intent, task: plan.task, asOf: plan.asOf,
    current: scope(plan.period, "current"), previous: plan.comparison ? scope(plan.comparison, "previous") : null,
    comparisons: analysis.cards.map(chronologicalComparison),
    rankingMetric: plan.intent === "income" ? "income" : "expense", rankingOrder: plan.intent === "list" ? "date_descending" : "amount_descending", rankedTransactions: ranked.map((row, rank) => ({ rank: rank + 1, amountPaise: row.paise, category: row.category, date: row.date, paymentMethod: row.method })) }
}

export function promptEvidence(evidence) {
  const bounded = (scope) => scope && { ...scope, categories: scope.categories.slice(0, 10), additionalCategoryCount: Math.max(0, scope.categories.length - 10) }
  return evidence.map((item) => ({ ...item, current: bounded(item.current), previous: bounded(item.previous) }))
}

export function verifiedStatusFacts(evidence) {
  return Object.fromEntries(evidence.map((item) => [`${item.id}_record_status`, { kind: "recorded", label: "Complete verified record-presence statement for this exact scope", value: verifiedEvidenceStatement(item) }]))
}

export function verifiedEvidenceStatement(item) {
  const s = item.current
  if (item.comparisons.length) {
    const c = item.comparisons[0]
    const direction = c.changePaise > 0 ? "increased" : c.changePaise < 0 ? "decreased" : "was unchanged"
    return `${c.title} ${direction}: ${c.previousLabel} ${money(c.previousPaise)} → ${c.currentLabel} ${money(c.currentPaise)}${c.percentage == null ? "; percentage N/A because the earlier amount was zero" : ""}.`
  }
  const subject = item.intent === "income" ? "income records" : item.intent === "cashflow" ? "transactions" : "expenses"
  const amount = item.intent === "income" ? s.incomeTotalPaise : s.expenseTotalPaise
  return s.recordCount ? `${s.recordCount} recorded ${subject} match ${s.label}${s.category ? ` · ${s.category}` : ""}${s.method ? ` · ${s.method.toUpperCase()}` : ""}${item.intent === "cashflow" ? "." : `, totalling ${money(amount)}.`}`
    : `No recorded ${subject} match ${s.label}${s.category ? ` · ${s.category}` : ""}${s.method ? ` · ${s.method.toUpperCase()}` : ""}.`
}

function scopedClaim(clause, raw, evidence, facts, includePrevious = false) {
  const references = [...raw.matchAll(/\{\{((q\d+)_\w+)\}\}/g)]
  let items = evidence.filter((item) => !references.length || references.some((match) => match[2] === item.id))
  if (!items.length) items = evidence
  const expandedRaw = clause.replace(/\{\{(\w+)\}\}/g, (_, key) => String(facts[key]?.value || ""))
  const expanded = normalized(expandedRaw)
  let scopes = items.flatMap((item) => [item.current, item.previous].filter(Boolean).map((scope) => ({ item, scope })))
  const explicit = scopes.filter(({ scope }) => scope.label && expanded.includes(normalized(scope.label)) || months.some((month, i) => scope.start.slice(5, 7) === String(i + 1).padStart(2, "0") && mentionsMonth(expandedRaw, month)))
  if (explicit.length) scopes = explicit
  else if (/\b(?:this|requested|selected|current)\s+(?:period|month|scope)\b/.test(expanded)) scopes = scopes.filter(({ scope }) => scope.key === "current")
  else if (/\blast month\b/.test(expanded)) {
    scopes = scopes.filter(({ item, scope }) => { const date = new Date(`${item.asOf.slice(0, 7)}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return scope.start.slice(0, 7) === date.toISOString().slice(0, 7) })
  }
  else if (/\b(?:compared|versus|vs|than|from|to)\b/.test(expanded) && /\{\{(?:q\d+_)?current_(?:expenses|income)\}\}/.test(raw) && /\{\{(?:q\d+_)?previous_(?:expenses|income)\}\}/.test(raw)) { /* both supplied scopes are explicitly compared */ }
  else if (references.some((match) => /_(?:previous_period|previous_expenses|previous_income)$/.test(match[1]))) scopes = scopes.filter(({ scope }) => scope.key === "previous")
  else if (!includePrevious && !/\b(?:all periods|at all|any period)\b/.test(expanded)) scopes = scopes.filter(({ scope }) => scope.key === "current")
  const names = [...new Set(items.flatMap((item) => [item.current, item.previous].filter(Boolean).flatMap((scope) => [scope.category, ...scope.categories.map((category) => category.name)]).filter(Boolean)))].filter((name) => expanded.includes(normalized(name)))
  if (names.length) scopes = scopes.filter(({ scope }) => !scope.category || names.some((name) => normalized(scope.category) === normalized(name)))
  return { scopes, names, expanded, expandedRaw }
}

// Recognize a small set of factual predicates (presence, zero, direction and
// typed reference role). Their truth is decided by the structured receipt;
// this is not an intent router or an attempt to interpret every advice sentence.
export function assertNarrativeConsistent(answer, evidence = [], facts = {}) {
  if (!evidence.length) return
  const fail = (rule) => { throw modelValidationError(rule, "explanation", { validator: "financial_claim", field: "answer", expected: "verified_financial_claim", receivedType: "string" }) }
  for (const raw of answer.split(/(?<=[.!?])\s+|\n+|;\s*|,?\s+but\s+|\s+whereas\s+/).filter(Boolean)) {
    const text = normalized(raw.replace(/\{\{(\w+)\}\}/g, (_, key) => /(?:_category|_c\d+_name)$/.test(key) ? "category" : "FACT"))
    const refs = [...raw.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1])
    const hypothetical = refs.some((key) => facts[key]?.kind === "hypothetical")
    const guarantees = /\b(?:will|guaranteed|certainly)\s+(?:save|free up|deliver)|\b(?:save|saving|savings)\b[^.!?]{0,70}\b(?:every|each|per) month\b/.test(text)
    const deniesGuarantee = /\b(?:not|never|no)\s+(?:a\s+)?(?:guaranteed|recurring|achieved)|\b(?:not|never)\s+(?:actual|recorded)\s+savings\b/.test(text)
    if ((hypothetical || evidence.some((item) => item.task === "reduce")) && guarantees && !deniesGuarantee && (hypothetical || /\b(?:will|guaranteed|certainly)\b/.test(text))) fail("narrative_savings_contradiction")
    if (/\b(?:no|not|false that|incorrect that)\s+\{\{q\d+_record_status\}\}/i.test(raw)) fail("narrative_records_contradiction")
    if (/^(?:[-*•]\s*)?(?:if\b|unless\b|consider\b|you (?:could|might|may)\b)/.test(text) || /\?$/.test(text)) continue
    let subjectText = text
    const categoryNames = [...new Set(evidence.flatMap((item) => [item.current, item.previous].filter(Boolean).flatMap((scope) => [scope.category, ...scope.categories.map((category) => category.name)]).filter(Boolean)))]
    for (const name of categoryNames) subjectText = subjectText.replace(new RegExp(`(?<![\\w])${normalized(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g"), "category")
    const absentPredicate = /\b(?:no|not any|without any)\s+(?:(?:recorded|matching|available|relevant|selected|expense|income|category)\s+)*(?:transactions?|records?|expenses?|spending|income)\b|\b(?:transactions?|records?|expenses?|history)\s+(?:(?:is|are|was|were|remains?)\s+)(?:empty|absent|unavailable|missing|not found)\b|\b(?:did not|didn't|have not|haven't)\s+(?:spend|record|make any)\b|\b(?:spent|spending|expenses?|income)\s+(?:is |was |were |of |at )?(?:zero|nothing)\b|\b(?:could not|couldn't|cannot|can't)\s+find\s+(?:any\s+)?(?:records?|transactions?|expenses?)\b/
    const absence = absentPredicate.test(text) || absentPredicate.test(subjectText)
    const presence = /\bthere (?:are|were|is|was)\s+(?:some\s+)?(?:recorded|matching|available)\s+(?:transactions?|records?|expenses?)\b|\bhere are\s+(?:(?:your|the|selected|matching|recorded|largest|biggest)\s+)*(?:expenses|transactions|records)\b/.test(text) && !absence
    const trend = /\b(?:spending|expenses?|income|costs?)\b[^.!?]{0,90}\b(increased|rose|grew|decreased|fell|declined|unchanged|higher|lower)\b|\b(increase|decrease|decline|growth)\s+(?:was|is|of)\b/.exec(text)
    const direction = trend && !/\b(?:could|might|may|can|would|should)\b/.test(text.slice(0, trend.index + trend[0].length)) ? trend : null
    if (!absence && !presence && !direction && !refs.length) continue
    const unqualifiedAbsence = absence && !/\b(?:this|requested|selected|current|last)\s+(?:period|month|scope)\b/.test(text) && !refs.some((key) => /_period$/.test(key))
    const { scopes, names, expanded, expandedRaw } = scopedClaim(raw, raw, evidence, facts, unqualifiedAbsence)
    const declaredMonths = months.filter((month) => mentionsMonth(expandedRaw, month))
    if ((absence || presence || refs.length) && declaredMonths.some((month) => !scopes.some(({ scope }) => normalized(scope.label).includes(month.toLowerCase()) || Number(scope.start.slice(5, 7)) === months.indexOf(month) + 1))) fail("narrative_scope_contradiction")
    if ((absence || presence) && !scopes.length) fail("narrative_scope_contradiction")
    if (absence || presence) {
      const income = /\bincome\b/.test(text) && !/\bexpenses?|spending\b/.test(text)
      const expense = /\bexpenses?|spending|spent\b/.test(text) || names.length
      const states = scopes.flatMap(({ scope }) => names.length ? names.map((name) => { const category = scope.categories.find((category) => normalized(category.name) === normalized(name)); return category ? category.recordCount > 0 : scope.categoriesComplete ? false : null }) : [income ? scope.incomeTotalPaise == null ? null : scope.incomeTotalPaise > 0 : expense ? scope.expenseTotalPaise == null ? null : scope.expenseTotalPaise > 0 : scope.hasRecords])
      if (states.some((state) => state == null)) fail("narrative_scope_contradiction")
      if (absence && states.some(Boolean) || presence && states.some((state) => !state)) fail("narrative_records_contradiction")
    }
    for (const key of refs) {
      if (/(?:^|_)(?:c\d+_amount|current_expenses|current_income)$/.test(key) && /\b(?:largest|biggest|single|individual)\s+(?:(?:recorded|expense|single|individual)\s+)*(?:expense|transaction|purchase)\b/.test(text) && !/\bcategory\b/.test(text)) fail("narrative_role_contradiction")
      const metric = /(?:^|_)current_income$/.test(key) ? "income" : /(?:^|_)current_expenses$/.test(key) ? "expense" : null
      if (metric && (/\bexpenses?|spending\b/.test(text) && !/\bincome\b/.test(text) && metric === "income" || /\bincome\b/.test(text) && !/\bexpenses?|spending\b/.test(text) && metric === "expense")) fail("narrative_metric_contradiction")
      const match = key.match(/^(?:(q\d+)_)?(current_expenses|current_income|previous_expenses|previous_income|expense_count|transaction_count|shown_records|omitted_records|c(\d+)_amount)$/)
      if (match && scopes.length === 1) {
        const item = evidence.find((entry) => entry.id === (match[1] || evidence[0].id)), s = item?.[match[2].startsWith("previous") ? "previous" : "current"]
        if (s && (scopes[0].scope.start !== s.start || scopes[0].scope.end !== s.end)) fail("narrative_scope_contradiction")
        if (match[3] != null && names.length === 1 && item?.current.categories[Number(match[3])]?.name.toLowerCase() !== names[0].toLowerCase()) fail("narrative_metric_contradiction")
        if (match[2] === "transaction_count" && /\bexpenses\b/.test(text) && !/\bincome\b/.test(text) && s.incomeCount > 0) fail("narrative_metric_contradiction")
      }
      const rank = key.match(/^(q\d+)_record(\d+)(?:_amount)?$/)
      if (rank && names.length === 1) {
        const item = evidence.find((entry) => entry.id === rank[1]), row = item?.rankedTransactions[Number(rank[2])]
        if (row && normalized(row.category) !== normalized(names[0])) fail("narrative_metric_contradiction")
      }
    }
    if (direction) {
      const cards = evidence.filter((item) => scopes.some((s) => s.item.id === item.id)).flatMap((item) => item.comparisons)
      if (cards.length === 1) {
        let c = cards[0]
        const word = direction[1] || direction[2]
        if (names.length === 1) {
          const item = evidence.find((entry) => entry.comparisons.length && entry.previous)
          if (item) {
            if (!item.current.categoriesComplete || !item.previous.categoriesComplete) fail("narrative_scope_contradiction")
            const earlier = item.current.start < item.previous.start ? item.current : item.previous
            const later = earlier === item.current ? item.previous : item.current
            const amount = (scope) => scope.categories.find((category) => normalized(category.name) === normalized(names[0]))?.amountPaise || 0
            c = { ...c, changePaise: amount(later) - amount(earlier) }
          }
        }
        const claimed = /increas|rose|grew|higher|growth/.test(word) ? 1 : /unchanged/.test(word) ? 0 : -1
        let expected = Math.sign(c.changePaise)
        const previousAt = expanded.indexOf(normalized(c.previousLabel)), currentAt = expanded.indexOf(normalized(c.currentLabel))
        if (previousAt >= 0 && currentAt >= 0 && previousAt < currentAt && /\b(?:higher|lower)\b/.test(word) && !/\bfrom\b.*\bto\b/.test(text)) expected *= -1
        if (claimed !== expected) fail("narrative_direction_contradiction")
        const reversedSignedFact = refs.some((key) => /_(?:expense_change(?:_percentage)?|income_change)$/.test(key) && evidence.some((item) => key.startsWith(`${item.id}_`) && item.previous && item.current.start < item.previous.start))
        if (reversedSignedFact && c.changePaise !== 0) fail("narrative_direction_contradiction")
      }
    }
  }
}
