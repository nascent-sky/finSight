import { calculateComparison, calculateHypotheticalReduction, MAX_MONEY_PAISE } from "./financialContext.js"

export const RESPONSE_ACTIONS = Object.freeze({
  analytics: Object.freeze({ label: "View Analytics", to: "/analytics" }),
  transactions: Object.freeze({ label: "Open Transactions", to: "/expenses" }),
  gpay_import: Object.freeze({ label: "Import GPay", to: "/transactions-import" }),
})
export const RESPONSE_FOLLOWUPS = Object.freeze({ previous_month: "What about last month?", contributors: "Which transactions contributed most?", reduce: "How can I reduce it?", compare: "Compare this month with last month" })
const invalid = () => { throw new Error("The response presentation could not be verified.") }
const object = (value, keys) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid() }
const text = (value, max = 1600) => { if (typeof value !== "string" || !value.trim() || value.length > max) invalid() }
const amount = (value, signed = false) => { if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_PAISE || !signed && value < 0) invalid() }
const ids = (values, allowed, max) => { if (!Array.isArray(values) || !values.length || values.length > max || values.some((id) => typeof id !== "string" || !Object.hasOwn(allowed, id)) || new Set(values).size !== values.length) invalid() }

export function chronologicalComparison(card) {
  const result = { ...card }
  if (card.metric !== "category" && card.previousStart && card.currentStart && card.previousStart > card.currentStart) {
    Object.assign(result, { previousLabel: card.currentLabel, currentLabel: card.previousLabel, previousStart: card.currentStart, currentStart: card.previousStart, ...calculateComparison(card.currentPaise, card.previousPaise) })
  }
  return result
}

