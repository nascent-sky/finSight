import { resolveAnswer } from "../../src/features/finance-ai/financialContext.js"
import { modelValidationError, responseValueType } from "./modelValidation.js"
import { presentationText, resolveModelResponseBlocks } from "./modelResponseBlocks.js"
import { comparisonBlock, responsePresentation, textResponseBlocks } from "../../src/features/finance-ai/responseBlocks.js"
import { GEMINI_RESPONSE_FORMAT, GEMINI_RESPONSE_SCHEMA } from "./geminiRequestSchema.js"
import { selectPreparedBlocks, uniqueNarrativeBlocks } from "./responseComposition.js"
import { assertNarrativeConsistent } from "./narrativeConsistency.js"

// The model supplies narrative and optional references. FinSight owns the UI.
export const DEVELOPMENT_RESPONSE_SCHEMA = GEMINI_RESPONSE_SCHEMA

export const DEVELOPMENT_RESPONSE_INSTRUCTIONS = `Write one or two useful sentences using the current verified facts and presentationPolicy. FinSight creates financial cards, lists, numbered recommendation cards, savings estimates and navigation itself. Let those blocks carry their detail: do not repeat transaction lists, category breakdowns or individual hypothetical estimates in prose. Optional blockIds only suggest already prepared financial resources. Never supply UI objects, card amounts, HTML, paths or URLs. Keep scope explanations brief; partial periods and hypothetical estimates are labelled by FinSight.
authoritativeEvidence is the current verified tool receipt: its recordCount, hasRecords, exact scope, category amounts and chronological comparisons override chat history and planner assumptions. results.transactions is a bounded display selection, not the total count. Never infer absence from an omitted/empty optional field. For a factual presence or comparison summary, prefer the complete {{q0_record_status}} statement (or the matching query prefix) supplied in facts. Records in another period or category are not evidence about this scope.
Use exact {{fact_key}} placeholders for financial values, dates, recorded counts, rates and category names. Category names may contain digits. Never reproduce a numeric value from history or tool JSON. Do not use numbered list markers; use bullets or separate sections. Ordinary counts of proposed actions such as 'three practical improvements' are allowed; recorded counts always require placeholders.
Use recorded fact placeholders for recorded history and hypothetical placeholders only for proposed scenarios. Never present scenario values as actual savings. FinSight labels estimates for the exact requested period, not achieved savings or monthly forecasts. Do not invent a scenario percentage, arithmetic or feasibility.
Period-comparison cards always run earlier to later. For their trend explanations use comparison_previous_period, comparison_current_period, comparison_previous_amount, comparison_current_amount, comparison_change and comparison_percentage facts (with the supplied query prefix). They match the displayed card. Other current/previous query facts retain the user's requested scope and may use the opposite orientation; do not confuse them. Use N/A for a zero earlier amount, never invent a growth percentage.
Recommendations can be qualitative without referencing a transaction. Ground specific category advice in the supplied category placeholders and totals when useful; phrase it as a proposed action, not an unsupported fact about the user's habits. Never declare expenses unnecessary, essential or affordable without the user's information. Ask a focused question only when necessary to answer this request; do not end every response with a generic clarification. Do not assert personal causes: a recorded category contribution is not proof of why spending happened.
The current tool facts are the only financial authority; previous assistant text is conversation context, not evidence. For an explicit scenario, explain the requested reduction and let FinSight display its prepared estimate. If you include scenario figures in prose, use the supplied requiredFactKeys placeholders and never substitute another percentage. If validationFeedback is supplied, correct that rule using the SAME current facts and authorized scope.
${GEMINI_RESPONSE_FORMAT}`

