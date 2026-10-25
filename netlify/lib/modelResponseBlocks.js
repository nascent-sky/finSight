import { comparisonBlock, RESPONSE_FOLLOWUPS, responsePresentation } from "../../src/features/finance-ai/responseBlocks.js"
import { formatExpenseAmount } from "../../src/components/analytics/expenseChartUtils.js"
import { modelValidationError, responseValueType } from "./modelValidation.js"

const flatFields = ["type", "kind", "text", "title", "id", "estimateId", "ordered", "items"]
function normalizeBlock(block, path) {
  if (!block || typeof block !== "object") return block
  const flat = Object.hasOwn(block, "id") && (Object.hasOwn(block, "items") || Object.hasOwn(block, "kind")) || Object.hasOwn(block, "ordered") && Object.hasOwn(block, "estimateId")
  if (!flat) return block // older typed replies still pass the same strict validator
  const fail = (key, expected) => { throw modelValidationError("response_schema", "explanation", { validator: "legacy_block", field: key ? `${path}.${key}` : path, expected, receivedType: responseValueType(key ? block[key] : block) }) }
  if (Object.keys(block).some((key) => !flatFields.includes(key))) fail(null, "known_fields")
  for (const key of flatFields) {
    const expected = key === "items" ? "array" : key === "ordered" ? "boolean" : "string"
    if (!Object.hasOwn(block, key) || (expected === "array" ? !Array.isArray(block[key]) : typeof block[key] !== expected)) fail(key, expected)
  }
  if (block.items.length > 8 || block.items.some((item) => typeof item !== "string")) fail("items", "array")
  if (!["recorded", "hypothetical", "recommendation"].includes(block.kind)) fail("kind", "supported_kind")
  const empty = (...keys) => { for (const key of keys) if (key === "items" ? block.items.length : key === "ordered" ? block.ordered : block[key] !== "") fail(key, key === "items" ? "empty_array" : key === "ordered" ? "false" : "empty_string") }
  if (["metric", "comparison", "categories", "savings"].includes(block.type)) { empty("text", "title", "estimateId", "ordered", "items"); return { type: block.type, id: block.id } }
  if (["paragraph", "notice"].includes(block.type)) { empty("title", "id", "estimateId", "ordered", "items"); return { type: block.type, kind: block.kind, text: block.text } }
  if (block.type === "heading") { empty("title", "id", "estimateId", "ordered", "items"); return { type: "heading", text: block.text } }
  if (block.type === "recommendation") { empty("id", "ordered", "items"); return { type: "recommendation", title: block.title, text: block.text, ...(block.estimateId ? { estimateId: block.estimateId } : {}) } }
  if (block.type === "list") { empty("text", "title", "id", "estimateId"); return { type: "list", ordered: block.ordered, items: block.items.map((text) => ({ kind: block.kind, text })) } }
  if (["actions", "followups"].includes(block.type)) { empty("text", "title", "id", "estimateId", "ordered"); return { type: block.type, ids: block.items } }
  fail("type", "supported_block")
}

