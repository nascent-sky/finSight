import { useCallback, useId, useMemo, useState, useSyncExternalStore } from "react"
import { TrendingUp } from "lucide-react"
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"

import Card from "../ui/Card"
import { formatExpenseAmount } from "./expenseChartUtils"
import { formatTrendAxisAmount, getCashFlowPreview, getMonthlyCashFlow } from "./cashFlowTrendUtils"

const SERIES = [
  { key: "income", label: "Income", color: "#21a17d", dash: undefined },
  { key: "expenses", label: "Expenses", color: "#ed826f", dash: "7 3" },
  { key: "net", label: "Net cash flow", color: "#8290df", dash: "2 4" },
]
const Y_DOMAIN = ["auto", "auto"]
const signedAmount = (amount) => `${amount > 0 ? "+" : ""}${formatExpenseAmount(amount)}`
const getReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const subscribeReducedMotion = (listener) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)")
  media.addEventListener("change", listener)
  return () => media.removeEventListener("change", listener)
}

const SeriesSwatch = ({ series }) => (
  <svg width="25" height="12" viewBox="0 0 25 12" fill="none" aria-hidden="true" className="shrink-0">
    <path d="M1 6H24" stroke={series.color} strokeWidth="2.5" strokeDasharray={series.dash} strokeLinecap="round" />
    {series.key === "income" ? <circle cx="12" cy="6" r="3" fill={series.color} />
      : series.key === "expenses" ? <rect x="9" y="3" width="6" height="6" rx="1" fill={series.color} />
        : <path d="m12 2 4 4-4 4-4-4Z" fill={series.color} />}
  </svg>
)

