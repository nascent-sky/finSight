import test, { after } from "node:test"
import assert from "node:assert/strict"
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryRouter } from "react-router-dom"
import { JSDOM } from "jsdom"
import { createFinancialIndex, analyseFinancialQuery } from "./financialEngine.js"
import { validateInterpretedIntent } from "./questionPlanner.js"
import { getCategoryColor } from "../../components/analytics/expenseChartUtils.js"
import { responsePresentation, validateResponsePresentation } from "./responseBlocks.js"
import { transactionListBlock, transactionPeriodLabel } from "./financialPresentation.js"
import { answerDemoQuestion, AI_DEMO_RECORDS } from "./demoAnalysis.js"

// Isolated component rendering only; no application or browser is started.
const root = fileURLToPath(new URL("../../../", import.meta.url))
const temporary = fileURLToPath(new URL(`../../../tmp/ranked-expenses-${process.pid}.mjs`, import.meta.url))
await mkdir(fileURLToPath(new URL("../../../tmp/", import.meta.url)), { recursive: true })
const compiled = await build({ absWorkingDir: root, entryPoints: ["src/features/finance-ai/AssistantResponse.jsx"], bundle: true, platform: "node", format: "esm", packages: "external", write: false, jsx: "automatic" })
await writeFile(temporary, compiled.outputFiles[0].text)
const { default: AssistantResponse } = await import(pathToFileURL(temporary).href)
after(() => unlink(temporary))

const now = new Date("2026-10-25T12:00:00Z")
const records = [[2000, "Education", 24, "cash"], [1200, "Shopping", 16, "upi"], [930, "Transport", 24, "cash"], [840, "Food & Dining", 20, "upi"], [360, "Entertainment", 6, "cash"], ...[200, 150, 130, 120, 110, 90.30, 80, 43.70].map((amount) => [amount, "Other", 2, "upi"])].map(([amount, category, day, paymentMethod], i) => ({ id: `private-record-${i}`, amount, category, paymentMethod, type: "expense", datetime: `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`, note: "private note" }))
const index = createFinancialIndex(records, { now, timezone: "UTC" })
const plan = validateInterpretedIntent({ status: "resolved", intent: "largest", start: "2026-10-01", end: "2026-11-01", comparisonStart: null, comparisonEnd: null, category: null, method: null, explain: false, reference: false }, { now, timezone: "UTC" })
const analysis = analyseFinancialQuery(index, plan)
const card = analysis.presentation.blocks.find((block) => block.type === "ranked_expenses")
const render = (presentation) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(AssistantResponse, { presentation })))

test("largest-expense projection preserves exact ranked transactions, full totals, scope and display count", () => {
  assert.equal(card.totalPaise, 625400)
  assert.equal(card.totalCount, 13)
  assert.equal(card.items.length, 5)
  assert.deepEqual(card.items.map((row) => row.amountPaise), [200000, 120000, 93000, 84000, 36000])
  assert.deepEqual(card.items.map((row) => row.method), ["cash", "upi", "cash", "upi", "cash"])
  assert.equal(card.items[0].date, "2026-10-24")
  assert.equal(card.items[0].share, 32)
  assert.doesNotMatch(JSON.stringify(card), /private/)
  assert.equal(validateResponsePresentation(analysis.presentation), analysis.presentation)
})

test("ranked card renders category icons/colors, right-aligned INR, dates, payment labels and the existing navigation", () => {
  const dom = new JSDOM(render(analysis.presentation)), document = dom.window.document
  const cardElement = document.querySelector('[aria-label="Largest expenses"]')
  assert.match(cardElement.textContent, /Largest Expenses.*October 2026.*₹6,254/)
  const rows = [...cardElement.querySelectorAll(".ai-ranked-row")]
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((row) => row.querySelector(".ai-ranked-number").textContent), ["1", "2", "3", "4", "5"])
  assert.equal(rows[0].querySelector(".ai-ranked-amount").textContent, "₹2,000")
  assert.equal(rows[0].querySelector("time").dateTime, "2026-10-24")
  assert.equal(rows[0].querySelector("time").textContent, "24 Oct")
  assert.equal(rows[0].querySelector(".ai-ranked-payment").textContent, "CASH")
  assert.equal(rows[1].querySelector(".ai-ranked-payment").textContent, "UPI")
  rows.forEach((row, i) => {
    assert.equal(row.style.getPropertyValue("--rank-color"), getCategoryColor(card.items[i].category))
    assert.equal(row.querySelector(".ai-ranked-icon svg").getAttribute("aria-hidden"), "true")
    assert.match(row.querySelector("progress").getAttribute("aria-valuetext"), /% of total recorded expenses/)
  })
  assert.match(cardElement.querySelector(".ai-ranked-footer").textContent, /Showing 5 of 13 expenses/)
  assert.equal(document.querySelector('a[href="/expenses"]').textContent, "Open Transactions")
  dom.window.close()
})

