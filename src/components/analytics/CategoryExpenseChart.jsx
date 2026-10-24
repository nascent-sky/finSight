import { createContext, memo, useCallback, useContext, useId, useMemo, useState } from "react"
import { PieChart as PieChartIcon } from "lucide-react"
import { Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts"

import Card from "../ui/Card"
import {
  formatExpenseAmount,
  formatExpensePercentage,
  getCategoryExpensePreview,
  getExpensePieLayout,
} from "./expenseChartUtils"

const CategoryTooltip = ({ active, payload }) => {
  const category = payload?.[0]?.payload
  if (!active || !category) return null

  return (
    <div className="theme-card max-w-60 rounded-xl border px-4 py-3 text-sm shadow-lg">
      <p className="theme-text mb-1 flex items-start gap-2 font-semibold">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: category.fill }} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{category.name}</span>
      </p>
      <p className="theme-text font-semibold tabular-nums">{formatExpenseAmount(category.amount)}</p>
      <p className="theme-muted-text mt-1 text-xs">{formatExpensePercentage(category.percentage)} of monthly expenses</p>
    </div>
  )
}

const ChartInteractionContext = createContext(null)

const ExpenseSlice = (props) => {
  const { activeCategory, selectedCategory, setFocusedCategory, toggleCategory, clearSelection } = useContext(ChartInteractionContext)
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, payload } = props
  const isActive = activeCategory === payload.name
  const arcLength = ((Math.abs(endAngle - startAngle) * Math.PI) / 180) * outerRadius

  return (
    <g>
      {isActive && (
        <Sector
          key="highlight"
          cx={cx}
          cy={cy}
          innerRadius={outerRadius + 4}
          outerRadius={outerRadius + 7}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={payload.fill}
          opacity={0.45}
          pointerEvents="none"
        />
      )}
      <Sector
        key="slice"
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={payload.fill}
        stroke="var(--surface-color)"
        strokeWidth={arcLength < 3 || Math.abs(endAngle - startAngle) >= 359.999 ? 0 : 1.5}
        fillOpacity={activeCategory && !isActive ? 0.55 : 1}
        className="cursor-pointer outline-none transition-[fill-opacity] duration-200 motion-reduce:transition-none"
        tabIndex={0}
        role="button"
        aria-label={`${payload.name}: ${formatExpenseAmount(payload.amount)}, ${formatExpensePercentage(payload.percentage)}`}
        aria-pressed={selectedCategory === payload.name}
        onFocus={() => setFocusedCategory(payload.name)}
        onBlur={() => setFocusedCategory(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            toggleCategory(payload.name)
          }
          if (event.key === "Escape") clearSelection()
        }}
      />
    </g>
  )
}

const ExpenseLabel = ({ label, category }) => {
  const { activeCategory } = useContext(ChartInteractionContext)
  const isActive = activeCategory === category.name

  return (
    <g pointerEvents="none" aria-hidden="true">
      <path d={label.path} fill="none" stroke={category.fill} strokeWidth={isActive ? 1.8 : 1.1} opacity={activeCategory && !isActive ? 0.35 : 0.85} />
      <circle cx={label.startX} cy={label.startY} r={2.3} fill={category.fill} />
      <foreignObject x={label.textX} y={label.y - label.height / 2} width={label.width} height={label.height}>
        <div
          className={`flex h-full flex-col justify-center ${label.side === "left" ? "text-right" : "text-left"}`}
          title={category.name}
        >
          <span className="theme-text line-clamp-2 text-xs leading-4 font-medium [overflow-wrap:anywhere]">{category.name}</span>
          <span className="theme-muted-text mt-0.5 text-xs leading-4 tabular-nums">{formatExpensePercentage(category.percentage)}</span>
        </div>
      </foreignObject>
    </g>
  )
}

const renderSlice = (props) => <ExpenseSlice {...props} />

