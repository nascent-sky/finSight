import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDownLeft, ArrowRight, ArrowUpRight, ChartNoAxesCombined, CircleAlert, LockKeyhole, MessageCircle, Plus, RotateCcw, Send, ShieldCheck, Sparkles, WifiOff } from "lucide-react"
import { Link } from "react-router-dom"
import { useExpenses } from "../context/ExpensesContext"
import { subscribeToTransactions } from "../services/transactionService"
import { requestFinanceChat, requestFinanceDemo } from "../services/financeChatService"
import { SYNTHETIC_QUESTIONS, syntheticSuggestions } from "../features/finance-ai/syntheticDemo"
import { INITIAL_QUESTIONS } from "../features/finance-ai/financialContext"
import { createFinancialIndex } from "../features/finance-ai/financialEngine"
import { answerFinanceQuestion } from "../features/finance-ai/chatOrchestrator"
import { formatExpenseAmount } from "../components/analytics/expenseChartUtils"
import "../features/finance-ai/financeChat.css"

const FOLLOW_UPS = ["What about last month?", "Which transactions contributed most?", "How can I reduce it?"]

function ComparisonCard({ card }) {
  const Direction = card.direction === "up" ? ArrowUpRight : card.direction === "down" ? ArrowDownLeft : ArrowRight
  return (
    <section className="ai-comparison" aria-label={`${card.title} comparison`}>
      <div className="ai-comparison-title"><ChartNoAxesCombined size={15} /><span>{card.title}</span><span className="ai-verified">Calculated by FinSight</span></div>
      <div className="ai-comparison-values">
        <div><p>{card.previousLabel}</p><strong>{formatExpenseAmount(card.previousPaise / 100)}</strong></div>
        <ArrowRight className="ai-comparison-arrow" size={18} aria-hidden="true" />
        <div><p>{card.currentLabel}</p><strong>{formatExpenseAmount(card.currentPaise / 100)}</strong></div>
      </div>
      <div className="ai-comparison-change"><Direction size={16} /><strong>{card.changePaise > 0 ? "+" : ""}{formatExpenseAmount(card.changePaise / 100)}</strong><span>{card.percentage == null ? "Percentage unavailable · no previous recorded amount" : `${card.percentage > 0 ? "+" : ""}${card.percentage}%`}</span></div>
      <p className="ai-comparison-note">{card.note || "Recorded transactions for the selected periods."}</p>
    </section>
  )
}