export function resolveModelResponseBlocks(blocks, { catalog, cardMap, allowedActions, validateText, useFact, maxBlocks = 12 }) {
  const fail = (rule = "response_schema") => { throw modelValidationError(rule) }
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > Math.min(12, maxBlocks)) fail()
  const used = new Set()
  const shape = (block, keys) => { if (!block || typeof block !== "object" || Array.isArray(block) || Object.keys(block).some((key) => !["type", ...keys].includes(key))) fail() }
  const lookup = (id, type) => {
    if (typeof id !== "string" || !Object.hasOwn(catalog, id) || catalog[id].block.type !== type || used.has(id)) fail("block_reference_unknown")
    used.add(id)
    catalog[id].factKeys.forEach(useFact)
    return catalog[id].block
  }
  const resolved = blocks.map((input, index) => {
    const block = normalizeBlock(input, `blocks[${index}]`)
    if (["metric", "categories", "savings", "comparison"].includes(block?.type)) {
      shape(block, ["id"])
      if (block.type === "comparison" && Object.hasOwn(cardMap, block.id)) {
        if (used.has(block.id)) fail("block_reference_unknown")
        used.add(block.id)
        return comparisonBlock(cardMap[block.id])
      }
      return lookup(block.id, block.type)
    }
    if (block?.type === "heading") { shape(block, ["text"]); return { type: "heading", text: validateText(block.text, "recommendation") } }
    if (["paragraph", "notice"].includes(block?.type)) {
      shape(block, ["text", "kind"])
      if (!["recorded", "hypothetical", "recommendation"].includes(block.kind)) fail()
      return { type: block.type, text: validateText(block.text, block.kind), ...(block.type === "notice" ? { tone: block.kind === "hypothetical" ? "caution" : "info" } : {}) }
    }
    if (block?.type === "recommendation") {
      shape(block, ["title", "text", "estimateId"])
      return { type: "recommendation", title: validateText(block.title, "recommendation"), text: validateText(block.text, "recommendation"), ...(block.estimateId == null ? {} : { estimate: lookup(block.estimateId, "savings") }) }
    }
    if (block?.type === "list") {
      shape(block, ["ordered", "items"])
      if (typeof block.ordered !== "boolean" || !Array.isArray(block.items) || !block.items.length || block.items.length > 8) fail()
      return { type: "list", ordered: block.ordered, items: block.items.map((item) => { shape(item, ["text", "kind"]); if (Object.hasOwn(item, "type") || !["recorded", "hypothetical", "recommendation"].includes(item.kind)) fail(); return validateText(item.text, item.kind) }) }
    }
    if (["actions", "followups"].includes(block?.type)) {
      shape(block, ["ids"])
      const allowed = block.type === "actions" ? allowedActions : Object.keys(RESPONSE_FOLLOWUPS)
      if (!Array.isArray(block.ids) || !block.ids.length || block.ids.length > 3 || new Set(block.ids).size !== block.ids.length || block.ids.some((id) => !allowed.includes(id))) fail("action_forbidden")
      return { type: block.type, ids: [...block.ids] }
    }
    fail()
  })
  try { return responsePresentation(resolved) } catch { fail() }
}

export function presentationText(presentation) {
  const money = (paise) => formatExpenseAmount(paise / 100)
  return presentation.blocks.map((block) => {
    if (["heading", "paragraph", "notice"].includes(block.type)) return block.text
    if (block.type === "list") return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : "•"} ${item}`).join("\n")
    if (["ranked_expenses", "transaction_list"].includes(block.type)) return `${block.label} · ${block.period} · ${money(block.totalPaise)} total\n${block.items.map((item, i) => `${block.type === "ranked_expenses" ? `${i + 1}.` : "•"} ${item.category} · ${money(item.amountPaise)} · ${item.date} · ${item.method.toUpperCase()}`).join("\n")}\nShowing ${block.items.length} of ${block.totalCount} expenses.`
    if (block.type === "metric") return `${block.label}: ${money(block.amountPaise)} · ${block.period}`
    if (block.type === "categories") return `${block.basis === "income" ? "Recorded income" : "Recorded expenses"}: ${money(block.totalPaise)}\n${block.items.map((item) => `${item.label}: ${money(item.amountPaise)} (${item.share == null ? "N/A" : `${item.share}%`})`).join("\n")}`
    if (block.type === "savings") return `Hypothetical estimate · ${block.label}: ${money(block.savingPaise)}${block.reductionBps == null ? "" : ` at ${block.reductionBps / 100}%`}; remaining spend ${money(block.remainingPaise)} · ${block.period}. Not recorded savings.`
    if (block.type === "recommendation") return `${block.title}\n${block.text}${block.estimate ? `\n${presentationText({ blocks: [block.estimate] })}` : ""}`
    if (block.type === "comparison") { const c = block.card; return `${c.title}: ${c.previousLabel} ${money(c.previousPaise)} → ${c.currentLabel} ${money(c.currentPaise)}; change ${money(c.changePaise)} (${c.percentage == null ? "N/A" : `${c.percentage}%`}).` }
    return ""
  }).filter(Boolean).join("\n\n")
}