// Recharts keys its sectors to Pie props, even with animation disabled. Keep Pie
// props stable during interaction; context updates only the slice/label leaves.
// This preserves keyboard focus and avoids rebuilding chart geometry on hover.
const ExpensePie = memo(function ExpensePie({ categories, layout, onResize, onEnter, onLeave, onSelect }) {
  const labelsByIndex = new Map(layout.labels.map((label) => [label.index, label]))
  return (
    <ResponsiveContainer width="100%" height={layout.height} minWidth={0} onResize={onResize}>
      <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }} accessibilityLayer={false} role="group" aria-label="Expense pie chart">
        <Pie
          data={categories}
          dataKey="amount"
          nameKey="name"
          cx={layout.cx}
          cy={layout.cy}
          outerRadius={layout.radius}
          innerRadius={0}
          startAngle={90}
          endAngle={-270}
          paddingAngle={0}
          minAngle={0}
          rootTabIndex={-1}
          isAnimationActive={false}
          shape={renderSlice}
          label={layout.labels.length ? ({ index }) => {
            const label = labelsByIndex.get(index)
            return label ? <ExpenseLabel label={label} category={categories[index]} /> : <g />
          } : false}
          labelLine={false}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onClick={onSelect}
        />
        <Tooltip content={<CategoryTooltip />} isAnimationActive={false} />
      </PieChart>
    </ResponsiveContainer>
  )
})