test("ranked presentation rejects altered financial values, invalid shares, wrong dates/methods and unsorted ranks", () => {
  for (const altered of [
    { ...card, totalPaise: 1 }, { ...card, totalCount: 4 }, { ...card, items: [...card.items].reverse() },
    { ...card, items: [{ ...card.items[0], share: 99 }, ...card.items.slice(1)] },
    { ...card, items: [{ ...card.items[0], date: "2026-09-24" }, ...card.items.slice(1)] },
    { ...card, items: [{ ...card.items[0], date: "2026-10-32" }, ...card.items.slice(1)] },
    { ...card, items: [{ ...card.items[0], method: "unverified" }, ...card.items.slice(1)] },
    { ...card, items: [{ ...card.items[0], amountPaise: -1 }, ...card.items.slice(1)] },
    { ...card, href: "javascript:bad()" },
  ]) assert.throws(() => responsePresentation([altered]))
})

test("ranked layout has explicit 320px safeguards and theme-aware accents without affecting the category-breakdown component", async () => {
  const css = await readFile(new URL("./responseBlocks.css", import.meta.url), "utf8")
  assert.match(css, /@media \(max-width: 399px\)[^}]*\.ai-ranked-expenses/)
  assert.match(css, /\.ai-ranked-row \{ grid-template-columns: 20px minmax\(0, 1fr\)/)
  assert.match(css, /\.ai-ranked-amount \{ grid-column: 2; font-size: 15px/)
  assert.match(css, /\.ai-ranked-amount[^}]*text-align: right[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.ai-ranked-expenses[^}]*min-width: 0[^}]*max-width: 100%[^}]*box-sizing: border-box/)
  assert.match(css, /:root\[data-color-mode="dark"\] \.ai-ranked-icon/)
  const long = structuredClone(card)
  long.items[0].category = "An unusually long custom category name that must wrap at narrow widths"
  const html = render(responsePresentation([long]))
  assert.match(html, /An unusually long custom category/)
  assert.doesNotMatch(html, /could not be verified/)
})

const sample = (id, amount, category, datetime, paymentMethod = "cash", type = "expense") => ({ id, amount, category, datetime, paymentMethod, type })
const weekRecords = [
  sample("first-entertainment", 360, "Entertainment", "2026-10-06T12:00:00Z"),
  sample("first-utilities", 156, "Utilities", "2026-10-05T12:00:00Z"),
  sample("first-food", 63, "Food & Dining", "2026-10-02T12:00:00Z"),
  sample("excluded-income", 20000, "Income", "2026-10-01T12:00:00Z", "upi", "income"),
  sample("excluded-next-week", 91, "Shopping", "2026-10-08T12:00:00Z"),
]
function listAnalysis(data, extra = {}, options = {}) {
  const settings = { now, timezone: "UTC", ...options }
  const scope = validateInterpretedIntent({ status: "resolved", intent: "list", start: "2026-10-01", end: "2026-10-08", comparisonStart: null, comparisonEnd: null, category: null, method: null, explain: false, reference: false, ...extra }, settings)
  const result = analyseFinancialQuery(createFinancialIndex(data, settings), scope)
  return { result, scope, block: result.presentation.blocks.find((block) => block.type === "transaction_list") }
}

test("first week uses the shared rich card with three verified expenses totaling ₹579 and navigation after records", () => {
  const { result, block } = listAnalysis(weekRecords)
  assert.equal(block.label, "First Week Expenses")
  assert.equal(block.period, "1–7 October 2026")
  assert.equal(block.totalPaise, 57900)
  assert.equal(block.totalCount, 3)
  assert.deepEqual(block.items.map((item) => [item.category, item.amountPaise, item.date]), [["Entertainment", 36000, "2026-10-06"], ["Utilities", 15600, "2026-10-05"], ["Food & Dining", 6300, "2026-10-02"]])
  const dom = new JSDOM(render(result.presentation)), doc = dom.window.document
  const element = doc.querySelector('[aria-label="First Week Expenses"]')
  assert.match(element.querySelector(".ai-ranked-header").textContent, /1–7 October 2026 · 3 transactionsTotal Spent₹579/)
  assert.equal(element.querySelectorAll("ul[role=list] .ai-ranked-row").length, 3)
  assert.equal(element.querySelectorAll(".ai-ranked-number").length, 0)
  assert.ok([...doc.querySelectorAll("section, nav")].indexOf(element) < [...doc.querySelectorAll("section, nav")].indexOf(doc.querySelector("nav")))
  assert.equal(doc.querySelector("a").getAttribute("href"), "/expenses")
  assert.equal(doc.querySelector("a").getAttribute("tabindex"), null)
  assert.doesNotMatch(element.outerHTML, /rowKey|first-entertainment|excluded-income/)
  dom.window.close()
})

