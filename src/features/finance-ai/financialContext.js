export const INITIAL_QUESTIONS = [
  "Where did my money go?",
  "How can I save ₹2,000?",
  "Show my biggest expenses",
  "Compare this month with last month",
  "What is my biggest spending category?",
]
export const MAX_MONEY_PAISE = 9_000_000_000_000

export function calculateHypotheticalReduction(paise, reductionBps) {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > MAX_MONEY_PAISE || !Number.isInteger(reductionBps) || reductionBps < 0 || reductionBps > 10000) throw new Error("Invalid hypothetical reduction parameters")
  const savingPaise = Number((BigInt(paise) * BigInt(reductionBps) + 5000n) / 10000n)
  return { originalPaise: paise, reductionBps, savingPaise, remainingPaise: paise - savingPaise }
}

export function calculateComparison(previousPaise, currentPaise) {
  if ([previousPaise, currentPaise].some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_PAISE)) throw new Error("Comparison amounts must be valid non-negative integer paise.")
  const changePaise = currentPaise - previousPaise
  const percentage = previousPaise ? Math.round(changePaise / previousPaise * 1000) / 10 : null
  return { previousPaise, currentPaise, changePaise, percentage, direction: changePaise > 0 ? "up" : changePaise < 0 ? "down" : "flat" }
}

// Shared by Gemini output validation. The model supplies prose and references;
// all financial figures are inserted from the server's verified calculations.
export function resolveAnswer(answer, facts, { qualitativeCounts = false } = {}) {
  const invalid = (rule, message) => { throw Object.assign(new Error(message), { validationRule: rule }) }
  if (typeof answer !== "string" || !answer.trim()) invalid("answer_invalid", "The AI returned an invalid answer. Please retry.")
  if (answer.length > 6000) invalid("answer_too_long", "The AI returned an invalid answer. Please retry.")
  const stripped = answer.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(facts, key)) invalid("fact_unknown", "The AI referenced an unavailable calculation. Please retry.")
    return ""
  })
  if (/[{}]/.test(stripped)) invalid("placeholder_malformed", "The AI returned a malformed financial reference. Please retry.")
  // Counts of proposed actions are prose, not money, dates or recorded counts.
  // This narrow exception never permits digits, units, amounts or percentages.
  const prose = qualitativeCounts ? stripped.replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+(?:practical|small|simple|possible|useful|specific|suggested)){0,2}\s+(?:ways?|steps?|improvements?|options?|ideas?|suggestions?|changes?|recommendations?)\b/gi, "") : stripped
  const numericWords = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|lakhs?|crores?|percent|rupees?|inr)\b/i
  if (/[\p{N}₹%]/u.test(prose) || numericWords.test(prose)) invalid("figure_unverified", "The AI returned an unverified figure. Please retry.")
  // A complete verified sentence already includes its final punctuation.
  // Only coalesce the placeholder boundary; decimals and prose stay intact.
  const resolved = answer.replace(/\{\{([a-zA-Z0-9_]+)\}\}([.!?])?/g, (_, key, punctuation = "") => {
    const value = String(facts[key].value)
    return value.endsWith(punctuation) ? value : value + punctuation
  })
  if (resolved.length > 9000) invalid("answer_too_long", "The AI returned an answer that is too long. Please retry.")
  return resolved
}

