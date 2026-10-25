import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, ChartNoAxesCombined, CircleAlert, LockKeyhole, MessageCircle, Plus, RotateCcw, Send, ShieldCheck, Sparkles, WifiOff } from "lucide-react"
import { Link } from "react-router-dom"
import { useExpenses } from "../context/ExpensesContext"
import { requestFinanceCapabilities, requestFinanceChat, requestFinanceRoute, subscribeFinanceRecords } from "../services/financeChatService"
import { financeSourceLabel, localRoutingReason } from "../features/finance-ai/financeRouting"
import { answerDemoQuestion, createDemoFinancialIndex } from "../features/finance-ai/demoAnalysis"
import { financeErrorMessage, financePrivacyMessage, financeSessionIdentity } from "../features/finance-ai/financeSession"
import { INITIAL_QUESTIONS } from "../features/finance-ai/financialContext"
import { createFinancialIndex } from "../features/finance-ai/financialEngine"
import { answerFinanceQuestion } from "../features/finance-ai/chatOrchestrator"
import AssistantResponse from "../features/finance-ai/AssistantResponse"
import { RESPONSE_FOLLOWUPS } from "../features/finance-ai/responseBlocks"
import "../features/finance-ai/financeChat.css"
import "../features/finance-ai/responseBlocks.css"

const FOLLOW_UPS = ["What about last month?", "Which transactions contributed most?", "How can I reduce it?"]

export function FinanceChatSession({ user, isAuthReady = false, ...props }) {
  const session = financeSessionIdentity({ user, isAuthReady })
  if (session.mode === "loading") return <div className="ai-page"><section className="ai-chat" aria-busy="true"><header className="ai-header"><div className="ai-heading"><span className="ai-avatar"><Sparkles size={23} /></span><div><h1>FinSight <span>AI</span></h1><p role="status">Checking your account…</p></div></div></header></section></div>
  // Remount synchronously on every account/source transition. No prior messages,
  // context, consent or in-flight response can enter the next session's render.
  return <FinanceChatConversation key={session.key} {...props} user={user} isDemo={session.mode === "demo"} />
}

