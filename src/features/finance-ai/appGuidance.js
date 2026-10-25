import { responsePresentation } from "./responseBlocks.js"

export const APP_GUIDES = Object.freeze({ gpay_import: Object.freeze({
  title: "Import your Google Pay statement",
  steps: Object.freeze(["Open Import GPay and select your Google Pay statement PDF.", "Review the parsed transactions, including dates, amounts and income or expense types. Resolve any parsing errors before continuing.", "Choose Import Transactions to save the reviewed records. The import flow skips transaction IDs already saved."]),
  actionIds: Object.freeze(["gpay_import"]),
}) })

export function findAppGuide(question) {
  return /\b(?:gpay|google\s*pay)\b/i.test(question) && /\b(?:how|import|upload|add|statement|pdf)\b/i.test(question) ? "gpay_import" : null
}

export function appGuideResponse(guideId, context = null) {
  if (!Object.hasOwn(APP_GUIDES, guideId)) throw new Error("Unsupported application guide")
  const guide = APP_GUIDES[guideId]
  if (!guide) throw new Error("Unsupported application guide")
  const presentation = responsePresentation([{ type: "heading", text: guide.title }, { type: "list", ordered: true, items: [...guide.steps] }, { type: "actions", ids: [...guide.actionIds] }])
  return { answer: `${guide.title}\n${guide.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}`, cards: [], presentation, source: "local", context, cloud: { status: "not_requested" } }
}
