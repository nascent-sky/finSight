import { ArrowDownLeft, ArrowRight, ArrowUpRight, Bus, ChartNoAxesCombined, CircleAlert, Clapperboard, Gift, GraduationCap, HeartPulse, House, Lightbulb, ListOrdered, Plane, ReceiptText, ShoppingBag, TrendingDown, TrendingUp, Utensils } from "lucide-react"
import { Link } from "react-router-dom"
import { formatExpenseAmount, getCategoryColor } from "../../components/analytics/expenseChartUtils"
import { chronologicalComparison, RESPONSE_ACTIONS, RESPONSE_FOLLOWUPS, textResponseBlocks, validateResponsePresentation } from "./responseBlocks"

const money = (paise) => formatExpenseAmount(paise / 100)
function Highlight({ text }) {
  return text.split(/([+-]?₹[\d,]+(?:\.\d{1,2})?)/g).map((part, i) => /^[+-]?₹/.test(part) ? <span className="ai-key-amount" key={i}>{part}</span> : part)
}
function InlineText({ text }) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) => part.startsWith("**") && part.endsWith("**") ? <strong key={i}><Highlight text={part.slice(2, -2)} /></strong> : <Highlight text={part} key={i} />)
}

export function ComparisonCard({ card: input }) {
  const card = chronologicalComparison(input)
  const Direction = card.direction === "up" ? ArrowUpRight : card.direction === "down" ? ArrowDownLeft : ArrowRight
  const favorable = card.metric === "income" ? card.direction === "up" : card.metric !== "category" && card.direction === "down"
  const tone = card.direction === "flat" || card.metric === "category" ? "info" : favorable ? "positive" : "negative"
  const trend = card.direction === "flat" ? "Unchanged" : card.metric === "income" ? card.direction === "up" ? "Income increased" : "Income decreased" : card.metric === "category" ? "Category difference" : card.direction === "up" ? "More spending" : "Less spending"
  return <section className={`ai-comparison ai-trend-${tone}`} aria-label={`${card.title} comparison`}>
    <div className="ai-comparison-title"><ChartNoAxesCombined size={15} aria-hidden="true" /><span>{card.title}</span><span className="ai-verified">Calculated by FinSight</span></div>
    <div className="ai-comparison-values"><div><p>{card.previousLabel}</p><strong>{money(card.previousPaise)}</strong></div><ArrowRight className="ai-comparison-arrow" size={18} aria-hidden="true" /><div><p>{card.currentLabel}</p><strong>{money(card.currentPaise)}</strong></div></div>
    <div className="ai-comparison-change"><Direction size={16} aria-hidden="true" /><strong>{card.changePaise > 0 ? "+" : ""}{money(card.changePaise)}</strong><span>{card.percentage == null ? "N/A · no previous recorded amount" : `${card.percentage > 0 ? "+" : ""}${card.percentage}%`}</span><span className="ai-trend-label">{trend}</span></div>
    {card.note?.includes("partial") && <p className="ai-comparison-note">The current period is incomplete.</p>}
    {card.note && <details className="ai-scope-details"><summary>Scope details</summary><p>{card.note}</p></details>}
  </section>
}