export function validateDevelopmentResponse(output, { facts, cardMap, catalog = {}, defaultBlocks = [], allowedActions = [], maxBlocks = 16, requiredFactKeys = [], stage = "explanation", clarification = false, recordsAppended = false, policies = [], ownedBlocks = [], evidence = [] }) {
  const options = { facts, cardMap, catalog, defaultBlocks, allowedActions, maxBlocks, requiredFactKeys, stage, clarification, recordsAppended, policies, ownedBlocks, evidence }
  if (!output || typeof output !== "object" || Array.isArray(output)) throw modelValidationError("response_schema", stage, { validator: "response_envelope", field: "$", expected: "object", receivedType: responseValueType(output) })
  if (Object.hasOwn(output, "answer")) return validateNarrativeResponse(output, options)
  if (["queries", "functionCall", "toolCalls"].some((key) => Object.hasOwn(output, key))) throw modelValidationError("response_stage", stage, { validator: "response_envelope", field: "answer", expected: "final_text", receivedType: "tool_call" })
  // Strict compatibility for older typed replies; never ask the model to build
  // these shapes now. Missing optional card metadata is harmless here as well.
  if (Object.hasOwn(output, "blocks") || Object.hasOwn(output, "sections")) {
    const legacyBlocks = output.sections || output.blocks
    const prose = (Array.isArray(legacyBlocks) ? legacyBlocks : []).flatMap((block) => [block?.text, block?.title, ...(Array.isArray(block?.items) ? block.items.map((item) => typeof item === "string" ? item : item?.text) : [])]).filter((text) => typeof text === "string")
    prose.forEach((text) => assertNarrativeConsistent(text, evidence, facts))
    const result = validateLegacyResponse({ cardIds: [], ...output }, options)
    if (ownedBlocks.length) result.presentation = responsePresentation([...result.presentation.blocks, ...ownedBlocks])
    return result
  }
  throw modelValidationError("narrative_missing", stage, { validator: "response_envelope", field: "answer", expected: "string", receivedType: "missing" })
}

function validateNarrativeResponse(output, { facts, cardMap, catalog, defaultBlocks, allowedActions, maxBlocks, requiredFactKeys, stage, clarification, recordsAppended, policies, ownedBlocks, evidence }) {
  const fail = (rule, expected, receivedType = responseValueType(output.answer), validator = "narrative") => { throw modelValidationError(rule, stage, { validator, field: "answer", expected, receivedType }) }
  if (typeof output.answer !== "string") fail("narrative_type", "string")
  if (!output.answer.trim()) fail("narrative_empty", "nonempty_string", "empty")
  if (output.answer.length > 6000) fail("answer_too_long", "bounded_string")
  if (/<\/?[a-z!][^>]*>|(?:https?:\/\/|javascript:|data:text\/html)|\]\([^)]*\)|(?:^|\s)\/(?:analytics|expenses|transactions-import)\b/i.test(output.answer)) fail("unsafe_content", "string")
  assertNarrativeConsistent(output.answer, evidence, facts)
  let verified
  try {
    // Reuse every financial placeholder and claim check. Presentation metadata
    // is deliberately excluded from this authoritative narrative validation.
    verified = validateLegacyResponse({ answer: output.answer, cardIds: [] }, { facts, cardMap: {}, stage, clarification, narrativeOnly: true })
  } catch (error) {
    if (error.origin !== "model_output") throw error
    fail(error.validation.rule, "verified_financial_claim", "string", "financial_claim")
  }
  const warnings = []
  const warn = (field, value, expected = "prepared_block_id") => {
    if (warnings.length < 4) warnings.push({ code: "OPTIONAL_PRESENTATION_DISCARDED", field, expected, receivedType: responseValueType(value) })
  }
  const suggested = []
  for (const field of ["blockIds", "cardIds"]) {
    if (output[field] == null) continue
    if (!Array.isArray(output[field])) { warn(field, output[field], "array"); continue }
    output[field].slice(0, 8).forEach((id) => {
      const resource = typeof id === "string" && (field === "blockIds" ? Object.hasOwn(catalog, id) && catalog[id] : Object.hasOwn(cardMap, id) && (Object.values(catalog).find((item) => item.block.type === "comparison" && item.block.card.id === id) || !policies.length && { block: comparisonBlock(cardMap[id]), factKeys: [] }))
      if (resource) suggested.push(resource)
      else warn(field, id)
    })
  }
  // Default blocks are program-owned results. Invalid optional model selectors
  // cannot hide or replace them, introduce amounts or consume another API call.
  const defaults = selectPreparedBlocks({ catalog, defaultBlocks, suggested, policies, recordsAppended }).map((resource) => resource.block)
  const recordValues = ownedBlocks.length ? Object.entries(facts).filter(([key]) => /^q\d+_record\d+$/.test(key)).map(([, fact]) => fact.value) : []
  let narrative = uniqueNarrativeBlocks(textResponseBlocks(verified.answer), [...defaults, ...ownedBlocks], recordValues)
  const actions = allowedActions.length ? [{ type: "actions", ids: allowedActions }] : []
  const limit = Math.max(1, Math.min(16, maxBlocks))
  if (narrative.length + Math.min(defaults.length, limit - 1) + actions.length > limit) narrative = [{ type: "paragraph", text: verified.answer }]
  const blocks = [...narrative]
  let comparisons = 0
  const append = (block, reserve = 0) => {
    if (blocks.length >= limit - reserve || block.type === "comparison" && comparisons >= 2) return
    blocks.push(block)
    if (block.type === "comparison") comparisons++
  }
  defaults.forEach((block) => append(block, actions.length))
  actions.forEach((block) => append(block))
  const usedFacts = new Set([...output.answer.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((match) => match[1]))
  const shown = new Set(blocks.map((block) => JSON.stringify(block)))
  for (const resource of Object.values(catalog)) if (shown.has(JSON.stringify(resource.block))) resource.factKeys.forEach((key) => usedFacts.add(key))
  if (requiredFactKeys.some((key) => !usedFacts.has(key))) fail("scenario_result_missing", "verified_financial_claim", "string", "financial_claim")
  let presentation
  try { presentation = responsePresentation([...blocks, ...ownedBlocks]) } catch { throw modelValidationError("response_schema", stage, { validator: "presentation", field: "presentation", expected: "valid_presentation", receivedType: "object", repairable: false }) }
  const answer = presentationText({ blocks: narrative }) || (ownedBlocks.length ? "" : presentationText(presentation))
  return { answer, cards: blocks.filter((block) => block.type === "comparison").map((block) => block.card), presentation, ...(warnings.length ? { presentationWarnings: warnings } : {}) }
}

