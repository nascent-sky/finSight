// Conservative corrections apply only to budgeting vocabulary, never arbitrary
// category names or people. A unique edit (including a transposition) is allowed.
const vocabulary = ["expense", "expenses", "spending", "transactions", "transaction", "purchases", "purchase", "biggest", "largest", "highest", "compare", "comparison", "income", "today", "yesterday", "month", "week", "category", "categories", "reduce"]
function near(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false
  if (a.length === b.length) {
    const differences = [...a].map((value, index) => value === b[index] ? -1 : index).filter((index) => index >= 0)
    return differences.length === 1 || differences.length === 2 && differences[1] === differences[0] + 1 && a[differences[0]] === b[differences[1]] && a[differences[1]] === b[differences[0]]
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  let index = 0
  while (short[index] === long[index] && index < short.length) index++
  return short.slice(index) === long.slice(index + 1)
}

export function normalizeQuestion(value) {
  return String(value).normalize("NFKC").toLowerCase()
    .replace(/\b(today|yesterday|week|month|year)[’']s\b/g, "$1")
    .replace(/[’']/g, "")
    .replace(/(?<=[a-z])[[\]{}](?=[a-z])/g, "")
    .replace(/\b[a-z]{5,}\b/g, (word) => {
      if (vocabulary.includes(word)) return word
      const candidates = vocabulary.filter((candidate) => near(word, candidate))
      return candidates.length === 1 ? candidates[0] : word
    }).replace(/\b(?:expenditure|expenditures|outgoings)\b/g, "expenses").replace(/\s+/g, " ").trim()
}

export const isContinuation = (text) => /\b(?:it|that|those|these|them|same)\b/.test(text) && /reduc|compar|show|list|explain|spen[dt]|cost|biggest|largest|contribut|sav|total/.test(text)
  || /what about|how about|month before that|which transactions contributed most|^(?:and )?(?:last|previous|this) (?:month|week)[?.!]*$|^(?:and )?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?: 20\d{2})?[?.!]*$/.test(text)
  || /^(?:and )?why(?:[?.!]*$|\b.*\b(?:higher|lower|more|less|increased|decreased)\b)/.test(text)

// Conservative local/offline social intents. Cloud conversations are classified
// semantically by Gemini; these complete-utterance matches never override a
// financial request or a relative financial follow-up in a mixed message.
export function localConversationReply(value) {
  const text = normalizeQuestion(value).replace(/[,.!?;:]+/g, " ").trim()
  if (/\b(?:spend|spent|spending|expenses?|income|earn|transactions?|purchases?|money|wallet|budget|sav(?:e|ing|ings)|cash|upi|costs?|bills?|rent|salary|debt|invest|categor\w*|compar\w*|reduc\w*|higher|lower)\b|[₹\d]/.test(text)) return null
  if (/^(?:(?:hi|hello|hey)(?: there)?\s+)?(?:how (?:are you(?: doing)?|you (?:doing|doin))|hows (?:it going|your day)|how about you|what about you|whats up|how was your day)(?:\s+today)?$/.test(text)) return "I'm here and ready to help. How are you doing?"
  if (/^(?:thanks?(?: you)?|thank you|cheers|appreciate (?:it|your help))(?:\s+(?:so much|a lot|that helped|for your help))?$/.test(text)) return "You're welcome! Happy to help."
  if (/^(?:im|i am|i feel) (?:good|fine|great|well|okay|ok|tired|happy|sad)(?:\s+(?:thanks|thank you|too))?$/.test(text)) return "Thanks for sharing. I'm here if you'd like a hand with anything."
  if (/^(?:(?:hi|hello|hey)\s+)?my name is\s+[a-z][a-z -]{0,60}$/.test(text) || /^(?:I['’]m|I am) [A-Z][a-z]+(?: [A-Z][a-z]+){0,2}[.!]*$/.test(String(value).trim())) return "Nice to meet you! How can I help?"
  if (/^(?:hi|hello|hey)(?: there| again)?$/.test(text)) return "Hi! How can I help?"
  if (/^(?:what can you do|who are you|tell me about yourself)$/.test(text)) return "I'm FinSight AI. I can help you explore spending, compare periods and think through ways to save."
  if (/^good (?:morning|afternoon|evening)$/.test(text)) return "Hello! How can I help?"
  if (/^(?:good night|have a (?:good|nice) day|bye|goodbye|see you(?: later)?)$/.test(text)) return "Take care! I'm here whenever you need a hand."
  return null
}

// Unconsumed meaning must reach interpretation/clarification instead of quietly
// disappearing into a default monthly total (e.g. a person's name or 'median').
const understoodWords = new Set(`a an the i me my mine we our you your did do does have has had is are was were be been can could would should will please show give tell find get see list itemize itemise each individual everything anything what which where when why how who much many all total totals amount money go went spend spent spending expense expenses purchase purchases buy bought paid payment payments transaction transactions income earn earned earnings net cash flow cashflow versus vs and or with without of on for at by in during from through to since over about into per every than as up down most more less increase increased increasing decrease decreased decreasing higher lower high low biggest largest highest expensive top category categories breakdown rundown percent percentage percentages share consume consumes contributed contribute contributes contributors comparison comparisons compare compared comparing analyse analyze explain analysis reduce reducing reduction save saving savings target habits habit patterns pattern routine recommend recommendations suggest suggestions advice help improve improvement improving today yesterday current this last previous past month months week weeks day days year years ytd time date before that it those these them same only just also then now yet recorded records actual upi via using method methods January February March April May June July August September October November December jan feb mar apr jun jul aug sep sept oct nov dec one two three six twelve eighteen twentyfour thirtysix seven thirty calendar including trends trend history`.toLowerCase().split(/\s+/))
export function hasUnresolvedMeaning(text, labels = []) {
  let remainder = text.replace(/\b\d[\d,.]*(?:-\d+)*\b/g, " ").replace(/₹|\brs\.?\b|\binr\b/g, " ")
  for (const label of labels.filter(Boolean).sort((a, b) => b.length - a.length)) {
    const escaped = normalizeQuestion(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    remainder = remainder.replace(new RegExp(`\\b${escaped}\\b`, "g"), " ")
  }
  return (remainder.match(/[a-z]+/g) || []).some((word) => !["am", "k", "thousand", "lakh", "crore"].includes(word) && !understoodWords.has(word))
}