function Metric({ block }) {
  const Icon = block.semantic === "income" ? TrendingUp : block.semantic === "expense" ? TrendingDown : ChartNoAxesCombined
  return <section className={`ai-metric ai-semantic-${block.semantic === "net" && block.amountPaise < 0 ? "negative" : block.semantic}`} aria-label={`${block.label} metric`}><dl><dt><Icon size={15} aria-hidden="true" />{block.label}</dt><dd>{money(block.amountPaise)}</dd></dl><p>{block.period}</p></section>
}
function Savings({ block, compact = false }) {
  if (compact) return <div className="ai-savings-inline" aria-label="Hypothetical savings estimate"><strong>{money(block.savingPaise)}</strong><span>{block.reductionBps == null ? "conditional hypothetical reduction" : `${block.reductionBps / 100}% hypothetical cut`}</span><small>Recorded basis {money(block.originalPaise)} · remaining {money(block.remainingPaise)}</small><small>{block.period} · not recorded savings or a guaranteed monthly forecast</small></div>
  return <section className="ai-savings" aria-label="Hypothetical savings estimate"><div className="ai-savings-title"><span>Hypothetical estimate</span><span>{block.reductionBps == null ? "Proposed cut" : `${block.reductionBps / 100}% reduction`}</span></div><p>{block.label} · recorded spend {money(block.originalPaise)}</p><strong>{money(block.savingPaise)}</strong><p>Remaining spend: {money(block.remainingPaise)}</p><small>{block.period} · not recorded savings</small></section>
}
function Categories({ block }) {
  return <section className="ai-categories" aria-label="Spending category summary"><div className="ai-category-heading"><div><h3>Spending breakdown</h3><p>{block.period}</p></div><div><strong>{money(block.totalPaise)}</strong><span>{block.basis === "income" ? "Recorded income" : "Recorded expenses"}</span></div></div><ul>{block.items.map((item, i) => <li key={i}><div><span>{item.label}</span><strong>{money(item.amountPaise)}</strong></div><div className="ai-category-share"><progress max="100" value={Math.min(100, item.share || 0)} aria-label={`${item.label} share of ${block.basis}`} aria-valuetext={item.share == null ? "N/A" : `${item.share}% of ${block.basis}`} /><span>{item.share == null ? "N/A" : `${item.share}%`}</span></div></li>)}</ul><p className="ai-category-note">Share of recorded {block.basis}{block.otherCount ? ` · ${block.otherCount} additional categories included in the total` : ""}</p></section>
}

const categoryIcons = { education: GraduationCap, shopping: ShoppingBag, transport: Bus, "food & dining": Utensils, entertainment: Clapperboard, healthcare: HeartPulse, housing: House, utilities: Lightbulb, travel: Plane, gifts: Gift }
function TransactionList({ block }) {
  const ranked = block.type === "ranked_expenses"
  const List = ranked ? "ol" : "ul"
  const HeaderIcon = ranked ? ListOrdered : ReceiptText
  const includeYear = block.start.slice(0, 4) !== new Date(Date.parse(`${block.end}T00:00:00Z`) - 1).getUTCFullYear().toString()
  const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(includeYear ? { year: "numeric" } : {}), timeZone: "UTC" })
  return <section className={`ai-ranked-expenses${ranked ? "" : " ai-transactions-chronological"}`} aria-label={ranked ? "Largest expenses" : block.label}>
    <div className="ai-ranked-header"><div><h3><HeaderIcon size={16} aria-hidden="true" />{block.label}</h3><p>{block.period} · {block.totalCount} {block.totalCount === 1 ? "transaction" : "transactions"}{block.category ? ` · ${block.category}` : ""}{block.method ? ` · ${block.method.toUpperCase()}` : ""}</p></div><dl><dt>{ranked ? "Total recorded expenses" : "Total Spent"}</dt><dd>{money(block.totalPaise)}</dd></dl></div>
    <List className="ai-ranked-list" role="list" aria-label={ranked ? "Expenses ranked from highest to lowest" : "Expense transactions in recorded order"}>{block.items.map((item, i) => {
      const Icon = categoryIcons[item.category.toLowerCase()] || ReceiptText
      return <li className="ai-ranked-row" key={item.rowKey || `legacy-${i}`} style={{ "--rank-color": getCategoryColor(item.category) }}>
        {ranked && <span className="ai-ranked-number" aria-hidden="true">{i + 1}</span>}
        <div className="ai-ranked-detail"><div className="ai-ranked-name"><span className="ai-ranked-icon"><Icon size={16} aria-hidden="true" /></span><span>{item.category}{item.category.toLowerCase() === "income" ? " (expense category)" : ""}</span></div><div className="ai-ranked-meta"><time dateTime={item.date}>{dateFormat.format(new Date(`${item.date}T12:00:00Z`))}</time><span className="ai-ranked-payment">{item.method === "cash" ? "CASH" : item.method === "upi" ? "UPI" : "OTHER"}</span></div></div>
        <strong className="ai-ranked-amount">{money(item.amountPaise)}</strong>
        <progress className="ai-ranked-share" max="100" value={item.share || 0} aria-label={`Expense ${i + 1} share of total recorded expenses`} aria-valuetext={item.share == null ? "N/A" : `${item.share}% of total recorded expenses`} />
      </li>
    })}</List>
    <p className="ai-ranked-footer">Showing {block.items.length} of {block.totalCount} expenses<span>{ranked ? "Ranked by individual amount" : "Recorded order"}</span>{block.items.length < block.totalCount && <span>The total includes all matches. Narrow the period for more detail.</span>}</p>
  </section>
}

