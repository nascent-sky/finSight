// Public, fixed demo questions. No user text is sent in synthetic mode.
export const SYNTHETIC_QUESTIONS = Object.freeze([
  { id: "overview", label: "Where did the demo money go?", question: "Where did my money go?" },
  { id: "compare_food", label: "Compare fictional food spending", question: "Compare food expenses this month with last month" },
  { id: "largest", label: "Show the biggest demo expenses", question: "Show my biggest expenses" },
  { id: "save", label: "Explore a fictional ₹2,000 savings target", question: "How can I save ₹2,000 this month?" },
  { id: "last_month", label: "What about the previous demo month?", question: "What about last month?" },
  { id: "contributors", label: "Which demo transactions contributed most?", question: "Which transactions contributed most?" },
  { id: "reduce", label: "How could the demo spending be reduced?", question: "How can I reduce it?" },
])

export const syntheticSuggestions = (hasAnswer) => SYNTHETIC_QUESTIONS.slice(hasAnswer ? 4 : 0, hasAnswer ? 7 : 4).map((question) => question.label)