test("all validated periods share one card, readable labels and backend-selected order without implicit amount ranks", () => {
  const data = [2, 9, 16, 23].map((day, i) => sample(`week-${i}`, 100 - i * 10, "Utilities", `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`))
  for (let i = 0; i < 4; i++) {
    const start = `2026-10-${String(1 + 7 * i).padStart(2, "0")}`, end = `2026-10-${String(8 + 7 * i).padStart(2, "0")}`
    const { block } = listAnalysis(data, { start, end })
    assert.equal(block.label, `${["First", "Second", "Third", "Fourth"][i]} Week Expenses`)
    assert.equal(block.items.length, 1)
  }
  assert.equal(transactionPeriodLabel("2026-10-24", "2026-10-25"), "24 Oct 2026")
  assert.equal(transactionPeriodLabel("2026-09-28", "2026-10-05"), "28 Sept – 4 Oct 2026")
  assert.equal(transactionPeriodLabel("2025-12-31", "2026-01-02"), "31 Dec 2025 – 1 Jan 2026")
  const { result, scope } = listAnalysis(weekRecords)
  const reversed = [...result.stats.expenses].reverse()
  const supplied = transactionListBlock(result.stats, scope, reversed)
  assert.deepEqual(supplied.items.map((item) => item.date), reversed.map((record) => record.date))
  assert.equal(validateResponsePresentation(responsePresentation([supplied])).blocks[0], supplied)
  for (const [start, end] of [["2026-09-01", "2026-10-01"], ["2026-10-02", "2026-10-07"]]) {
    const data = [sample("range-record", 90.30, "Other", `${start}T10:00:00Z`)]
    const { result, block } = listAnalysis(data, { start, end })
    assert.equal(block.items[0].amountPaise, 9030)
    assert.match(render(result.presentation), /₹90.30/)
  }
})

test("today and yesterday lists use the account timezone and preserve verified local date filtering", () => {
  const data = [sample("today-local", 90.30, "Food & Dining", "2026-10-24T19:00:00Z"), sample("yesterday-local", 12, "Utilities", "2026-10-24T17:59:00Z"), sample("future", 999, "Other", "2026-10-26T00:00:00Z")]
  const { block, result } = listAnalysis(data, { start: "2026-10-25", end: "2026-10-26" }, { timezone: "Asia/Kolkata" })
  assert.equal(block.label, "Today's Expenses")
  assert.equal(block.totalPaise, 9030)
  assert.equal(block.items[0].date, "2026-10-25")
  assert.match(render(result.presentation), /25 Oct 2026/)
  const yesterday = listAnalysis(data, { start: "2026-10-24", end: "2026-10-25" }, { timezone: "Asia/Kolkata" }).block
  assert.equal(yesterday.label, "Yesterday's Expenses")
  assert.equal(yesterday.totalPaise, 1200)
})

test("category, cash, UPI and combined filters keep classification and exact scoped totals", () => {
  const data = [...weekRecords, sample("upi-food", 90.30, "Food & Dining", "2026-10-03T10:00:00Z", "upi"), sample("income-named-expense", 10, "Income", "2026-10-04T10:00:00Z")]
  for (const [filters, count, total] of [[{ category: "Food & Dining" }, 2, 15330], [{ method: "cash" }, 4, 58900], [{ method: "upi" }, 1, 9030], [{ category: "Food & Dining", method: "upi" }, 1, 9030]]) {
    const { block } = listAnalysis(data, filters)
    assert.equal(block.totalCount, count)
    assert.equal(block.totalPaise, total)
    assert.ok(block.items.every((item) => (!filters.category || item.category === filters.category) && (!filters.method || item.method === filters.method)))
    assert.equal(validateResponsePresentation(responsePresentation([block])).blocks[0], block)
  }
  const { result } = listAnalysis(data, { category: "Income" })
  assert.match(render(result.presentation), /Income \(expense category\)/)
  assert.match(render(result.presentation), /₹10/)
})