export default function AssistantResponse({ answer, cards = [], presentation, onFollowup, disabled = false, inlineFollowups = true }) {
  let blocks
  try { blocks = presentation ? validateResponsePresentation(presentation).blocks : [...textResponseBlocks(answer), ...cards.map((card) => ({ type: "comparison", card: chronologicalComparison(card) }))] } catch { return <p role="alert">This response format could not be verified. Please retry.</p> }
  const rendered = []
  let recommendationNumber = 0
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block.type === "metric") {
      const group = [block]
      while (blocks[i + 1]?.type === "metric") group.push(blocks[++i])
      rendered.push(<div className="ai-metric-grid" key={`metrics-${i}`}>{group.map((item, n) => <Metric block={item} key={n} />)}</div>)
    } else if (block.type === "recommendation") {
      const group = [block]
      while (blocks[i + 1]?.type === "recommendation") group.push(blocks[++i])
      const start = recommendationNumber + 1
      recommendationNumber += group.length
      rendered.push(<ol className="ai-recommendations" role="list" start={start} key={`recommendations-${i}`} aria-label="Recommended next steps">{group.map((item, n) => <li key={n}><div className="ai-recommendation-heading"><span aria-hidden="true">{start + n}</span><h3><InlineText text={item.title} /></h3><Lightbulb size={16} aria-hidden="true" /></div><p><InlineText text={item.text} /></p>{item.estimate && <Savings block={item.estimate} compact />}</li>)}</ol>)
    } else if (block.type === "paragraph") rendered.push(<p className="ai-response-paragraph" key={i}><InlineText text={block.text} /></p>)
    else if (block.type === "heading") rendered.push(<h3 className="ai-response-heading" key={i}><InlineText text={block.text} /></h3>)
    else if (block.type === "list") {
      const List = block.ordered ? "ol" : "ul"
      rendered.push(<List className="ai-response-list" key={i}>{block.items.map((item, n) => <li key={n}><InlineText text={item} /></li>)}</List>)
    } else if (block.type === "comparison") rendered.push(<ComparisonCard card={block.card} key={i} />)
    else if (["ranked_expenses", "transaction_list"].includes(block.type)) rendered.push(<TransactionList block={block} key={i} />)
    else if (block.type === "categories") rendered.push(<Categories block={block} key={i} />)
    else if (block.type === "savings") rendered.push(<Savings block={block} key={i} />)
    else if (block.type === "notice") rendered.push(<aside className={`ai-response-notice ai-notice-${block.tone || "info"}`} key={i}><CircleAlert size={16} aria-hidden="true" /><p><InlineText text={block.text} /></p></aside>)
    else if (block.type === "actions") rendered.push(<nav className="ai-response-actions" aria-label="Related FinSight actions" key={i}>{block.ids.map((id) => <Link to={RESPONSE_ACTIONS[id].to} key={id}>{RESPONSE_ACTIONS[id].label}<ArrowRight size={14} aria-hidden="true" /></Link>)}</nav>)
    else if (block.type === "followups" && inlineFollowups && onFollowup) rendered.push(<div className="ai-response-followups" aria-label="Suggested follow-up questions" key={i}>{block.ids.map((id) => <button type="button" key={id} disabled={disabled} onClick={() => onFollowup(RESPONSE_FOLLOWUPS[id])}>{RESPONSE_FOLLOWUPS[id]}<ArrowRight size={13} aria-hidden="true" /></button>)}</div>)
  }
  return <div className="ai-response">{rendered}</div>
}
