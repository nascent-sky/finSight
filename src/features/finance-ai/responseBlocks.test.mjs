import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { calculateComparison } from "./financialContext.js"
import { answerDemoQuestion, createDemoFinancialIndex, DEMO_AS_OF } from "./demoAnalysis.js"
import { analyseFinancialQuery } from "./financialEngine.js"
import { validateInterpretedIntent } from "./questionPlanner.js"
import { chronologicalComparison, RESPONSE_ACTIONS, responsePresentation, textResponseBlocks, validateResponsePresentation } from "./responseBlocks.js"
import { appGuideResponse } from "./appGuidance.js"
import { createFinanceChatClient } from "../../services/financeChatClient.js"

const options = { now: new Date(DEMO_AS_OF), timezone: "UTC" }
const metric = { type: "metric", label: "Expenses", semantic: "expense", amountPaise: 345000, period: "October 2026" }
const card = { id: "expenses", title: "Recorded expenses", previousLabel: "September 2026", currentLabel: "October 2026", previousStart: "2026-09-01", currentStart: "2026-10-01", metric: "expense", ...calculateComparison(280000, 345000) }

test("different demo questions select compact totals, categories, numbered recommendations and comparisons", async () => {
  const total = await answerDemoQuestion({ question: "How much did I spend today?" })
  assert.deepEqual(total.presentation.blocks.map((block) => block.type), ["metric"])
  assert.equal(total.presentation.blocks[0].amountPaise, 125000)
  const overview = await answerDemoQuestion({ question: "Where did my money go?" })
  assert.deepEqual(overview.presentation.blocks.map((block) => block.type), ["categories"])
  assert.equal(overview.presentation.blocks[0].totalPaise, 1170000)
  assert.equal(overview.presentation.blocks[0].items.reduce((total, item) => total + item.amountPaise, 0), 1170000)
  const advice = await answerDemoQuestion({ question: "How can I reduce it?", context: overview.context })
  assert.equal(advice.presentation.blocks.filter((block) => block.type === "recommendation").length, 3)
  assert.equal(advice.presentation.blocks[1].estimate.savingPaise, 60000)
  const compare = await answerDemoQuestion({ question: "Compare food this month with last month" })
  const comparison = compare.presentation.blocks.find((block) => block.type === "comparison").card
  assert.equal(comparison.previousPaise, 280000)
  assert.equal(comparison.currentPaise, 345000)
  assert.equal(comparison.changePaise, 65000)
  assert.equal(comparison.percentage, 23.2)
  assert.match(comparison.title, /^Sample/)
  for (const result of [total, overview, advice, compare]) {
    assert.equal(result.source, "demo_local")
    assert.equal(validateResponsePresentation(result.presentation), result.presentation)
    assert.ok(result.presentation.blocks.every((block) => block.type !== "actions"))
  }
})

test("income versus expenses is a bounded metric row rather than an oversized report", async () => {
  const result = await answerDemoQuestion({ question: "Income versus expenses this month" })
  const metrics = result.presentation.blocks.filter((block) => block.type === "metric")
  assert.deepEqual(metrics.map((block) => [block.semantic, block.amountPaise]), [["income", 3200000], ["expense", 1170000], ["net", 2030000]])
  assert.ok(result.presentation.blocks.length < 6)
})

test("historically reversed query comparisons are presented previous → current with recomputed changes", () => {
  const plan = validateInterpretedIntent({ status: "resolved", intent: "income", start: "2026-09-01", end: "2026-10-01", comparisonStart: "2026-10-01", comparisonEnd: "2026-11-01", category: null, method: null, explain: true, reference: false }, options)
  const result = analyseFinancialQuery(createDemoFinancialIndex(), plan)
  assert.equal(result.cards[0].changePaise, -200000) // query facts remain authoritative for their original scopes
  const shown = result.presentation.blocks[0].card
  assert.equal(shown.previousStart, "2026-09-01")
  assert.equal(shown.currentStart, "2026-10-01")
  assert.equal(shown.previousPaise, 3000000)
  assert.equal(shown.currentPaise, 3200000)
  assert.equal(shown.changePaise, 200000)
  assert.equal(shown.direction, "up")
  assert.equal(result.facts.comparison_change.value, "+₹2,000")
  assert.equal(result.facts.comparison_percentage.value, "+6.7%")
  assert.match(result.facts.comparison_previous_period.value, /September/)
  assert.equal(validateResponsePresentation(result.presentation), result.presentation)
})

test("a zero previous value retains absolute change and a null percentage", () => {
  const zero = chronologicalComparison({ ...card, ...calculateComparison(0, 345000) })
  assert.equal(zero.changePaise, 345000)
  assert.equal(zero.percentage, null)
  assert.doesNotThrow(() => responsePresentation([{ type: "comparison", card: zero }]))
  assert.throws(() => responsePresentation([{ type: "comparison", card: { ...zero, percentage: 100 } }]))
})