const TrendTooltip = ({ active, payload, isSamplePreview }) => {
  const month = payload?.[0]?.payload
  if (!active || !month) return null
  return (
    <div className="theme-card w-52 max-w-full rounded-xl border px-3 py-3 text-xs shadow-lg">
      <p className="theme-text mb-3 font-semibold">{month.label}{isSamplePreview ? " · Sample" : ""}</p>
      <div className="space-y-2.5">
        {SERIES.map((series) => (
          <div key={series.key} className="flex items-center justify-between gap-3">
            <span className="theme-muted-text flex items-center gap-2"><SeriesSwatch series={series} />{series.label}</span>
            <span className="theme-text text-right font-semibold tabular-nums [overflow-wrap:anywhere]">{series.key === "net" ? signedAmount(month.net) : formatExpenseAmount(month[series.key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const TrendContent = ({ realStats, endMonth, monthCount, onRangeChange, isReady, loadError }) => {
  const id = useId().replace(/:/g, "")
  const [previewRequested, setPreviewRequested] = useState(false)
  const [visible, setVisible] = useState({ income: true, expenses: true, net: true })
  const [width, setWidth] = useState(0)
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, () => true)
  const isSamplePreview = isReady && !loadError && realStats.populatedMonths < 2 && previewRequested
  const stats = useMemo(
    () => isSamplePreview ? getCashFlowPreview(endMonth, monthCount) : realStats,
    [isSamplePreview, endMonth, monthCount, realStats],
  )
  const narrow = width < 420
  const onResize = useCallback((nextWidth) => setWidth(Math.floor(nextWidth)), [])
  const firstMonth = stats.months[0]
  const lastMonth = stats.months.at(-1)
  const periodLabel = `${firstMonth.shortLabel} ${firstMonth.monthKey.slice(0, 4)} – ${lastMonth.shortLabel} ${lastMonth.monthKey.slice(0, 4)}`
  const ticks = narrow && monthCount === 12
    ? stats.months.filter((_, index) => [0, 2, 4, 6, 8, 11].includes(index)).map((month) => month.monthKey)
    : stats.months.map((month) => month.monthKey)
  const summary = [
    { label: "Avg. monthly income", value: formatExpenseAmount(stats.averageIncome) },
    { label: "Avg. monthly expenses", value: formatExpenseAmount(stats.averageExpenses) },
    { label: "Net flow this period", value: signedAmount(stats.netCashFlow) },
  ]

  return (
    <Card padding="lg" className="min-w-0">
      <section className="@container min-w-0" aria-label="Income and expense trends">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="theme-panel theme-accent-text rounded-xl p-2.5"><TrendingUp size={21} aria-hidden="true" /></span>
            <div className="min-w-0">
              <h2 className="theme-text text-lg font-semibold tracking-tight">Income & Expense Trends</h2>
              <p className="theme-muted-text mt-1 text-xs leading-5">{periodLabel} · ending in the selected month</p>
            </div>
          </div>
          <div className="theme-panel inline-flex max-w-full gap-1 rounded-xl p-1" role="group" aria-label="Trend time range">
            {[6, 12].map((range) => (
              <button
                type="button" key={range} aria-pressed={monthCount === range}
                onClick={() => onRangeChange(range)}
                className="theme-text min-h-10 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color) motion-reduce:transition-none"
                style={monthCount === range ? { background: "var(--surface-color)", boxShadow: "0 1px 4px rgb(0 0 0 / 0.08)" } : undefined}
              >Last {range} months</button>
            ))}
          </div>
        </div>

        {isSamplePreview && (
          <div className="theme-panel mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" role="status">
            <div>
              <p className="theme-accent-text text-xs font-semibold tracking-wide">SAMPLE DATA · DEMO PREVIEW</p>
              <p className="theme-muted-text mt-1 text-xs">Example cash flow only. Your transactions, balances and other analytics are unchanged.</p>
            </div>
            <button type="button" onClick={() => setPreviewRequested(false)} className="theme-link min-h-9 rounded text-xs font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">Back to my data</button>
          </div>
        )}
        {loadError && stats.transactionCount > 0 && <p className="theme-muted-text mt-4 text-sm" role="alert">Transactions could not be fully refreshed. Showing the records already loaded.</p>}

        {!isReady || (loadError && stats.transactionCount === 0) ? (
          <div className="theme-panel mt-5 rounded-xl px-5 py-12 text-center" role={loadError ? "alert" : "status"}>
            <p className="theme-text font-medium">{loadError ? "Cash flow could not be loaded" : "Loading cash flow…"}</p>
            <p className="theme-muted-text mt-2 text-sm">{loadError ? "Check your connection and reload to try again." : "Your recorded transactions will appear here when ready."}</p>
          </div>
        ) : (
          <>
            <div className="theme-border mt-6 grid grid-cols-2 gap-x-5 gap-y-4 border-b pb-5 @min-[520px]:grid-cols-3">
              {summary.map((item, index) => (
                <div key={item.label} className={index === 2 ? "col-span-2 flex flex-wrap items-baseline justify-between gap-2 @min-[520px]:col-span-1 @min-[520px]:block" : "min-w-0"}>
                  <p className="theme-muted-text text-xs">{item.label}</p>
                  <p className={`mt-1.5 text-lg font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere] ${index === 2 && stats.netCashFlow < 0 ? "" : "theme-text"}`} style={index === 2 && stats.netCashFlow < 0 ? { color: SERIES[1].color } : undefined}>{item.value}</p>
                </div>
              ))}
            </div>

            {stats.transactionCount === 0 ? (
              <div className="theme-panel mt-5 flex min-h-56 flex-col items-center justify-center rounded-xl px-5 py-8 text-center">
                <TrendingUp className="theme-muted-text mb-3" size={34} strokeWidth={1.3} aria-hidden="true" />
                <h3 className="theme-text font-semibold">No cash flow in this period</h3>
                <p className="theme-muted-text mt-2 max-w-sm text-sm">Choose another ending month or explore a sample income and expense history.</p>
                {!loadError && <button type="button" onClick={() => setPreviewRequested(true)} className="theme-button-secondary mt-5 min-h-10 rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)">Preview with sample data</button>}
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="flex flex-wrap gap-x-2" role="group" aria-label="Visible trend series">
                    {SERIES.map((series) => (
                      <button
                        key={series.key} type="button" aria-pressed={visible[series.key]}
                        aria-label={`${series.label} trend`}
                        disabled={visible[series.key] && Object.values(visible).filter(Boolean).length === 1}
                        onClick={() => setVisible((current) => ({ ...current, [series.key]: !current[series.key] }))}
                        className="theme-muted-text flex min-h-10 items-center gap-2 rounded-lg px-1.5 text-xs transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color) motion-reduce:transition-none"
                        style={{ opacity: visible[series.key] ? 1 : 0.45 }}
                      ><SeriesSwatch series={series} />{series.label}</button>
                    ))}
                  </div>
                  <span className="theme-muted-text text-[11px]">INR · monthly totals</span>
                </div>
                <p id={`${id}-description`} className="sr-only">Monthly recorded income, expenses and net cash flow. Focus the chart and use left and right arrow keys to explore months. Full values are also available in the monthly table below.</p>
                <div className="mt-3 min-w-0" aria-describedby={`${id}-description`}>
                  <ResponsiveContainer width="100%" height={narrow ? 280 : 330} minWidth={0} onResize={onResize}>
                    <ComposedChart data={stats.months} margin={{ top: 12, right: 8, bottom: 4, left: 0 }} accessibilityLayer aria-label="Monthly income, expenses and net cash flow">
                      <defs>
                        {SERIES.slice(0, 2).map((series) => (
                          <linearGradient key={series.key} id={`${id}-${series.key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={series.color} stopOpacity={0.18} />
                            <stop offset="100%" stopColor={series.color} stopOpacity={0.01} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid vertical={false} stroke="var(--border-color)" strokeDasharray="3 5" opacity={0.65} />
                      <XAxis
                        dataKey="monthKey" ticks={ticks} interval={0} axisLine={false} tickLine={false}
                        tick={{ fill: "var(--muted-text-color)", fontSize: 11 }} tickMargin={12}
                        padding={{ left: 10, right: 10 }} height={34}
                        tickFormatter={(key) => stats.months.find((month) => month.monthKey === key)?.shortLabel || key}
                      />
                      <YAxis width={narrow ? 54 : 64} tickCount={5} axisLine={false} tickLine={false} domain={Y_DOMAIN} includeHidden
                        tick={{ fill: "var(--muted-text-color)", fontSize: 10 }} tickFormatter={formatTrendAxisAmount} />
                      <ReferenceLine y={0} ifOverflow="extendDomain" stroke="var(--muted-text-color)" strokeOpacity={0.4} />
                      <Tooltip
                        content={<TrendTooltip isSamplePreview={isSamplePreview} />} includeHidden
                        trigger={narrow ? "click" : "hover"}
                        position={narrow ? { x: Math.max(0, (width - 208) / 2), y: 12 } : undefined}
                        cursor={{ stroke: "var(--muted-text-color)", strokeDasharray: "3 4", strokeOpacity: 0.5 }}
                        isAnimationActive={false} wrapperStyle={{ pointerEvents: "none", maxWidth: "100%" }}
                      />
                      {SERIES.slice(0, 2).map((series) => (
                        <Area key={series.key} type="monotoneX" dataKey={series.key} name={series.label}
                          hide={!visible[series.key]} stroke={series.color} strokeWidth={2.5} strokeDasharray={series.dash}
                          fill={`url(#${id}-${series.key})`} baseValue={0} dot={false}
                          activeDot={{ r: 5, fill: series.color, stroke: "var(--surface-color)", strokeWidth: 2 }}
                          isAnimationActive={!reducedMotion} animationDuration={450} animationEasing="ease-out" />
                      ))}
                      <Line type="monotoneX" dataKey="net" name="Net cash flow" hide={!visible.net}
                        stroke={SERIES[2].color} strokeWidth={2} strokeDasharray={SERIES[2].dash} dot={false}
                        activeDot={{ r: 4, fill: SERIES[2].color, stroke: "var(--surface-color)", strokeWidth: 2 }}
                        isAnimationActive={!reducedMotion} animationDuration={450} animationEasing="ease-out" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <p className="theme-muted-text mt-2 text-center text-xs">{narrow ? "Tap a month or use arrow keys to explore" : "Hover or use arrow keys to explore"} · toggle a legend item to focus the view</p>
                {!isSamplePreview && !loadError && realStats.populatedMonths < 2 && (
                  <div className="theme-panel mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs">
                    <span className="theme-muted-text">Only one month has activity. Months without transactions are shown as zero.</span>
                    <button type="button" onClick={() => setPreviewRequested(true)} className="theme-link min-h-9 rounded font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">Preview with sample data</button>
                  </div>
                )}
              </>
            )}

            <details className="theme-border mt-5 min-w-0 border-t pt-4">
              <summary className="theme-muted-text cursor-pointer rounded text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)">View {isSamplePreview ? "sample " : ""}monthly values</summary>
              <table className="theme-text mt-4 w-full table-fixed text-right text-[11px] tabular-nums @min-[520px]:text-xs">
                <caption className="sr-only">{isSamplePreview ? "Sample" : "Recorded"} monthly cash flow for {periodLabel}</caption>
                <thead className="theme-muted-text"><tr>
                  <th scope="col" className="w-[19%] py-2 text-left font-medium">Month</th>
                  {SERIES.map((series) => <th key={series.key} scope="col" className="px-1 py-2 font-medium [overflow-wrap:anywhere]">{series.key === "net" ? "Net" : series.label}</th>)}
                </tr></thead>
                <tbody>{stats.months.map((month) => (
                  <tr key={month.monthKey} className="theme-border border-t">
                    <th scope="row" className="py-3 text-left font-medium" aria-label={month.label}>{month.shortLabel}<span className="theme-muted-text block text-[10px]">{month.monthKey.slice(0, 4)}</span></th>
                    {SERIES.map((series) => <td key={series.key} className="px-1 py-3 align-top [overflow-wrap:anywhere]">{series.key === "net" ? signedAmount(month.net) : formatExpenseAmount(month[series.key])}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </details>
          </>
        )}
      </section>
    </Card>
  )
}

const IncomeExpenseTrends = ({ transactions, endMonth, isReady, loadError }) => {
  const [monthCount, setMonthCount] = useState(6)
  const realStats = useMemo(() => getMonthlyCashFlow(transactions, endMonth, monthCount), [transactions, endMonth, monthCount])
  return <TrendContent
    key={`${endMonth}:${isReady}:${Boolean(loadError)}:${realStats.populatedMonths}`}
    realStats={realStats} endMonth={endMonth} monthCount={monthCount} onRangeChange={setMonthCount}
    isReady={isReady} loadError={loadError}
  />
}

export default IncomeExpenseTrends