export function FinanceChatSession({ user, isOnline, mode = "personal", onModeChange, subscribeRecords = subscribeToTransactions, ask = requestFinanceChat, askDemo = requestFinanceDemo }) {
  const isDemo = mode === "synthetic"
  const [feed, setFeed] = useState({ ready: false, error: "", transactions: [] })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [feedAttempt, setFeedAttempt] = useState(0)
  const [sendAttempt, setSendAttempt] = useState(0)
  const [cloudStatus, setCloudStatus] = useState("not_checked")
  const sessionContext = useRef(null)
  const demoHistory = useRef([])
  const controller = useRef(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const guest = !user?.uid || user.isAnonymous
  const financialIndex = useMemo(() => createFinancialIndex(feed.transactions), [feed.transactions])

  useEffect(() => {
    if (guest || isDemo) return undefined
    return subscribeRecords(
      (transactions, metadata) => setFeed((previous) => ({ transactions, ready: Boolean(metadata?.isReady && !metadata?.fromCache && !metadata?.hasPendingWrites), error: metadata?.isReady ? "" : previous.error })),
      () => setFeed({ transactions: [], ready: false, error: "Your records could not be loaded. Please reconnect and retry." }),
    )
  }, [guest, isDemo, feedAttempt, subscribeRecords])

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (messages.length || busy || error) endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" })
  }, [messages.length, busy, error])

  const unavailable = guest || !isOnline || (!isDemo && (!feed.ready || Boolean(feed.error)))
  const canSend = !unavailable && !busy && !error && messages.length < 40 && (!isDemo || consent)
  const hasAnswer = messages.some((message) => message.role === "assistant")
  const suggestions = isDemo ? syntheticSuggestions(hasAnswer) : hasAnswer ? FOLLOW_UPS : INITIAL_QUESTIONS

  const reset = (revoke = false) => {
    controller.current?.abort()
    controller.current = null
    sessionContext.current = null
    demoHistory.current = []
    setMessages([])
    setInput("")
    setError("")
    setBusy(false)
    setSendAttempt(0)
    setCloudStatus("not_checked")
    if (revoke) setConsent(false)
    inputRef.current?.focus()
  }

  const send = async (question, retry = false) => {
    const content = question.trim()
    if (!content || content.length > 1200 || unavailable || controller.current || (!retry && error) || (!retry && messages.length >= 40)) return
    const history = retry ? messages : [...messages, { role: "user", content }]
    if (!retry) { setMessages(history); setInput("") }
    setError("")
    setBusy(true)
    setSendAttempt((attempt) => attempt + 1)
    const active = new AbortController()
    controller.current = active
    try {
      const now = new Date()
      const recent = history.slice(0, -1).filter((message) => message.role === "user").slice(-5).map(({ role, content }) => ({ role, content }))
      const selectedDemo = isDemo ? SYNTHETIC_QUESTIONS.find((question) => question.label === content) : null
      if (isDemo && !selectedDemo) throw new Error("Choose a fixed synthetic demo question below.")
      const result = isDemo ? await askDemo({ user, questionId: selectedDemo.id, history: demoHistory.current, consent, signal: active.signal })
        : await answerFinanceQuestion({ index: financialIndex, question: content, history: recent, context: sessionContext.current, consent, signal: active.signal, now, requestCloud: (request) => ask({ user, ...request }) })
      if (active.signal.aborted) return
      sessionContext.current = result.context || null
      if (isDemo) demoHistory.current = result.demoHistory || []
      if (["used", "unavailable"].includes(result.cloud?.status)) setCloudStatus(result.cloud.status)
      setMessages([...history, { role: "assistant", content: result.answer, cards: result.cards, asOf: result.asOf, source: result.source, cloud: result.cloud }])
    } catch (failure) {
      if (!active.signal.aborted) setError(failure.message || "FinSight AI could not connect. Please retry.")
    } finally {
      if (controller.current === active) { controller.current = null; setBusy(false) }
    }
  }

  const editFailedQuestion = () => {
    setInput(messages.at(-1)?.content || "")
    setMessages(messages.slice(0, -1))
    setError("")
    inputRef.current?.focus()
  }

  return (
    <div className="ai-page">
      <div className="ai-page-label"><span>YOUR MONEY, A LITTLE CLEARER</span><span><LockKeyhole size={12} /> Private by choice</span></div>
      <section className="ai-chat" aria-labelledby="ai-title">
        <header className="ai-header">
          <div className="ai-heading"><span className="ai-avatar"><Sparkles size={23} strokeWidth={1.6} /></span><div><h1 id="ai-title">FinSight <span>AI</span></h1><p>Your personal finance assistant</p></div></div>
          <button type="button" className="ai-new-chat" onClick={() => reset()}><Plus size={16} /><span>New chat</span></button>
        </header>
        {onModeChange && <div className="ai-sharing" role="group" aria-label="Chat data mode"><button type="button" aria-pressed={!isDemo} disabled={busy} onClick={() => onModeChange("personal")}>My finances</button><button type="button" aria-pressed={isDemo} disabled={busy || guest} onClick={() => onModeChange("synthetic")}>Synthetic Gemini demo</button></div>}
        {isDemo && <div className="ai-notice" role="status"><Sparkles size={18} /><div><strong>Synthetic demonstration · fictional data</strong><p>This isolated conversation uses fixed example records and questions. It never loads your financial records. Choose a prompt below to request a Gemini response.</p></div></div>}

        {guest ? (
          <div className="ai-notice" role="status"><LockKeyhole size={18} /><div><strong>Sign in to connect your finances</strong><p>AI chat is available for signed-in accounts. Your guest transactions stay on this device.</p><Link className="ai-text-link" to="/login?returnTo=/ai">Sign in to FinSight <ArrowRight size={14} /></Link></div></div>
        ) : !isOnline ? (
          <div className="ai-notice" role="status"><WifiOff size={18} /><div><strong>You’re offline</strong><p>Reconnect to ask FinSight AI. You can still manage your transactions offline.</p></div></div>
        ) : feed.error ? (
          <div className="ai-notice" role="alert"><CircleAlert size={18} /><div><strong>Couldn’t connect to your records</strong><p>{feed.error}</p><button type="button" className="ai-text-link" onClick={() => setFeedAttempt((attempt) => attempt + 1)}>Reload records <RotateCcw size={14} /></button></div></div>
        ) : !consent ? (
          <div className="ai-notice ai-consent"><ShieldCheck size={20} /><div><strong>You choose when to share</strong>{isDemo ? <p>The demo sends only server-owned fictional financial facts and fixed example questions to Gemini. No personal text or financial records are accepted.</p> : <><p>Direct answers use your synced records on this device. Free-tier Gemini receives only generic intent hints: no raw questions, actual amounts, dates, category labels, private notes, identifiers or financial summaries. Exact filters and calculations stay in FinSight.</p><p>If the operator has confirmed paid data handling, Gemini can also interpret your question and recent questions and explain relevant calculated totals, category/date aggregates and up to five expenses. Names, notes and transaction IDs are excluded.</p></>}<p>Gemini requires a configured backend key. Allowing sharing does not confirm availability. Chat stays in memory while this page is open.</p><button type="button" className="ai-enable" onClick={() => setConsent(true)}>Allow cloud AI for this chat <ArrowRight size={14} /></button><a className="ai-privacy-link" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini data policy</a></div></div>
        ) : (
          <div className="ai-sharing"><span><ShieldCheck size={14} /> Cloud sharing allowed · {cloudStatus === "used" ? "Gemini used on last cloud request" : cloudStatus === "unavailable" ? "Gemini unavailable on last attempt" : "Gemini availability not checked"}</span><button type="button" onClick={() => reset(true)}>Turn off & clear</button></div>
        )}
        {!isDemo && !guest && isOnline && !feed.ready && !feed.error && <p className="ai-sync-status" role="status">Syncing your records before AI can answer…</p>}

        <div className="ai-conversation" role="log" aria-label="Conversation with FinSight AI" aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
          {!messages.length ? (
            <div className="ai-empty">
              <div className="ai-empty-icon"><Sparkles size={32} strokeWidth={1.4} /></div>
              <span className="ai-eyebrow">MEET FINSIGHT AI</span>
              <h2>{isDemo ? "Explore a fictional budget." : "Make sense of your money."}</h2>
              <p>{isDemo ? "See Gemini explain fixed example data in an isolated conversation." : <>Explore your spending, spot what changed,<br className="hidden sm:block" /> and find a little more room to save.</>}</p>
              <div className="ai-empty-tags"><span><ChartNoAxesCombined size={14} /> {isDemo ? "Synthetic records only" : "Real records"}</span><span><ShieldCheck size={14} /> Calculated insights</span></div>
            </div>
          ) : messages.map((message, index) => (
            <article className={`ai-message ai-message-${message.role}`} key={`${index}-${message.role}`} aria-label={message.role === "user" ? "You" : "FinSight AI"}>
              {message.role === "assistant" && <span className="ai-message-sparkle"><Sparkles size={19} /></span>}
              <div className="ai-message-body"><p className="ai-message-author">{message.role === "user" ? "You" : "FinSight AI"}</p><p className="ai-message-text">{message.content}</p>{message.cards?.map((card) => <ComparisonCard key={card.id} card={card} />)}{message.asOf && <p className="ai-record-date">{message.source === "gemini_demo" ? "Synthetic demonstration · Gemini response · Fictional reference date" : message.source === "gemini" ? "Gemini cloud explanation · Records through" : message.source === "gemini_intent" ? "Gemini interpreted · FinSight calculated · Records through" : "Local financial answer · Records through"} {message.asOf}.</p>}{message.cloud?.reason && <p className="ai-record-date" role="status">{message.cloud.reason}</p>}</div>
            </article>
          ))}
          {busy && <div className="ai-typing" role="status" key={sendAttempt}><Sparkles size={18} /><span>Looking at your records</span><span className="ai-dots" aria-hidden="true"><i /><i /><i /></span></div>}
          {error && <div className="ai-error" role="alert"><CircleAlert size={18} /><div><strong>Couldn’t get an answer</strong><p>{error}</p><div className="ai-error-actions"><button type="button" disabled={unavailable || busy} onClick={() => send(messages.at(-1)?.content || "", true)}><RotateCcw size={14} /> Retry</button><button type="button" onClick={editFailedQuestion}>Edit question</button></div></div></div>}
          <div ref={endRef} />
        </div>

        <footer className="ai-footer">
          <div className="ai-suggestions"><p>{hasAnswer ? "KEEP EXPLORING" : "TRY ASKING"}</p><div>{suggestions.map((question) => <button type="button" key={question} disabled={!canSend} onClick={() => send(question)}>{question}<ArrowRight size={13} aria-hidden="true" /></button>)}</div></div>
          {messages.length >= 40 && <p className="ai-session-limit" role="status">Start a new chat to keep exploring. This chat has reached its session limit.</p>}
          <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); send(input) }}>
            {isDemo ? <select className="ai-demo-select" aria-label="Synthetic demo question" value={input} onChange={(event) => setInput(event.target.value)} disabled={!canSend}><option value="">Choose a fictional example question…</option>{SYNTHETIC_QUESTIONS.map((question) => <option value={question.label} key={question.id}>{question.label}</option>)}</select> : <textarea ref={inputRef} aria-label="Ask FinSight AI" rows={2} maxLength={1200} value={input} onChange={(event) => setInput(event.target.value)} disabled={unavailable || busy || Boolean(error) || messages.length >= 40} placeholder={guest ? "Sign in to start a conversation" : !isOnline ? "Reconnect to continue your chat" : "Ask anything about your finances…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(input) } }} />}
            <button type="submit" className="ai-send" aria-label="Send question" disabled={!canSend || !input.trim()}><Send size={19} /></button>
          </form>
          <div className="ai-footer-note"><span><LockKeyhole size={11} /> {isDemo ? "Fictional examples only · isolated chat" : guest ? "Guest data stays on your device" : consent ? "Safe intents · personal context requires paid handling" : "Direct answers stay on this device"}</span><span>{input.length > 1000 ? `${input.length}/1200 · ` : ""}AI can make mistakes. Check important details.</span></div>
          {!isDemo && !guest && feed.ready && feed.transactions.length === 0 && <p className="ai-no-records">No recorded transactions yet. <Link to="/expenses">Add a transaction</Link> to get personal insights.</p>}
        </footer>
      </section>
      <p className="ai-below"><MessageCircle size={13} /> A conversation about your finances. A clearer next step.</p>
    </div>
  )
}

export default function FinSightAI() {
  const { user, isOnline } = useExpenses()
  const [mode, setMode] = useState("personal")
  // Account changes unmount the previous chat and abort any pending request.
  return <FinanceChatSession key={`${user?.uid || "guest"}-${mode}`} user={user} isOnline={isOnline} mode={mode} onModeChange={setMode} />
}