function FinanceChatConversation({ user, isOnline, isDemo, subscribeRecords = subscribeFinanceRecords, ask = requestFinanceChat, getCapabilities = requestFinanceCapabilities, routeQuestion = requestFinanceRoute }) {
  const [feed, setFeed] = useState({ ready: false, error: "", transactions: [] })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [feedAttempt, setFeedAttempt] = useState(0)
  const [sendAttempt, setSendAttempt] = useState(0)
  const [cloudStatus, setCloudStatus] = useState("not_checked")
  const [policy, setPolicy] = useState(null)
  const sessionContext = useRef(null)
  const controller = useRef(null)
  const lastRequest = useRef(null)
  const endRef = useRef(null)
  const inputRef = useRef(null)
  const financialIndex = useMemo(() => isDemo ? createDemoFinancialIndex() : createFinancialIndex(feed.ownerUid === user?.uid ? feed.transactions : []), [isDemo, feed.ownerUid, feed.transactions, user?.uid])
  const isDevelopment = !isDemo && policy?.mode === "development"
  const developer = !isDemo && (import.meta.env.DEV || policy?.development?.allowlisted === true)
  const checkingPolicy = !isDemo && isOnline && policy === null

  useEffect(() => {
    if (isDemo || !isOnline || policy !== null) return undefined
    const active = new AbortController()
    getCapabilities({ user, signal: active.signal }).then((value) => {
      if (!active.signal.aborted) setPolicy(value)
    }).catch((failure) => {
      if (!active.signal.aborted) setPolicy({ error: failure.message || "Cloud routing could not be checked. Retry the routing check.", code: failure.code || "AI_ROUTING_UNVERIFIED" })
    })
    return () => active.abort()
  }, [isDemo, isOnline, policy, getCapabilities, user])

  useEffect(() => {
    if (isDemo) return undefined
    let active = true
    const unsubscribe = subscribeRecords(
      (transactions, metadata) => {
        if (active && (!metadata?.ownerUid || metadata.ownerUid === user.uid)) setFeed((previous) => ({ transactions, ownerUid: user.uid, ready: Boolean(metadata?.isReady && !metadata?.fromCache && !metadata?.hasPendingWrites), error: metadata?.isReady ? "" : previous.error }))
      },
      () => { if (active) setFeed({ transactions: [], ownerUid: user.uid, ready: false, error: "Your records could not be loaded. Please reconnect and retry." }) },
      { user },
    )
    return () => { active = false; unsubscribe?.() }
  }, [isDemo, feedAttempt, subscribeRecords, user])

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (messages.length || busy || error) endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "nearest" })
  }, [messages.length, busy, error])

  const unavailable = !isDemo && (!isOnline || !feed.ready || feed.ownerUid !== user?.uid || Boolean(feed.error))
  const canSend = !unavailable && !busy && !error && messages.length < 40
  const hasAnswer = messages.some((message) => message.role === "assistant")
  const suggestedIds = messages.slice().reverse().find((message) => message.role === "assistant")?.presentation?.blocks.find((block) => block.type === "followups")?.ids
  const suggestions = suggestedIds?.length ? suggestedIds.map((id) => RESPONSE_FOLLOWUPS[id]) : hasAnswer ? FOLLOW_UPS : INITIAL_QUESTIONS

  const reset = (revoke = false) => {
    controller.current?.abort()
    controller.current = null
    sessionContext.current = null
    lastRequest.current = null
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
    const replay = retry && lastRequest.current?.question === content ? lastRequest.current : null
    const history = replay ? replay.history : retry ? messages : [...messages, { role: "user", content }]
    const requestContext = replay ? replay.context : sessionContext.current
    if (!retry) lastRequest.current = { question: content, history, context: requestContext }
    if (!retry) { setMessages(history); setInput("") }
    setError("")
    setBusy(true)
    setSendAttempt((attempt) => attempt + 1)
    const active = new AbortController()
    controller.current = active
    try {
      const now = new Date()
      const previous = history.slice(0, -1)
      const recent = previous.slice(-10).map(({ role, content }) => ({ role, content: role === "assistant" ? content.slice(0, 2000) : content }))
      const result = isDemo ? await answerDemoQuestion({ question: content, history: recent, context: requestContext, signal: active.signal })
        : await answerFinanceQuestion({ index: financialIndex, question: content, history: recent, context: requestContext, consent, development: isDevelopment, policy, signal: active.signal, now, requestRoute: (request) => routeQuestion({ user, ...request }), requestCloud: (request) => ask({ user, ...request }) })
      if (active.signal.aborted) return
      sessionContext.current = result.context || null
      if (result.policy) setPolicy(result.policy)
      if (["used", "unavailable"].includes(result.cloud?.status)) setCloudStatus(result.cloud.status)
      setMessages([...history, { role: "assistant", content: result.answer, cards: result.cards, presentation: result.presentation, asOf: result.asOf, source: result.source, cloud: result.cloud, routing: result.routing, recovery: result.recovery }])
    } catch (failure) {
      if (!active.signal.aborted) { setCloudStatus("unavailable"); setError(financeErrorMessage(failure, developer)) }
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

  const useLocalAnalysis = () => {
    // Cloud scopes can use a different contract. Re-plan from bounded user
    // questions and this account's own index when the user selects local work.
    sessionContext.current = undefined
    editFailedQuestion()
    setConsent(false)
    setCloudStatus("not_checked")
  }

  return (
    <div className="ai-page">
      <div className="ai-page-label"><span>YOUR MONEY, A LITTLE CLEARER</span><span><LockKeyhole size={12} /> {isDemo ? "Sample data only" : "Private by choice"}</span></div>
      <section className="ai-chat" aria-labelledby="ai-title">
        <header className="ai-header">
          <div className="ai-heading"><span className="ai-avatar"><Sparkles size={23} strokeWidth={1.6} /></span><div><h1 id="ai-title">FinSight <span>AI</span></h1><p>Your personal finance assistant</p></div></div>
          <button type="button" className="ai-new-chat" onClick={() => reset()}><Plus size={16} /><span>New chat</span></button>
        </header>
        {isDemo && <div className="ai-demo-status" role="status"><span><Sparkles size={13} /> Demo · Sample financial data</span><span>Local analysis · No cloud requests</span></div>}
        {policy?.error && <div className="ai-sharing" role="alert"><span>{financePrivacyMessage(policy, consent)}</span><button type="button" disabled={busy} onClick={() => setPolicy(null)}>Retry routing check</button></div>}
        {!isDemo && policy && !policy.error && <p className="ai-sync-status" role="status" data-routing-code={localRoutingReason(policy, consent).code}>{financePrivacyMessage(policy, consent)}</p>}
        {developer && policy && <details className="ai-developer-details"><summary>Developer diagnostics</summary><pre>{JSON.stringify({ code: policy.code, routingVersion: policy.routingVersion, mode: policy.mode, reasons: policy.reasons?.map(({ code }) => code), diagnostics: policy.diagnostics }, null, 2)}</pre></details>}

        {!isDemo && (!isOnline ? (
          <div className="ai-notice" role="status"><WifiOff size={18} /><div><strong>You’re offline</strong><p>Reconnect to ask FinSight AI. You can still manage your transactions offline.</p></div></div>
        ) : feed.error ? (
          <div className="ai-notice" role="alert"><CircleAlert size={18} /><div><strong>Couldn’t connect to your records</strong><p>{feed.error}</p><button type="button" className="ai-text-link" onClick={() => setFeedAttempt((attempt) => attempt + 1)}>Reload records <RotateCcw size={14} /></button></div></div>
        ) : !consent ? (
          <div className="ai-notice ai-consent"><ShieldCheck size={20} /><div><strong>You choose when to share</strong>{isDevelopment ? <p>This designated test account must contain only fictional data. Allow full questions, recent conversation, selected dates/categories, relevant fictional transactions and verified summaries to reach Gemini. Record people, notes and IDs are excluded, and known credentials and identifiers are removed. Use only fictional questions and records.</p> : <><p>Local financial analysis uses only your synced records on this device. Cloud sharing is optional and stays off until you allow it for this chat.</p>{policy?.mode === "paid" ? <p>The approved cloud policy allows your questions, recent questions and relevant calculated financial context to reach Gemini. Record names, private notes and transaction IDs are excluded.</p> : <p>Cloud financial explanations are restricted for this account. If you allow sharing, Gemini can interpret generic intent hints; raw questions, amounts, dates, category labels and financial records stay in FinSight.</p>}</>}<p>Chat stays in memory and clears when your account changes.</p><button type="button" className="ai-enable" disabled={checkingPolicy || Boolean(policy?.error) || !policy?.cloudConfigured} onClick={() => setConsent(true)}>{checkingPolicy ? "Checking cloud availability…" : "Allow cloud AI for this chat"} <ArrowRight size={14} /></button><a className="ai-privacy-link" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini data policy</a></div></div>
        ) : (
          <div className="ai-sharing"><span><ShieldCheck size={14} /> Cloud sharing allowed · {cloudStatus === "used" ? "Gemini used on last cloud request" : cloudStatus === "unavailable" ? "Cloud request failed on last attempt" : "Gemini availability not checked"}</span><button type="button" onClick={() => reset(true)}>Turn off & clear</button></div>
        ))}
        {!isDemo && isOnline && !feed.ready && !feed.error && <p className="ai-sync-status" role="status">Syncing your records before AI can answer…</p>}

        <div className="ai-conversation" role="log" aria-label="Conversation with FinSight AI" aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
          {!messages.length ? (
            <div className="ai-empty">
              <div className="ai-empty-icon"><Sparkles size={32} strokeWidth={1.4} /></div>
              <span className="ai-eyebrow">MEET FINSIGHT AI</span>
              <h2>{isDemo ? "Explore a fictional budget." : "Make sense of your money."}</h2>
              <p>{isDemo ? "Explore a sample budget across several months. Your transactions are not used." : <>Explore your spending, spot what changed,<br className="hidden sm:block" /> and find a little more room to save.</>}</p>
              <div className="ai-empty-tags"><span><ChartNoAxesCombined size={14} /> {isDemo ? "Sample records" : "Real records"}</span><span><ShieldCheck size={14} /> Calculated insights</span></div>
            </div>
          ) : messages.map((message, index) => (
            <article className={`ai-message ai-message-${message.role}`} key={`${index}-${message.role}`} aria-label={message.role === "user" ? "You" : "FinSight AI"}>
              {message.role === "assistant" && <span className="ai-message-sparkle"><Sparkles size={19} /></span>}
              <div className="ai-message-body"><p className="ai-message-author">{message.role === "user" ? "You" : "FinSight AI"}</p>{message.role === "user" ? <p className="ai-message-text">{message.content}</p> : <div className="ai-message-text"><AssistantResponse answer={message.content} cards={message.cards} presentation={message.presentation} inlineFollowups={false} onFollowup={send} disabled={!canSend} /></div>}{message.role === "assistant" && <p className="ai-record-date" data-routing-code={message.routing?.code}>{financeSourceLabel(message.source)}{message.asOf ? ` · ${isDemo ? "Sample reference date" : "Records through"} ${message.asOf}.` : ""}</p>}{message.recovery?.kind === "narrative_consistency" && index === messages.length - 1 && <div className="ai-error-actions"><button type="button" disabled={unavailable || busy} onClick={() => send(lastRequest.current?.question || "", true)}><RotateCcw size={14} /> Retry Gemini explanation</button></div>}</div>
            </article>
          ))}
          {busy && <div className="ai-typing" role="status" key={sendAttempt}><Sparkles size={18} /><span>{isDemo ? "Exploring sample records" : "Looking at your records"}</span><span className="ai-dots" aria-hidden="true"><i /><i /><i /></span></div>}
          {error && <div className="ai-error" role="alert"><CircleAlert size={18} /><div><strong>Couldn’t get an answer</strong><p>{error}</p><div className="ai-error-actions"><button type="button" disabled={unavailable || busy} onClick={() => send(messages.at(-1)?.content || "", true)}><RotateCcw size={14} /> Retry</button><button type="button" onClick={editFailedQuestion}>Edit question</button>{!isDemo && consent && <button type="button" onClick={useLocalAnalysis}>Use local analysis</button>}</div></div></div>}
          <div ref={endRef} />
        </div>

        <footer className="ai-footer">
          <div className="ai-suggestions"><p>{hasAnswer ? "KEEP EXPLORING" : "TRY ASKING"}</p><div>{suggestions.map((question) => <button type="button" key={question} disabled={!canSend} onClick={() => send(question)}>{question}<ArrowRight size={13} aria-hidden="true" /></button>)}</div></div>
          {messages.length >= 40 && <p className="ai-session-limit" role="status">Start a new chat to keep exploring. This chat has reached its session limit.</p>}
          <form className="ai-composer" onSubmit={(event) => { event.preventDefault(); send(input) }}>
            <textarea ref={inputRef} aria-label="Ask FinSight AI" rows={2} maxLength={1200} value={input} onChange={(event) => setInput(event.target.value)} disabled={unavailable || busy || Boolean(error) || messages.length >= 40} placeholder={isDemo ? "Ask about the sample finances…" : !isOnline ? "Reconnect to continue your chat" : "Ask anything about your finances…"} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(input) } }} />
            <button type="submit" className="ai-send" aria-label="Send question" disabled={!canSend || !input.trim()}><Send size={19} /></button>
          </form>
          <div className="ai-footer-note"><span><LockKeyhole size={11} /> {isDemo ? "Local demo · Sample reference: 24 Oct 2026" : isDevelopment ? "Fictional test account · Sharing by consent" : consent ? "Cloud sharing follows your account's privacy policy" : "Direct answers stay on this device"}</span><span>{input.length > 1000 ? `${input.length}/1200 · ` : ""}AI can make mistakes. Check important details.</span></div>
          {!isDemo && feed.ready && feed.transactions.length === 0 && <p className="ai-no-records">No recorded transactions yet. <Link to="/expenses">Add a transaction</Link> to get personal insights.</p>}
        </footer>
      </section>
      <p className="ai-below"><MessageCircle size={13} /> A conversation about your finances. A clearer next step.</p>
    </div>
  )
}

export default function FinSightAI() {
  const { user, isOnline, isAuthReady } = useExpenses()
  return <FinanceChatSession user={user} isOnline={isOnline} isAuthReady={isAuthReady} />
}