const CategoryExpenseChart = ({
  categories: realCategories,
  totalExpenses: realTotalExpenses,
  monthLabel,
  isReady = true,
  loadError = "",
}) => {
  const descriptionId = useId()
  const [previewRequested, setPreviewRequested] = useState(false)
  const isSamplePreview = isReady && !loadError && realCategories.length === 0 && previewRequested
  const preview = useMemo(() => isSamplePreview ? getCategoryExpensePreview() : null, [isSamplePreview])
  const categories = preview?.categories ?? realCategories
  const totalExpenses = preview?.totalExpenses ?? realTotalExpenses
  const [width, setWidth] = useState(0)
  const [hoveredCategory, setHoveredCategory] = useState(null)
  const [focusedCategory, setFocusedCategory] = useState(null)
  const [selectedCategory, setSelectedCategory] = useState(null)
  const categoryNames = useMemo(() => new Set(categories.map((category) => category.name)), [categories])
  const activeCategory = [hoveredCategory, focusedCategory, selectedCategory].find((name) => categoryNames.has(name)) ?? null
  const hasSelection = categoryNames.has(selectedCategory)
  const layout = useMemo(() => getExpensePieLayout(categories, width), [categories, width])
  const toggleCategory = useCallback((name) => setSelectedCategory((current) => current === name ? null : name), [])
  const clearSelection = useCallback(() => setSelectedCategory(null), [])
  const handleResize = useCallback((nextWidth) => setWidth(Math.floor(nextWidth)), [])
  const handleEnter = useCallback((slice) => setHoveredCategory(slice.name), [])
  const handleLeave = useCallback(() => setHoveredCategory(null), [])
  const handleSelect = useCallback((slice) => toggleCategory(slice.name), [toggleCategory])

  return (
    <Card padding="lg" className="min-w-0">
      <section className="@container min-w-0" aria-label="Category expense distribution">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="theme-panel theme-accent-text rounded-xl p-2.5"><PieChartIcon size={21} aria-hidden="true" /></span>
            <div>
              <h2 className="theme-text text-lg font-semibold tracking-tight">Category Distribution</h2>
              <p className="theme-muted-text mt-1 text-sm">{isSamplePreview ? "Example monthly spending" : `Where your money went · ${monthLabel}`}</p>
            </div>
          </div>
          <div className="min-w-0 text-left @min-[520px]:text-right">
            <p className="theme-muted-text text-xs">{isSamplePreview ? "Sample expenses" : "Total expenses"}</p>
            <p className="theme-text mt-1 text-xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]">{formatExpenseAmount(totalExpenses)}</p>
          </div>
        </div>

        {isSamplePreview && (
          <div className="theme-panel mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm" role="status">
            <div>
              <p className="theme-accent-text text-xs font-semibold tracking-wide">SAMPLE DATA · DEMO PREVIEW</p>
              <p className="theme-muted-text mt-1 text-xs">Example expenses only. Your transactions, totals and balances are unchanged.</p>
            </div>
            <button type="button" onClick={() => setPreviewRequested(false)} className="theme-link rounded text-xs font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">Back to my data</button>
          </div>
        )}
        {loadError && realCategories.length > 0 && (
          <p className="theme-muted-text mt-4 text-sm" role="alert">Transactions could not be fully refreshed. Showing the expenses already loaded.</p>
        )}

        {categories.length === 0 ? (
          <div className="theme-panel mt-6 flex min-h-64 flex-col items-center justify-center rounded-xl px-6 text-center">
            <PieChartIcon className="theme-muted-text mb-3" size={36} strokeWidth={1.3} aria-hidden="true" />
            <h3 className="theme-text font-semibold" role={loadError ? "alert" : "status"}>{!isReady ? "Loading expenses…" : loadError ? "Expenses could not be loaded" : "No expenses this month"}</h3>
            <p className="theme-muted-text mt-2 max-w-sm text-sm">{!isReady ? "Your category breakdown will appear when transactions are ready." : loadError ? "Check your connection and reload to try again. Your transactions have not been changed." : `Expenses recorded in ${monthLabel} will appear here. Choose another month to explore your spending.`}</p>
            {isReady && !loadError && (
              <button type="button" onClick={() => setPreviewRequested(true)} className="theme-button-secondary mt-5 rounded-lg px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)">Preview with sample data</button>
            )}
          </div>
        ) : (
          <>
            <p id={descriptionId} className="sr-only">
              {categories.length} {isSamplePreview ? "sample expense categories in this demo preview" : `expense categories in ${monthLabel}`}. Select a slice or a category below to highlight it. Press Escape to clear a selection.
            </p>
            <div className="mt-3 min-w-0" aria-describedby={descriptionId}>
              <ChartInteractionContext.Provider value={{ activeCategory, selectedCategory, setFocusedCategory, toggleCategory, clearSelection }}>
                <ExpensePie categories={categories} layout={layout} onResize={handleResize} onEnter={handleEnter} onLeave={handleLeave} onSelect={handleSelect} />
              </ChartInteractionContext.Provider>
            </div>
            <div className="theme-muted-text mb-5 flex min-h-5 flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-xs">
              <span>Hover or select a slice to explore</span>
              {layout.labels.length > 0 && layout.labels.length < categories.length && <span>Smaller categories are detailed below</span>}
              {hasSelection && (
                <button type="button" onClick={() => setSelectedCategory(null)} className="theme-link rounded underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">Clear selection</button>
              )}
            </div>
            <div className="theme-border border-t pt-4">
              <div className="theme-muted-text mb-2 flex items-center justify-between px-3 text-xs">
                <h3 className="font-medium">Category breakdown</h3>
                <span>{categories.length} {categories.length === 1 ? "category" : "categories"} · INR</span>
              </div>
              <ul className="grid gap-x-6 gap-y-1 @min-[760px]:grid-cols-2" aria-label={isSamplePreview ? "Sample expenses by category" : "Monthly expenses by category"}>
                {categories.map((category) => {
                  const isActive = activeCategory === category.name
                  return (
                    <li key={category.name} className="min-w-0">
                      <button
                        type="button"
                        className="grid w-full grid-cols-[0.625rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-transparent px-3 py-3 text-left transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color) motion-reduce:transition-none"
                        style={{ background: isActive ? "var(--surface-muted)" : undefined, borderColor: isActive ? "var(--border-color)" : undefined }}
                        aria-pressed={selectedCategory === category.name}
                        onMouseEnter={() => setHoveredCategory(category.name)}
                        onMouseLeave={() => setHoveredCategory(null)}
                        onFocus={() => setFocusedCategory(category.name)}
                        onBlur={() => setFocusedCategory(null)}
                        onClick={() => toggleCategory(category.name)}
                        onKeyDown={(event) => { if (event.key === "Escape") setSelectedCategory(null) }}
                      >
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: category.fill }} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="theme-text block text-sm font-medium [overflow-wrap:anywhere]">{category.name}</span>
                          <span className="theme-muted-text mt-0.5 block text-xs tabular-nums">{formatExpensePercentage(category.percentage)}</span>
                        </span>
                        <span className="theme-text max-w-40 text-right text-sm font-semibold tabular-nums [overflow-wrap:anywhere]">{formatExpenseAmount(category.amount)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        )}
      </section>
    </Card>
  )
}

export default CategoryExpenseChart
