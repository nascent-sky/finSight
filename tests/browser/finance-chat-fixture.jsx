// Development-only UI fixture. Not imported by the app or included in Vite's
// production entry. All records and responses here are explicitly synthetic.
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { FinanceChatSession } from "../../src/pages/FinSightAI"
import { buildThemeVariables } from "../../src/services/themeService"
import { createFinancialIndex, analyseFinancialQuery } from "../../src/features/finance-ai/financialEngine"
import { planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner"
import "../../src/index.css"

const now = new Date()
const records = [
  { id: "qa-food-current", type: "expense", category: "Food & Dining", amount: 3450, paymentMethod: "upi", datetime: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() },
  { id: "qa-food-previous", type: "expense", category: "Food & Dining", amount: 2800, paymentMethod: "cash", datetime: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString() },
  { id: "qa-income", type: "income", category: "Income", amount: 45000, paymentMethod: "upi", datetime: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() },
]
const subscribeRecords = (callback) => { callback(records, { isReady: true, fromCache: false }); return () => {} }
const user = { uid: "local-qa-only", isAnonymous: false }

export default function Fixture() {
  const [mode, setMode] = useState("light")
  const [guest, setGuest] = useState(false)
  const [online, setOnline] = useState(true)
  const [fail, setFail] = useState(false)
  const [calls, setCalls] = useState([])
  const [account, setAccount] = useState("local-qa-only")
  const ask = async (request) => {
    setCalls((previous) => [...previous, request.messages.at(-1).content])
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 800)
      request.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")) }, { once: true })
    })
    if (fail) throw new Error("QA-only simulated provider failure. No external request was made.")
    const index = createFinancialIndex(records)
    const plan = planFinancialQuestion(request.messages.at(-1).content, request.messages.slice(0, -1), { timezone: index.timezone, categoryNames: index.categoryNames })
    const analysis = analyseFinancialQuery(index, plan)
    return { answer: `LOCAL QA CLOUD RESPONSE · Synthetic fixture only.\n${analysis.answer}`, cards: analysis.cards, asOf: index.asOf, source: "gemini" }
  }
  return <BrowserRouter><div style={{ ...buildThemeVariables("classic", mode), background: "var(--bg-color)", color: "var(--text-color)", minHeight: "100vh", padding: "16px" }}>
    <div style={{ fontSize: "12px", display: "flex", flexWrap: "wrap", gap: "12px", maxWidth: "1060px", margin: "0 auto 20px" }}>
      <strong style={{ width: "100%" }}>LOCAL QA FIXTURE · Synthetic data · No AI/provider or Firestore requests</strong>
      <label>Theme <select aria-label="QA theme" value={mode} onChange={(event) => setMode(event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label><input aria-label="QA guest" type="checkbox" checked={guest} onChange={(event) => setGuest(event.target.checked)} /> Guest</label>
      <label><input aria-label="QA offline" type="checkbox" checked={!online} onChange={(event) => setOnline(!event.target.checked)} /> Offline</label>
      <label><input aria-label="QA failure" type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} /> Fail next response</label>
      <button type="button" onClick={() => setAccount((value) => value === "local-qa-only" ? "another-qa-account" : "local-qa-only")}>Switch QA account</button>
      <output aria-label="QA request count">Requests: {calls.length}</output>
      <output aria-label="QA last question">Last question: {calls.at(-1) || "none"}</output>
    </div>
    <FinanceChatSession key={guest ? "guest" : account} user={guest ? null : { ...user, uid: account }} isOnline={online} subscribeRecords={subscribeRecords} ask={ask} />
  </div></BrowserRouter>
}

createRoot(document.getElementById("root")).render(<Fixture />)