test("duplicate-looking transactions remain separate using stable canonical identity, never amount/category deduplication", () => {
  const data = ["distinct-a", "distinct-b"].map((id) => sample(id, 63, "Food & Dining", "2026-10-02T12:00:00Z"))
  const first = listAnalysis(data).block, second = listAnalysis([...data].reverse()).block
  assert.equal(first.items.length, 2)
  assert.equal(first.totalPaise, 12600)
  assert.equal(new Set(first.items.map((item) => item.rowKey)).size, 2)
  assert.deepEqual(first.items.map((item) => item.rowKey), second.items.map((item) => item.rowKey))
  const stats = listAnalysis(data).result.stats
  assert.equal(stats.categories[0].paise, 12600)
  assert.ok(first.items.every((item) => item.amountPaise === 6300))
  const dom = new JSDOM(render(responsePresentation([first])))
  assert.equal(dom.window.document.querySelectorAll(".ai-ranked-row").length, 2)
  assert.doesNotMatch(dom.window.document.body.innerHTML, /distinct-[ab]|rowKey|tx-64/)
  dom.window.close()
  assert.throws(() => responsePresentation([{ ...first, items: first.items.map((item) => ({ ...item, rowKey: "same-key" })) }]))
})

test("empty periods show a legitimate empty state without an empty transaction card", () => {
  const { result, block } = listAnalysis(weekRecords, { start: "2026-09-01", end: "2026-10-01" })
  assert.equal(block, undefined)
  const html = render(result.presentation)
  assert.match(html, /No recorded expenses match this scope/)
  assert.doesNotMatch(html, /ai-ranked-expenses/)
})

test("chronological lists retain the 50-record bound with full totals and an explicit omission notice", () => {
  const data = Array.from({ length: 55 }, (_, i) => sample(`bounded-${i}`, 1, "Other", "2026-10-02T12:00:00Z"))
  const { result, block } = listAnalysis(data)
  assert.equal(block.items.length, 50)
  assert.equal(block.totalCount, 55)
  assert.equal(block.totalPaise, 5500)
  assert.equal(new Set(block.items.map((item) => item.rowKey)).size, 50)
  assert.match(render(result.presentation), /Showing 50 of 55 expenses/)
  assert.match(render(result.presentation), /The total includes all matches/)
  assert.throws(() => responsePresentation([{ ...block, items: [...block.items, { ...block.items[0], rowKey: "extra-key" }] }]))
})

test("chronological long labels, semantic structure, 320px rules and shared light/dark styles remain accessible", async () => {
  const category = "An unusually long category that must wrap without hiding its amount or payment information"
  const { result } = listAnalysis([sample("long-label", 90.30, category, "2026-10-02T12:00:00Z")])
  const dom = new JSDOM(render(result.presentation)), doc = dom.window.document
  assert.equal(doc.querySelector(".ai-ranked-name > span:last-child").textContent, category)
  assert.equal(doc.querySelector(".ai-ranked-amount").textContent, "₹90.30")
  assert.equal(doc.querySelector("progress").getAttribute("aria-valuetext"), "100% of total recorded expenses")
  assert.equal(doc.querySelector(".ai-ranked-icon svg").getAttribute("aria-hidden"), "true")
  assert.equal(doc.querySelector(".ai-ranked-list").tagName, "UL")
  assert.equal(doc.querySelector("time").dateTime, "2026-10-02")
  const css = await readFile(new URL("./responseBlocks.css", import.meta.url), "utf8")
  assert.match(css, /\.ai-transactions-chronological \.ai-ranked-row \{ grid-template-columns: minmax\(0, 1fr\) auto/)
  assert.match(css, /@media \(max-width: 399px\) \{ \.ai-transactions-chronological \.ai-ranked-row \{ grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /\.ai-ranked-name > span:last-child[^}]*overflow-wrap: anywhere/)
  assert.match(css, /:root\[data-color-mode="dark"\] \.ai-ranked-icon/)
  assert.doesNotMatch(css, /\.ai-ranked[^}]*min-width: \d+px/)
  dom.window.close()
})

test("guest demo uses the same rich transaction renderer while its sample records remain excluded from account totals", async () => {
  const demo = await answerDemoQuestion({ question: "List my expenses this month" })
  assert.equal(demo.source, "demo_local")
  assert.equal(demo.presentation.blocks.filter((block) => block.type === "transaction_list").length, 1)
  assert.match(render(demo.presentation), /ai-transactions-chronological/)
  assert.equal(createFinancialIndex(AI_DEMO_RECORDS, { now, timezone: "UTC" }).records.length, 0)
  assert.doesNotMatch(render(demo.presentation), /href="\/expenses"|Gemini-generated/)
})
