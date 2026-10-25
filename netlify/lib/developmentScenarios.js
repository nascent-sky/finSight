export { calculateHypotheticalReduction } from "../../src/features/finance-ai/financialContext.js"

export function requestedReductions(conversation, scope) {
  const rates = new Set((scope?.queries || []).map((query) => query.reductionBps).filter((value) => value != null))
  for (const match of conversation.at(-1).content.matchAll(/(?<![\d.,-])(\d+(?:\.\d{1,2})?)\s*(?:%|percent\b)/gi)) {
    const [whole, fraction = ""] = match[1].split(".")
    const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
    if (Number.isSafeInteger(bps) && bps >= 0 && bps <= 10000) rates.add(bps)
  }
  return rates
}
