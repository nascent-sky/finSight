import { useEffect, useId, useMemo, useRef, useState } from "react"
import { CalendarDays } from "lucide-react"

import Card from "../ui/Card"
import { formatExpenseAmount, getCategoryColor } from "./expenseChartUtils"
import { getMonthlySpendingCalendar, getSpendingCalendarPreview } from "./spendingCalendarUtils"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const INTENSITIES = [0, 16, 34, 58, 82]
const cellBackground = (intensity) => intensity === 0 ? "var(--surface-muted)"
  : `color-mix(in srgb, #148168 ${INTENSITIES[intensity]}%, var(--surface-color))`
const timeFormatter = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" })
const shortDate = (day) => new Date(`${day.dateKey}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })

// Refresh the elapsed-day denominator at local midnight and on return to a
// suspended tab; don't leave yesterday's average on a long-running dashboard.
const useCalendarToday = () => {
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    let timer
    const refresh = () => {
      const now = new Date()
      setToday(now)
      clearTimeout(timer)
      timer = setTimeout(refresh, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 100)
    }
    const onVisible = () => { if (document.visibilityState === "visible") refresh() }
    refresh()
    document.addEventListener("visibilitychange", onVisible)
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible) }
  }, [])
  return today
}

const CalendarContent = ({ realStats, today, isReady, loadError }) => {
  const descriptionId = useId()
  const dayRefs = useRef([])
  const [previewRequested, setPreviewRequested] = useState(false)
  const isSamplePreview = isReady && !loadError && realStats.transactionCount === 0 && previewRequested
  const stats = useMemo(() => isSamplePreview ? getSpendingCalendarPreview(realStats.monthKey, today) : realStats, [isSamplePreview, realStats, today])
  const [selectedDay, setSelectedDay] = useState(() => realStats.days.find((day) => day.isToday)?.day || realStats.highestDay?.day || 1)
  const [hoveredDay, setHoveredDay] = useState(null)
  const activeDay = stats.days[(hoveredDay ?? selectedDay) - 1]
  const hasExpenses = stats.transactionCount > 0
  const canShowCalendar = isReady && (!loadError || realStats.transactionCount > 0)
  const focusDay = (day) => {
    setHoveredDay(null)
    setSelectedDay(day)
    dayRefs.current[day]?.focus()
  }
  const onDateKeyDown = (event, day) => {
    const lastDay = stats.days.length
    const leadingDays = stats.weeks[0].findIndex(Boolean)
    const weekday = (day - 1 + leadingDays) % 7
    const nextDay = {
      ArrowLeft: day - 1, ArrowRight: day + 1, ArrowUp: day - 7, ArrowDown: day + 7,
      Home: event.ctrlKey || event.metaKey ? 1 : day - weekday,
      End: event.ctrlKey || event.metaKey ? lastDay : day + 6 - weekday,
    }[event.key]
    if (nextDay != null) { event.preventDefault(); focusDay(Math.min(lastDay, Math.max(1, nextDay))) }
    if (event.key === "Escape") setHoveredDay(null)
  }

  return (
    <Card padding="lg" className="min-w-0">
      <section className="@container min-w-0" aria-label="Spending patterns">
        <div className="flex min-w-0 items-start gap-3">
          <span className="theme-panel theme-accent-text rounded-xl p-2.5"><CalendarDays size={21} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h2 className="theme-text text-lg font-semibold tracking-tight">Spending Patterns</h2>
            <p className="theme-muted-text mt-1 text-sm">Your daily expense rhythm · {stats.monthLabel}</p>
          </div>
        </div>

        {isSamplePreview && (
          <div className="theme-panel mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" role="status">
            <div>
              <p className="theme-accent-text text-xs font-semibold tracking-wide">SAMPLE DATA · DEMO PREVIEW</p>
              <p className="theme-muted-text mt-1 text-xs">Example expenses only. Your transactions, balances and other analytics are unchanged.</p>
            </div>
            <button type="button" onClick={() => { setPreviewRequested(false); setHoveredDay(null) }} className="theme-link min-h-10 rounded text-xs font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">Back to my data</button>
          </div>
        )}
        {loadError && realStats.transactionCount > 0 && <p className="theme-muted-text mt-4 text-sm" role="alert">Transactions could not be fully refreshed. Showing the expenses already loaded.</p>}

        {!canShowCalendar ? (
          <div className="theme-panel mt-5 rounded-xl px-5 py-12 text-center" role={loadError ? "alert" : "status"}>
            <p className="theme-text font-medium">{loadError ? "Spending patterns could not be loaded" : "Loading spending patterns…"}</p>
            <p className="theme-muted-text mt-2 text-sm">{loadError ? "Check your connection and reload to try again." : "Your daily expenses will appear when transactions are ready."}</p>
          </div>
        ) : (
          <>
            <div className="theme-border mt-6 grid grid-cols-2 gap-x-5 gap-y-5 border-b pb-5 @min-[640px]:grid-cols-4">
              <div className="min-w-0">
                <p className="theme-muted-text text-xs">Highest spending day</p>
                {stats.highestDay ? <button type="button" onClick={() => focusDay(stats.highestDay.day)} className="theme-text mt-1.5 min-h-10 rounded text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)" aria-label={`Explore highest spending day: ${stats.highestDay.label}, ${formatExpenseAmount(stats.highestDay.amount)}`}>
                  <span className="block text-lg font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">{formatExpenseAmount(stats.highestDay.amount)}</span>
                  <span className="theme-muted-text mt-1 block text-xs underline decoration-dotted underline-offset-4">{shortDate(stats.highestDay)}</span>
                </button> : <p className="theme-text mt-1.5 text-lg font-semibold">—</p>}
              </div>
              <div className="min-w-0">
                <p className="theme-muted-text text-xs">{stats.isCurrentMonth ? "Avg. per elapsed day" : "Average daily spending"}</p>
                <p className="theme-text mt-1.5 text-lg font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">{stats.averageDayCount ? formatExpenseAmount(stats.averageDailyExpense) : "—"}</p>
                <p className="theme-muted-text mt-1 text-xs">{stats.averageDayCount ? `Across ${stats.averageDayCount} calendar days` : "Month has not started"}</p>
              </div>
              <div className="min-w-0">
                <p className="theme-muted-text text-xs">Days with expenses</p>
                <p className="theme-text mt-1.5 text-lg font-semibold tabular-nums">{stats.spendingDays}<span className="theme-muted-text text-xs font-normal"> / {stats.days.length}</span></p>
              </div>
              <div className="min-w-0">
                <p className="theme-muted-text text-xs">Expense transactions</p>
                <p className="theme-text mt-1.5 text-lg font-semibold tabular-nums">{stats.transactionCount}</p>
              </div>
            </div>

            {!hasExpenses && <div className="theme-panel mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
              <div><h3 className="theme-text text-sm font-medium">No expenses this month</h3><p className="theme-muted-text mt-1 text-xs">Choose another month or explore a sample spending calendar.</p></div>
              {!loadError && <button type="button" onClick={() => setPreviewRequested(true)} className="theme-button-secondary min-h-10 rounded-lg px-3 py-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)">Preview with sample data</button>}
            </div>}

            <div className="mt-6 grid min-w-0 gap-6 @min-[760px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="theme-text text-sm font-semibold">{stats.monthLabel}</h3>
                  <span className="theme-muted-text text-[11px]">{isSamplePreview ? "Sample expenses" : "Daily expenses"} · INR</span>
                </div>
                <div className="theme-panel mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-xs @min-[760px]:hidden" aria-hidden="true">
                  <span className="theme-muted-text">{shortDate(activeDay)} · {activeDay.transactionCount} {activeDay.transactionCount === 1 ? "expense" : "expenses"}</span>
                  <span className="theme-text font-semibold tabular-nums [overflow-wrap:anywhere]">{formatExpenseAmount(activeDay.amount)}</span>
                </div>
                <p id={descriptionId} className="sr-only">Monday-first calendar. Use arrow keys to move by day or week, Home and End within a week, and Control Home or Control End for the month. Press Enter or tap to select a day. Daily spending and transactions appear in the details panel.</p>
                <div className="grid grid-cols-7 gap-1 @min-[420px]:gap-2" role="group" aria-label={`Daily expense calendar for ${stats.monthLabel}`} aria-describedby={descriptionId} onMouseLeave={() => setHoveredDay(null)}>
                  {WEEKDAYS.map((weekday) => <span key={weekday} className="theme-muted-text pb-1 text-center text-[10px] font-medium @min-[420px]:text-xs" aria-hidden="true">{weekday}</span>)}
                  {stats.weeks.flat().map((day, index) => day ? (
                    <button
                      key={day.dateKey} type="button" ref={(node) => { dayRefs.current[day.day] = node }}
                      tabIndex={selectedDay === day.day ? 0 : -1} aria-pressed={selectedDay === day.day}
                      aria-label={`${day.label}: ${formatExpenseAmount(day.amount)}, ${day.transactionCount} expense ${day.transactionCount === 1 ? "transaction" : "transactions"}${day.isToday ? ". Today" : day.isFuture ? ". Future date" : ""}${isSamplePreview ? ". Sample data" : ""}`}
                      title={`${day.label} · ${formatExpenseAmount(day.amount)} · ${day.transactionCount} ${day.transactionCount === 1 ? "expense" : "expenses"}`}
                      className="theme-text relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border text-xs font-medium tabular-nums transition-[background-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color) motion-reduce:transform-none motion-reduce:transition-none @min-[420px]:min-h-16 @min-[420px]:rounded-xl @min-[420px]:text-sm"
                      style={{ background: cellBackground(day.intensity), borderColor: selectedDay === day.day ? "var(--accent-color)" : day.isToday ? "var(--muted-text-color)" : "transparent", boxShadow: selectedDay === day.day ? "inset 0 0 0 1px var(--accent-color)" : undefined }}
                      onMouseEnter={() => setHoveredDay(day.day)}
                      onFocus={() => { setHoveredDay(null); setSelectedDay(day.day) }}
                      onClick={() => { setHoveredDay(null); setSelectedDay(day.day) }}
                      onKeyDown={(event) => onDateKeyDown(event, day.day)}
                    >
                      <span className={day.isToday ? "underline decoration-2 underline-offset-4" : undefined}>{day.day}</span>
                      <span className="h-1 w-1 rounded-full" style={{ background: day.transactionCount ? "currentColor" : "transparent", opacity: 0.65 }} aria-hidden="true" />
                    </button>
                  ) : <span key={`padding-${index}`} aria-hidden="true" />)}
                </div>
                <div className="theme-muted-text mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px]">
                  <span>Hover, tap or use arrow keys</span>
                  <div className="flex items-center gap-1.5" aria-label="Spending intensity: neutral means zero; darker means more spending relative to the highest day">
                    <span className="mr-1">Less</span>{INTENSITIES.map((_, level) => <span key={level} className="h-3 w-3 rounded-sm" style={{ background: cellBackground(level) }} aria-hidden="true" />)}<span className="ml-1">More</span>
                  </div>
                </div>
                {stats.isCurrentMonth && <p className="theme-muted-text mt-3 text-[11px] leading-5">The daily average includes zero-spending days through today. Future-dated expenses remain on the calendar and are excluded from this average.</p>}
              </div>

              <section className="theme-panel min-w-0 self-start rounded-xl p-4" aria-label="Daily expense details">
                <p className="theme-muted-text text-[11px] font-medium uppercase tracking-wide">{isSamplePreview ? "Sample day" : hoveredDay !== null && hoveredDay !== selectedDay ? "Day preview" : "Selected day"}</p>
                <h3 className="theme-text mt-1 text-sm font-semibold">{activeDay.label}</h3>
                <div className="theme-border mt-4 flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
                  <p className="theme-text text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">{formatExpenseAmount(activeDay.amount)}</p>
                  <p className="theme-muted-text text-xs">{activeDay.transactionCount} expense {activeDay.transactionCount === 1 ? "transaction" : "transactions"}</p>
                </div>
                {activeDay.transactionCount === 0 ? <p className="theme-muted-text py-6 text-center text-sm">No expenses recorded on this day.</p> : (
                  <ul className="mt-1 max-h-80 space-y-1 overflow-y-auto" aria-label={isSamplePreview ? "Sample expenses for this day" : "Expenses for this day"}>
                    {activeDay.transactions.map((transaction) => (
                      <li key={transaction.id} className="theme-border grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-b py-3 last:border-0">
                        <div className="min-w-0">
                          <p className="theme-text text-xs font-medium [overflow-wrap:anywhere]">{transaction.person || transaction.note || transaction.category}</p>
                          <p className="theme-muted-text mt-1.5 flex items-start gap-1.5 text-[11px] leading-4"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: getCategoryColor(transaction.category) }} aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{transaction.category}</span></p>
                          <p className="theme-muted-text mt-1 text-[10px]">{timeFormatter.format(transaction.timestamp)}{["cash", "upi"].includes(transaction.paymentMethod) ? ` · ${transaction.paymentMethod === "upi" ? "UPI" : "Cash"}` : ""}</p>
                        </div>
                        <span className="theme-text max-w-28 text-right text-xs font-semibold tabular-nums [overflow-wrap:anywhere]">{formatExpenseAmount(transaction.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <p className="sr-only" aria-live="polite" aria-atomic="true">Selected {stats.days[selectedDay - 1].label}: {formatExpenseAmount(stats.days[selectedDay - 1].amount)}, {stats.days[selectedDay - 1].transactionCount} expense transactions{isSamplePreview ? ", sample data" : ""}.</p>
          </>
        )}
      </section>
    </Card>
  )
}

const SpendingCalendar = ({ transactions, monthKey, isReady = true, loadError = "" }) => {
  const today = useCalendarToday()
  const realStats = useMemo(() => getMonthlySpendingCalendar(transactions, monthKey, today), [transactions, monthKey, today])
  return <CalendarContent key={`${monthKey}:${isReady}:${Boolean(loadError)}:${realStats.transactionCount > 0}`} realStats={realStats} today={today} isReady={isReady} loadError={loadError} />
}

export default SpendingCalendar