export function validateResponsePresentation(value) {
  object(value, ["version", "blocks"])
  if (value.version !== 1 || !Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 16) invalid()
  let size = 0
  for (const block of value.blocks) {
    switch (block?.type) {
      case "paragraph": case "heading": case "notice":
        object(block, ["type", "text", "tone"]); text(block.text, block.type === "heading" ? 120 : 6000)
        if (block.tone != null && !["info", "caution"].includes(block.tone)) invalid()
        break
      case "list":
        object(block, ["type", "ordered", "items"])
        if (typeof block.ordered !== "boolean" || !Array.isArray(block.items) || !block.items.length || block.items.length > 50) invalid()
        block.items.forEach((item) => text(item, 1000))
        break
      case "ranked_expenses": case "transaction_list": {
        object(block, ["type", "label", "period", "start", "end", "category", "method", "totalPaise", "totalCount", "items"])
        text(block.label, 120); text(block.period, 240); amount(block.totalPaise)
        const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
        if (!date(block.start) || !date(block.end) || block.start >= block.end || !Number.isSafeInteger(block.totalCount) || block.totalCount < 1 || !Array.isArray(block.items) || !block.items.length || block.items.length > (block.type === "ranked_expenses" ? 5 : 50) || block.items.length > block.totalCount) invalid()
        if (block.category != null) text(block.category, 160)
        if (block.method != null && !["cash", "upi", "other"].includes(block.method)) invalid()
        let shown = 0, previous = Infinity
        const keys = new Set()
        for (const item of block.items) {
          object(item, ["rowKey", "category", "amountPaise", "date", "method", "share"])
          if (item.rowKey != null) { text(item.rowKey, 6000); if (keys.has(item.rowKey)) invalid(); keys.add(item.rowKey) }
          else if (block.type === "transaction_list") invalid()
          text(item.category, 160); amount(item.amountPaise)
          if (!item.amountPaise || block.type === "ranked_expenses" && item.amountPaise > previous || !date(item.date) || item.date < block.start || item.date >= block.end || !["cash", "upi", "other"].includes(item.method)) invalid()
          if (block.category && item.category.toLowerCase() !== block.category.toLowerCase() || block.method && item.method !== block.method) invalid()
          if (item.share !== (block.totalPaise ? Math.round(item.amountPaise / block.totalPaise * 1000) / 10 : null)) invalid()
          previous = item.amountPaise; shown += item.amountPaise
        }
        if (shown > block.totalPaise || block.items.length === block.totalCount && shown !== block.totalPaise) invalid()
        break
      }
      case "metric":
        object(block, ["type", "label", "amountPaise", "semantic", "period"])
        text(block.label, 120); text(block.period, 240)
        if (!["income", "expense", "net"].includes(block.semantic)) invalid()
        amount(block.amountPaise, block.semantic === "net")
        break
      case "comparison": {
        object(block, ["type", "card"])
        const c = block.card
        object(c, ["id", "title", "previousLabel", "currentLabel", "previousPaise", "currentPaise", "changePaise", "percentage", "direction", "note", "metric", "previousStart", "currentStart"])
        for (const key of ["id", "title", "previousLabel", "currentLabel"]) text(c[key], 240)
        amount(c.previousPaise); amount(c.currentPaise)
        const calculated = calculateComparison(c.previousPaise, c.currentPaise)
        if (["changePaise", "percentage", "direction"].some((key) => c[key] !== calculated[key])) invalid()
        if (c.metric != null && !["income", "expense", "category"].includes(c.metric)) invalid()
        if (c.note != null) text(c.note, 1600)
        if (c.previousStart != null || c.currentStart != null) {
          if (![c.previousStart, c.currentStart].every((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date)) invalid()
          if (c.metric !== "category" && c.previousStart > c.currentStart) invalid()
        }
        break
      }
      case "categories": {
        object(block, ["type", "period", "basis", "totalPaise", "items", "otherCount"])
        text(block.period, 240); amount(block.totalPaise)
        if (!["expenses", "income"].includes(block.basis) || !Array.isArray(block.items) || !block.items.length || block.items.length > 10 || !Number.isInteger(block.otherCount) || block.otherCount < 0) invalid()
        let sum = 0
        for (const item of block.items) {
          object(item, ["label", "amountPaise", "share"]); text(item.label, 160); amount(item.amountPaise)
          const share = block.totalPaise ? Math.round(item.amountPaise / block.totalPaise * 1000) / 10 : null
          if (item.share !== share) invalid()
          sum += item.amountPaise
        }
        if (block.basis === "expenses" && sum > block.totalPaise) invalid()
        if (block.basis === "expenses" && block.otherCount === 0 && sum !== block.totalPaise) invalid()
        break
      }
      case "savings":
        validateSavings(block)
        break
      case "recommendation":
        object(block, ["type", "title", "text", "estimate"]); text(block.title, 120); text(block.text)
        if (block.estimate != null) validateSavings(block.estimate)
        break
      case "actions": object(block, ["type", "ids"]); ids(block.ids, RESPONSE_ACTIONS, 3); break
      case "followups": object(block, ["type", "ids"]); ids(block.ids, RESPONSE_FOLLOWUPS, 3); break
      default: invalid()
    }
    size += JSON.stringify(block).length
  }
  if (size > 24000) invalid()
  return value
}

function validateSavings(block) {
  object(block, ["type", "label", "period", "originalPaise", "savingPaise", "remainingPaise", "reductionBps", "hypothetical"])
  if (block.type !== "savings" || block.hypothetical !== true) invalid()
  text(block.label, 160); text(block.period, 240)
  for (const key of ["originalPaise", "savingPaise", "remainingPaise"]) amount(block[key])
  if (block.savingPaise + block.remainingPaise !== block.originalPaise) invalid()
  if (block.reductionBps != null && calculateHypotheticalReduction(block.originalPaise, block.reductionBps).savingPaise !== block.savingPaise) invalid()
}

export const responsePresentation = (blocks) => validateResponsePresentation({ version: 1, blocks })
export const comparisonBlock = (card) => ({ type: "comparison", card: chronologicalComparison(card) })

// Compatibility for older backend replies: parse structure, never HTML, links,
// financial amounts or UI actions. Financial cards still come from the backend.
export function textResponseBlocks(answer) {
  const blocks = []
  for (const paragraph of answer.split(/\n\s*\n/).filter((part) => part.trim())) {
    const lines = paragraph.split("\n")
    let prose = [], items = [], ordered = false
    const flushProse = () => { if (prose.length) blocks.push({ type: "paragraph", text: prose.join("\n") }); prose = [] }
    const flushList = () => { if (items.length) blocks.push({ type: "list", ordered, items }); items = [] }
    for (const line of lines) {
      const match = line.match(/^\s*(?:([•*-])|\d+[.)])\s+(.+)$/)
      if (match) { flushProse(); const nextOrdered = !match[1]; if (items.length && nextOrdered !== ordered) flushList(); ordered = nextOrdered; items.push(match[2]) }
      else { flushList(); prose.push(line) }
    }
    flushProse(); flushList()
  }
  return blocks.length <= 16 ? blocks : [{ type: "paragraph", text: answer }]
}