test("public block validation rejects unsafe schemas, inconsistent metrics, percentages and savings arithmetic", () => {
  const categories = { type: "categories", period: "October", basis: "expenses", totalPaise: 10000, otherCount: 0, items: [{ label: "Food", amountPaise: 10000, share: 100 }] }
  const saving = { type: "savings", label: "Shopping", period: "October", originalPaise: 10000, savingPaise: 2000, remainingPaise: 8000, reductionBps: 2000, hypothetical: true }
  for (const block of [
    { type: "html", html: "<script>bad()</script>" }, { ...metric, amountPaise: 1.1 }, { ...metric, amountPaise: -1 }, { ...metric, amountPaise: Number.NaN }, { ...metric, href: "/budget" },
    { type: "actions", ids: ["budget"] }, { type: "actions", ids: ["analytics"], url: "https://evil.example" }, { type: "followups", ids: ["send_money"] },
    { ...categories, items: [{ ...categories.items[0], share: 10 }] }, { ...categories, items: [{ label: "Food", amountPaise: 5000, share: 50 }] },
    { ...saving, savingPaise: 9999 }, { ...saving, reductionBps: 3000 }, { ...saving, hypothetical: false },
    { type: "comparison", card: { ...card, previousStart: "2026-02-30" } }, { type: "comparison", card: { ...card, direction: "down" } },
  ]) assert.throws(() => responsePresentation([block]))
  assert.throws(() => validateResponsePresentation({ version: 2, blocks: [metric] }))
  assert.throws(() => responsePresentation(Array.from({ length: 17 }, () => metric)))
  assert.doesNotThrow(() => responsePresentation([categories, saving, { ...metric, semantic: "net", amountPaise: -100 }]))
})

test("all navigation IDs resolve only to actual application routes and GPay guidance uses the implemented PDF workflow", async () => {
  const source = await readFile(new URL("../../App.jsx", import.meta.url), "utf8")
  for (const action of Object.values(RESPONSE_ACTIONS)) assert.ok(source.includes(`path="${action.to}"`), action.to)
  assert.deepEqual(Object.keys(RESPONSE_ACTIONS), ["analytics", "transactions", "gpay_import"])
  const result = appGuideResponse("gpay_import")
  assert.equal(result.presentation.blocks[1].ordered, true)
  assert.match(result.answer, /PDF/)
  assert.match(result.answer, /Review.*transactions/)
  assert.deepEqual(result.presentation.blocks.at(-1), { type: "actions", ids: ["gpay_import"] })
  const demo = await answerDemoQuestion({ question: "How do I import GPay transactions?" })
  assert.equal(demo.source, "demo_local")
  assert.deepEqual(demo.presentation, result.presentation)
})

test("legacy formatting recognizes lists without converting arbitrary text into HTML, financial cards or links", () => {
  const blocks = textResponseBlocks("**A useful next step**\n\n1. Review spending\n2. Compare periods\n\n• Keep essentials\n• Ask about flexibility\n\n<a href='javascript:bad()'>click</a>")
  assert.equal(blocks.filter((block) => block.type === "list").length, 2)
  assert.equal(blocks[1].ordered, true)
  assert.ok(blocks.every((block) => ["list", "paragraph"].includes(block.type)))
  assert.match(blocks.at(-1).text, /javascript/)
})

test("authenticated client rejects malformed rich payloads instead of rendering unverified cards", async () => {
  const user = { uid: "alice", getIdToken: async () => "token" }
  const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async () => Response.json({ source: "gemini", answer: "Result", cards: [], presentation: { version: 1, blocks: [{ ...metric, amountPaise: 3.5 }] } }) })
  await assert.rejects(() => client.requestChat({ user, consent: true, messages: [{ role: "user", content: "Total?" }], timezone: "UTC" }), { code: "AI_RESPONSE_INVALID", retryable: true })
})

test("responsive rules and semantic foregrounds maintain readable contrast against every existing theme surface", async () => {
  const css = await readFile(new URL("./responseBlocks.css", import.meta.url), "utf8")
  assert.match(css, /@media \(max-width: 639px\)/)
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /overflow-wrap: anywhere/)
  assert.match(css, /min-height: 44px/)
  assert.match(css, /focus-visible/)
  const theme = await readFile(new URL("../../services/themeService.js", import.meta.url), "utf8")
  const surfaces = [...theme.matchAll(/surface: "(#[a-f\d]{6})"/gi)].map((match) => match[1])
  const rgb = (hex) => hex.match(/[a-f\d]{2}/gi).map((part) => parseInt(part, 16) / 255)
  const luminance = (channels) => channels.map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0)
  const light = css.slice(0, css.indexOf(':root[data-color-mode="dark"]'))
  const dark = css.slice(css.indexOf(':root[data-color-mode="dark"]'), css.indexOf(".ai-response h3"))
  for (const surface of surfaces) {
    const base = rgb(surface), palette = luminance(base) < .2 ? dark : light
    for (const [, hex] of palette.matchAll(/--ai-(?:positive|negative|info|caution):\s*(#[a-f\d]{6})/gi)) {
      const ink = rgb(hex), background = base.map((channel, i) => channel * .88 + ink[i] * .12)
      const a = luminance(ink), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
      assert.ok(ratio >= 4.5, `${hex} on ${surface}: ${ratio}`)
    }
  }
})