function validateLegacyResponse(output, { facts, cardMap, catalog = {}, defaultBlocks = [], allowedActions = [], maxBlocks = 16, requiredFactKeys = [], stage = "explanation", clarification = false, narrativeOnly = false }) {
  const fail = (rule) => { throw modelValidationError(rule, stage) }
  if (!output || typeof output !== "object" || Array.isArray(output) || Object.keys(output).some((key) => !["answer", "sections", "blocks", "cardIds"].includes(key)) || ["answer", "sections", "blocks"].filter((key) => Object.hasOwn(output, key)).length !== 1 || !Array.isArray(output.cardIds) || output.cardIds.length > (clarification ? 0 : 2)) fail("response_schema")
  if (output.cardIds.some((id) => typeof id !== "string" || !Object.hasOwn(cardMap, id))) fail("card_unknown")
  if (Object.hasOwn(output, "blocks")) {
    const referenced = new Set()
    const useFact = (key) => { if (Object.hasOwn(facts, key)) referenced.add(key) }
    const validateText = (text, kind) => {
      if (typeof text === "string") [...text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].forEach((match) => useFact(match[1]))
      return validateDevelopmentResponse({ sections: [{ kind, text }], cardIds: [] }, { facts, cardMap: {}, stage, clarification }).answer
    }
    let presentation = resolveModelResponseBlocks(output.blocks, { catalog, cardMap, allowedActions, validateText, useFact, maxBlocks })
    if (requiredFactKeys.some((key) => !referenced.has(key))) fail("scenario_result_missing")
    const shown = new Set(presentation.blocks.filter((block) => block.type === "comparison").map((block) => block.card.id))
    presentation = responsePresentation([...presentation.blocks, ...[...new Set(output.cardIds)].filter((id) => !shown.has(id)).map((id) => comparisonBlock(cardMap[id]))])
    if (presentation.blocks.length > maxBlocks) fail("response_schema")
    const cards = presentation.blocks.filter((block) => block.type === "comparison").map((block) => block.card)
    if (cards.length > 2) fail("response_schema")
    const answer = presentationText(presentation)
    if (!answer || answer.length > 9000) fail("answer_invalid")
    return { answer, cards, presentation }
  }
  const sections = Object.hasOwn(output, "answer") ? [{ kind: "legacy", text: output.answer }] : output.sections
  if (!Array.isArray(sections) || !sections.length || sections.length > 8) fail("response_schema")
  const usedFacts = new Set()
  const answer = sections.map((section) => {
    if (!section || Object.keys(section).some((key) => !["kind", "text"].includes(key)) || !["legacy", "recorded", "hypothetical", "recommendation"].includes(section.kind) || section.kind === "legacy" && Object.hasOwn(output, "sections") || typeof section.text !== "string" || section.kind !== "legacy" && section.text.length > 1600) fail("response_schema")
    const references = [...section.text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((match) => match[1])
    references.forEach((key) => usedFacts.add(key))
    let text
    try { text = resolveAnswer(section.text, facts, { qualitativeCounts: true }) } catch (error) { fail(error.validationRule || "response_schema") }
    // This checks asserted personal causation, not general explanatory language
    // or intent keywords. No retrieved record proves a person's motivations.
    const prose = section.text.replace(/\{\{[a-zA-Z0-9_]+\}\}/g, "the recorded item")
    if (/\byou\s+(?:(?:have|had)\s+)?(?:spent|overspent|spend)\b[^.!?\n]{0,160}\b(?:because|due to)\b|\byour\b[^.!?\n]{0,80}\b(?:was|were|is|are|increased|rose)\b[^.!?\n]{0,80}\b(?:because|caused by|due to)\b|\b(?:because|due to)\b[^.!?\n]{0,100}\b(?:your habits|you (?:always|often|impulsively))\b/i.test(prose)) fail("personal_cause_unsupported")
    const asserted = prose.replace(/\b(?:not|never|no|rather than)\s+(?:actual|recorded|achieved)\s+savings\b/gi, "")
    if (/\b(?:you(?:'ve| have)?|we)\s+(?:already\s+)?(?:saved|achieved)\b|\b(?:actual|recorded|achieved)\s+savings\b/i.test(asserted)) fail("scenario_claim_unsupported")
    if (/\b(?:is|are|was|were)\s+(?:unnecessary|wasteful|affordable)\b/i.test(prose)) fail("personal_classification_unsupported")
    const scenarios = references.filter((key) => facts[key].kind === "hypothetical")
    if (section.kind === "recorded" && references.some((key) => facts[key].kind === "requested")) fail("fact_kind_mismatch")
    if (section.kind === "recorded" && scenarios.length || section.kind === "recommendation" && scenarios.length) fail("fact_kind_mismatch")
    if (section.kind === "recorded" && !references.length || section.kind === "hypothetical" && !scenarios.length) fail("fact_required")
    if (clarification && (references.length || section.kind === "recorded" || section.kind === "hypothetical")) fail("fact_required")
    if (section.kind === "hypothetical" || scenarios.length) {
      const periods = [...new Set(scenarios.map((key) => facts[key].period).filter(Boolean))]
      text = `Hypothetical estimate${periods.length ? ` for ${periods.join("; ")}` : ""} (not recorded savings): ${text}`
    }
    return text
  }).join("\n\n")
  if (requiredFactKeys.some((key) => !usedFacts.has(key))) fail("scenario_result_missing")
  if (answer.length > 9000) fail("answer_too_long")
  if (narrativeOnly) return { answer }
  const narrative = sections.map((section) => {
    let text
    try { text = resolveAnswer(section.text, facts, { qualitativeCounts: true }) } catch (error) { fail(error.validationRule || "response_schema") }
    return section.kind === "recommendation" ? { type: "recommendation", title: "A practical next step", text } : section.kind === "hypothetical" ? { type: "notice", tone: "caution", text: `Hypothetical estimate · ${text}` } : { type: "paragraph", text }
  })
  const visuals = defaultBlocks.filter((block) => ["metric", "categories", "savings", "comparison"].includes(block.type)).slice(0, 4)
  const comparisonIds = new Set(visuals.filter((block) => block.type === "comparison").map((block) => block.card.id))
  const additionalCards = output.cardIds.filter((id) => !comparisonIds.has(cardMap[id].id)).map((id) => comparisonBlock(cardMap[id]))
  let presentation
  try { presentation = responsePresentation([...narrative, ...visuals, ...additionalCards, ...(allowedActions.length ? [{ type: "actions", ids: allowedActions }] : [])]) } catch { fail("response_schema") }
  if (presentation.blocks.length > maxBlocks) fail("response_schema")
  return { answer, cards: [...new Set(output.cardIds)].map((id) => cardMap[id]), presentation }
}
