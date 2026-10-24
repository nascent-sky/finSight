export const INITIAL_QUESTIONS = [
  "Where did my money go?",
  "How can I save ₹2,000?",
  "Show my biggest expenses",
  "Compare this month with last month",
  "What is my biggest spending category?",
]
export const MAX_MONEY_PAISE = 9_000_000_000_000

export function calculateComparison(previousPaise, currentPaise) {
  if ([previousPaise, currentPaise].some((value) => !Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_PAISE)) throw new Error("Comparison amounts must be valid non-negative integer paise.")
  const changePaise = currentPaise - previousPaise
  const percentage = previousPaise ? Math.round(changePaise / previousPaise * 1000) / 10 : null
  return { previousPaise, currentPaise, changePaise, percentage, direction: changePaise > 0 ? "up" : changePaise < 0 ? "down" : "flat" }
}

// Shared by Gemini output validation. The model supplies prose and references;
// all financial figures are inserted from the server's verified calculations.
export function resolveAnswer(answer, facts) {
  if (typeof answer !== "string" || !answer.trim() || answer.length > 6000) throw new Error("The AI returned an invalid answer. Please retry.")
  const stripped = answer.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(facts, key)) throw new Error("The AI referenced an unavailable calculation. Please retry.")
    return ""
  })
  const numericWords = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|lakhs?|crores?|percent|rupees?|inr)\b/i
  if (/[\p{N}₹%{}]/u.test(stripped) || numericWords.test(stripped)) throw new Error("The AI returned an unverified figure. Please retry.")
  const resolved = answer.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => facts[key].value)
  if (resolved.length > 9000) throw new Error("The AI returned an answer that is too long. Please retry.")
  return resolved
}

