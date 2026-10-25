// Isolated React/DOM tests only: no application server, browser, Firebase or
// provider is started. Bundle the real page with external-service test seams.
import test, { after, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdir, writeFile, unlink } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"
import { JSDOM } from "jsdom"
import React, { act } from "react"
import { comparisonBlock, responsePresentation } from "./responseBlocks.js"
import { calculateComparison } from "./financialContext.js"
import { createFinanceChatClient } from "../../services/financeChatClient.js"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://finsight.example/ai" })
const globals = new Map()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
dom.window.matchMedia = () => ({ matches: true })
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
const { createRoot } = await import("react-dom/client")
const { MemoryRouter, useLocation } = await import("react-router-dom")
function LocationProbe() { return React.createElement("output", { "aria-label": "Test navigation location" }, useLocation().pathname) }
const rootPath = fileURLToPath(new URL("../../../", import.meta.url))
const temporary = fileURLToPath(new URL(`../../../tmp/finance-ai-ui-${process.pid}.mjs`, import.meta.url))
await mkdir(fileURLToPath(new URL("../../../tmp/", import.meta.url)), { recursive: true })
const compiled = await build({ absWorkingDir: rootPath, entryPoints: ["src/pages/FinSightAI.jsx"], bundle: true, platform: "node", format: "esm", packages: "external", write: false, jsx: "automatic", loader: { ".css": "empty" }, define: { "import.meta.env.DEV": "false" }, plugins: [{ name: "isolated-services", setup(builder) {
  builder.onResolve({ filter: /financeChatService$/ }, () => ({ path: "services", namespace: "fixture" }))
  builder.onResolve({ filter: /ExpensesContext$/ }, () => ({ path: "context", namespace: "fixture" }))
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "context"
    ? "export const useExpenses = () => globalThis.__financeUiContext"
    : "export const requestFinanceChat = (...args) => globalThis.__financeUiServices.ask(...args); export const requestFinanceRoute = (...args) => globalThis.__financeUiServices.routeQuestion(...args); export const requestFinanceCapabilities = (...args) => globalThis.__financeUiServices.getCapabilities(...args); export const subscribeFinanceRecords = (...args) => globalThis.__financeUiServices.subscribeRecords(...args);" }))
} }] })
await writeFile(temporary, compiled.outputFiles[0].text)
const { FinanceChatSession, default: FinSightAI } = await import(pathToFileURL(temporary).href)
const roots = new Set()
afterEach(async () => { await act(async () => { for (const { root, container } of roots) { root.unmount(); container.remove() } roots.clear() }); delete globalThis.__financeUiContext; delete globalThis.__financeUiServices })
after(async () => {
  await unlink(temporary)
  dom.window.close()
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})

const alice = { uid: "alice", isAnonymous: false }, bob = { uid: "bob", isAnonymous: false }
const protectedPolicy = { routingVersion: 1, mode: "protected", cloudConfigured: true, fictionalDataOnly: false, reasons: [{ code: "TEST_UID_NOT_ALLOWLISTED", message: "GEMINI_DEVELOPMENT_UIDS test UID is not allowlisted" }], development: { enabled: true, allowlisted: false, dataConfirmed: true } }
const developmentPolicy = { ...protectedPolicy, mode: "development", fictionalDataOnly: true, reasons: [], development: { enabled: true, allowlisted: true, dataConfirmed: true } }
const now = new Date()
const row = (amount) => ({ id: "account-only-record", type: "expense", amount, category: "Other", paymentMethod: "upi", datetime: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() })
const pause = () => new Promise((resolve) => setTimeout(resolve, 0))
async function ui(initial = {}, overrides = {}, useApp = false) {
  const calls = { subscriptions: [], capabilities: 0, routes: [], cloud: 0, stops: 0 }
  const services = {
    subscribeRecords: (callback, onError, { user }) => { calls.subscriptions.push({ uid: user.uid, callback, onError }); callback([row(user.uid === "alice" ? 777 : 888)], { isReady: true, fromCache: false, hasPendingWrites: false, ownerUid: user.uid }); return () => { calls.stops++ } },
    getCapabilities: async () => { calls.capabilities++; return protectedPolicy },
    routeQuestion: async (request) => { calls.routes.push(request); return { route: "protected", policy: protectedPolicy } },
    ask: async () => { calls.cloud++; throw new Error("Unexpected cloud call") },
    ...overrides,
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.add({ root, container })
  const props = { isAuthReady: true, isOnline: true, user: null, ...services, ...initial }
  const render = async (changes = {}) => {
    Object.assign(props, changes)
    globalThis.__financeUiContext = props
    globalThis.__financeUiServices = services
    await act(async () => { root.render(React.createElement(MemoryRouter, null, React.createElement(React.Fragment, null, React.createElement(useApp ? FinSightAI : FinanceChatSession, useApp ? {} : props), React.createElement(LocationProbe)))); await pause() })
  }
  const button = (text) => [...container.querySelectorAll("button")].find((el) => el.textContent.trim() === text)
  const click = async (text) => { const found = button(text); assert.ok(found, `Missing button: ${text}`); assert.equal(found.disabled, false, `Disabled button: ${text}`); await act(async () => { found.click(); await pause() }) }
  const setInput = async (text) => {
    await act(async () => {
      const input = container.querySelector("textarea")
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(input, text)
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))
    })
  }
  const askText = async (text) => {
    await setInput(text)
    await act(async () => { container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await pause() })
  }
  await render()
  return { calls, render, click, setInput, askText, button, container, text: () => container.textContent, assistant: () => [...container.querySelectorAll(".ai-message-assistant .ai-message-text")].map((el) => el.textContent) }
}

const developmentReply = (answer = "A sample insight.") => ({ route: "development", policy: developmentPolicy, routingVersion: 1, source: "gemini_development", fictionalDataOnly: true, answer, cards: [], context: { version: 2, queries: [] }, cloud: { status: "used", dataHandling: "development" } })
const enableCloud = async (h) => { await act(async () => { h.container.querySelector(".ai-enable").click(); await pause() }) }

test("request regression: Enter, submit and a suggestion cannot duplicate an in-flight question", async () => {
  let finish
  const requests = []
  const waiting = new Promise((resolve) => { finish = resolve })
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: (request) => { requests.push(request); return waiting } })
  await enableCloud(h)
  await h.setInput("Explore the sample expenses")
  await act(async () => {
    h.container.querySelector("textarea").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    h.container.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }))
    h.container.querySelector(".ai-suggestions button").click()
    await pause()
  })
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].messages, [{ role: "user", content: "Explore the sample expenses" }])
  await h.render()
  assert.equal(requests.length, 1)
  await act(async () => { finish(developmentReply()); await pause() })
  assert.equal(h.assistant().length, 1)
  assert.equal(h.calls.cloud, 0)
})

test("request regression: consented chat serializes only bounded conversation and scope, then clears on New chat", async () => {
  const user = { ...alice, getIdToken: async () => "fixture-token" }
  const bodies = []
  const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async (url, init) => {
    assert.equal(url, "/api/finance-chat")
    bodies.push(JSON.parse(init.body))
    return Response.json(developmentReply("A sample insight. ".repeat(180)))
  } })
  const h = await ui({ user }, { getCapabilities: async () => developmentPolicy, routeQuestion: client.requestRoute })
  await h.askText("Where did my money go?")
  assert.equal(bodies.length, 0) // Local analysis before explicit consent.
  await h.click("New chat")
  await enableCloud(h)
  for (let turn = 0; turn < 7; turn++) {
    await h.askText(`Sample question ${turn}`)
    assert.equal(bodies.length, turn + 1)
    const body = bodies.at(-1)
    assert.deepEqual(Object.keys(body).sort(), ["action", "consent", "context", "messages", "timezone"])
    assert.equal(body.action, "route")
    assert.equal(body.consent, true)
    assert.equal(body.messages.length, Math.min(turn * 2 + 1, 11))
    for (const message of body.messages) {
      assert.deepEqual(Object.keys(message).sort(), ["content", "role"])
      if (message.role === "assistant") assert.equal(message.content.length, 2000)
    }
    assert.doesNotMatch(JSON.stringify(body), /account-only-record|777|Discover the story|Your money, made clearer|fictional data with Gemini/)
  }
  assert.equal(bodies.at(-1).messages[0].content, "Sample question 1")
  assert.deepEqual(bodies.at(-1).context, { version: 2, queries: [] })
  assert.equal(h.calls.cloud, 0) // Development routing already returned the answer.
  await h.click("New chat")
  await h.askText("A fresh sample question")
  assert.equal(bodies.length, 8)
  assert.deepEqual(bodies.at(-1).messages, [{ role: "user", content: "A fresh sample question" }])
  assert.equal(bodies.at(-1).context, null)
})

test("request regression: provider errors survive the UI cleanup and Retry replays once without extra history", async () => {
  for (const [status, code, reason, stage, message] of [
    [503, "GEMINI_PROVIDER_FAILED", "unavailable", "planning", "Gemini is temporarily unavailable during planning. Please retry."],
    [503, "GEMINI_PROVIDER_FAILED", "unavailable", "clarification", "Gemini is temporarily unavailable during clarification. Please retry."],
    [504, "GEMINI_TIMEOUT", "timeout", "planning", "Gemini did not finish planning within the request deadline. Please retry."],
  ]) {
    const user = { ...alice, getIdToken: async () => "fixture-token" }
    const bodies = [], errors = []
    const provider = { stage, status, reason, attempts: reason === "unavailable" ? 2 : 1 }
    const client = createFinanceChatClient({ getCurrentUser: () => user, online: () => true, fetcher: async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return bodies.length === 1 ? Response.json({ error: message, code, origin: "provider", providerStatus: status, provider, retryable: true }, { status }) : Response.json(developmentReply())
    } })
    const h = await ui({ user }, { getCapabilities: async () => developmentPolicy, routeQuestion: async (request) => { try { return await client.requestRoute(request) } catch (error) { errors.push(error); throw error } } })
    await enableCloud(h)
    await h.askText("Explore the sample expenses")
    assert.ok(h.text().includes(message))
    assert.equal(h.assistant().length, 0)
    assert.equal(bodies.length, 1)
    assert.equal(errors[0].code, code)
    assert.deepEqual(errors[0].provider, provider)
    await h.render()
    assert.equal(bodies.length, 1) // Re-rendering never retries a failed request.
    await h.click("Retry")
    assert.equal(bodies.length, 2)
    assert.deepEqual(bodies[1], bodies[0])
    assert.equal(h.container.querySelectorAll(".ai-message-user").length, 1)
    assert.equal(h.assistant().length, 1)
  }
})

test("signed-out and existing anonymous guests get the same interactive sample chat, offline, with zero external calls", async () => {
  for (const user of [null, { uid: "anonymous-guest", isAnonymous: true }]) {
    const h = await ui({ user, isOnline: false })
    assert.match(h.text(), /Preview mode/)
    assert.equal(h.container.querySelector("h2").textContent, "See what your money could tell you.")
    assert.match(h.text(), /Explore insights with sample transactions. No account needed/)
    assert.equal(h.container.querySelector('[aria-label="Chat data mode"]'), null)
    assert.equal(h.container.querySelector("select"), null)
    assert.equal(h.button("Enable Gemini"), undefined)
    await h.click("Where did my money go?")
    assert.match(h.assistant()[0], /₹11,700/)
    assert.match(h.text(), /Sample insights/)
    assert.equal(h.calls.subscriptions.length, 0)
    assert.equal(h.calls.capabilities, 0)
    assert.equal(h.calls.routes.length, 0)
    assert.equal(h.calls.cloud, 0)
  }
})

test("the actual page respects auth loading and then automatically selects the regular account", async () => {
  const h = await ui({ user: alice, isAuthReady: false }, {}, true)
  assert.match(h.text(), /Checking your account/)
  assert.doesNotMatch(h.text(), /Sample financial data|777|888/)
  assert.equal(h.container.querySelector("textarea"), null)
  assert.equal(h.calls.subscriptions.length, 0)
  assert.equal(h.calls.capabilities, 0)
  await h.render({ isAuthReady: true })
  assert.equal(h.container.querySelector(".ai-heading p").textContent, "Your money, made clearer.")
  assert.equal(h.container.querySelector("h2").textContent, "Discover the story behind your spending.")
  assert.equal(h.container.querySelector(".ai-empty > p").textContent, "Spot patterns, uncover insights, and find smarter ways to save.")
  assert.doesNotMatch(h.text(), /Demo ·|GEMINI_|UID|allowlist/)
  assert.equal(h.calls.subscriptions[0].uid, "alice")
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹777/)
  assert.doesNotMatch(h.assistant()[0], /11,700|888/)
  assert.equal(h.calls.routes.length, 0) // consent remains off
})

test("development UI keeps test-only consent without developer diagnostics or configuration payloads", async () => {
  const h = await ui({ user: alice }, { getCapabilities: async () => ({ ...developmentPolicy, code: "PRIVATE_CONFIGURATION_CODE", diagnostics: { internalConfiguration: "PRIVATE_CONFIGURATION_VALUE" }, reasons: [{ code: "TEST_UID_ALLOWLIST", message: "UID allowlist details" }] }) })
  assert.match(h.text(), /Use only fictional data with Gemini/)
  assert.match(h.text(), /Never share real financial details/)
  assert.match(h.container.querySelector(".ai-consent").textContent, /questions, recent chat and relevant sample details/)
  assert.equal(h.container.querySelectorAll("#ai-cloud-restriction").length, 1)
  assert.equal(h.button("Enable Gemini").getAttribute("aria-describedby"), "ai-cloud-restriction")
  assert.doesNotMatch(h.container.querySelector(".ai-empty").textContent, /fictional|test records|Test data/i)
  assert.equal(h.container.querySelector("pre, .ai-developer-details"), null)
  assert.doesNotMatch(h.text(), /PRIVATE_CONFIGURATION|Developer diagnostics|allowlist|UID|routingVersion/)
  assert.equal(h.calls.routes.length, 0)
  assert.equal(h.calls.cloud, 0)
  await h.click("Enable Gemini")
  assert.match(h.text(), /Use only fictional data with Gemini/)
  assert.equal(h.container.querySelectorAll("#ai-cloud-restriction").length, 1)
  assert.match(h.text(), /Cloud sharing allowed/)
  assert.doesNotMatch(h.text(), /availability not checked|development routing/i)
  await h.click("Turn off & clear")
  assert.ok(h.button("Enable Gemini"))
})

test("development configuration errors use public messaging and unavailable cloud access stays disabled", async () => {
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: async () => { throw Object.assign(new Error("PRIVATE_CONFIGURATION: GEMINI_DATA_HANDLING UID allowlist"), { origin: "configuration" }) } })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  assert.match(h.text(), /Cloud AI is not available for this account under the current privacy settings/)
  assert.doesNotMatch(h.text(), /PRIVATE_CONFIGURATION|GEMINI_|UID|allowlist/)
  await h.render({ user: bob, getCapabilities: async () => ({ ...protectedPolicy, cloudConfigured: false }) })
  assert.equal(h.button("Enable Gemini").disabled, true)
  assert.match(h.text(), /Discover the story behind your spending/)
  assert.doesNotMatch(h.text(), /Use only fictional data with Gemini|Preview mode/)
})

test("login, account switching, logout and anonymous transitions synchronously remove previous messages and context", async () => {
  const h = await ui()
  await h.click("Where did my money go?")
  await h.click("What about last month?")
  assert.match(h.assistant().at(-1), /₹10,200/)
  await h.render({ user: alice })
  assert.equal(h.assistant().length, 0)
  assert.doesNotMatch(h.text(), /10,200|11,700/)
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹777/)
  const aliceCallback = h.calls.subscriptions[0].callback
  await h.render({ user: bob })
  assert.equal(h.assistant().length, 0)
  await act(async () => { aliceCallback([row(99999)], { isReady: true }); await pause() })
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹888/)
  assert.doesNotMatch(h.text(), /777|99,999/)
  await h.render({ user: null })
  assert.equal(h.assistant().length, 0)
  assert.doesNotMatch(h.text(), /777|888|99,999/)
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹11,700/)
  await h.render({ user: { uid: "new-guest", isAnonymous: true } })
  assert.equal(h.assistant().length, 0)
  assert.equal(h.calls.subscriptions.length, 2)
  assert.equal(h.calls.stops, 2)
})

test("loading an already active account clears its conversation before auth resolves", async () => {
  const h = await ui({ user: alice })
  await h.click("Where did my money go?")
  assert.match(h.text(), /₹777/)
  await h.render({ isAuthReady: false })
  assert.doesNotMatch(h.text(), /777|Where did my money go/)
  await h.render({ isAuthReady: true })
  assert.equal(h.assistant().length, 0)
  assert.equal(h.calls.stops, 1)
})

test("demo free-text comparisons preserve cards and New chat clears sample scope", async () => {
  const h = await ui()
  await h.askText("Compare food expenses this month with last month")
  assert.equal(h.container.querySelectorAll(".ai-comparison").length, 1)
  assert.match(h.text(), /₹2,800/)
  assert.match(h.text(), /₹3,450/)
  await h.click("How can I reduce it?")
  assert.match(h.assistant().at(-1), /Food & Dining/)
  await h.click("New chat")
  assert.equal(h.assistant().length, 0)
  assert.equal(h.container.querySelector("textarea").value, "")
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹11,700/)
})

test("logout aborts intended Gemini work and late responses cannot appear in the guest demo", async () => {
  let finish, activeRequest
  const waiting = new Promise((resolve) => { finish = resolve })
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: (request) => { activeRequest = request; return waiting } })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  assert.ok(h.container.querySelector(".ai-typing"))
  await h.render({ user: null })
  assert.equal(activeRequest.signal.aborted, true)
  await act(async () => { finish({ route: "development", policy: developmentPolicy, routingVersion: 1, source: "gemini_development", fictionalDataOnly: true, answer: "PRIVATE-alice-financial-result", cards: [], context: { version: 2, queries: [] }, cloud: { status: "used", dataHandling: "development" } }); await pause() })
  assert.doesNotMatch(h.text(), /PRIVATE-|Cloud sharing allowed/)
  assert.equal(h.assistant().length, 0)
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹11,700/)
})

test("Gemini rate limits remain visible with Retry and an explicit local-analysis choice", async () => {
  let requests = 0
  const h = await ui({ user: alice }, { routeQuestion: async () => { requests++; throw Object.assign(new Error("Gemini quota reached. Please retry later."), { code: "GEMINI_RATE_LIMITED", origin: "provider", status: 429 }) } })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  assert.match(h.text(), /Gemini quota reached/)
  assert.equal(h.assistant().length, 0)
  await h.click("Retry")
  assert.equal(requests, 2)
  await h.click("Use local analysis")
  assert.equal(h.container.querySelector("textarea").value, "Where did my money go?")
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹777/)
  assert.equal(requests, 2)
})

test("verified narrative recovery is labelled locally and Retry replays the original relative question and pre-question scope", async () => {
  const queries = (start, end) => ({ version: 2, queries: [{ intent: "expenses", start, end, comparisonStart: null, comparisonEnd: null, category: null, method: null, task: "answer", targetPaise: null }] })
  const october = queries("2026-10-01", "2026-11-01"), september = queries("2026-09-01", "2026-10-01")
  const requests = []
  const routeResult = (source, context, recovery) => ({ route: "development", policy: developmentPolicy, routingVersion: 1, fictionalDataOnly: true, source, context, answer: source === "local_verified" ? "Verified records match the selected scope." : "The verified expense records are available.", cards: [], recovery, cloud: { status: source === "local_verified" ? "unavailable" : "used", dataHandling: "development" }, presentation: responsePresentation([{ type: "metric", label: "Recorded expenses", semantic: "expense", amountPaise: 77700, period: "Selected period" }]) })
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: async (request) => {
    requests.push(request)
    if (requests.length === 1) return routeResult("gemini_development", october)
    if (requests.length === 2) return routeResult("local_verified", september, { kind: "narrative_consistency", rule: "narrative_records_contradiction", repairAttempted: true, retryable: true })
    return routeResult("gemini_development", september)
  } })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  await h.askText("What about last month?")
  assert.match([...h.container.querySelectorAll(".ai-record-date")].at(-1).textContent, /Verified financial answer · Local explanation/)
  assert.ok(h.button("Retry Gemini explanation"))
  await h.click("Retry Gemini explanation")
  assert.equal(requests.length, 3)
  assert.deepEqual(requests[2].context, october)
  assert.deepEqual(requests[2].context, requests[1].context)
  assert.deepEqual(requests[2].messages, requests[1].messages)
  assert.equal(requests[2].messages.at(-1).content, "What about last month?")
  assert.equal(h.button("Retry Gemini explanation"), undefined)
  assert.match([...h.container.querySelectorAll(".ai-record-date")].at(-1).textContent, /^Gemini\b/)
  await h.render({ user: null })
  assert.equal(h.assistant().length, 0)
  assert.equal(h.button("Retry Gemini explanation"), undefined)
})

test("capability failure keeps local account analysis available and hides technical messages", async () => {
  const h = await ui({ user: alice }, { getCapabilities: async () => { throw Object.assign(new Error("GEMINI_DATA_HANDLING runtime configuration details"), { code: "AI_ROUTING_VERSION_MISMATCH" }) } })
  assert.match(h.text(), /Local financial analysis is still available/)
  assert.doesNotMatch(h.text(), /GEMINI_|AI_ROUTING_VERSION/)
  await h.click("Where did my money go?")
  assert.match(h.assistant()[0], /₹777/)
  assert.ok(h.button("Retry cloud check"))
})

test("source cannot be manually overridden, and consent is cleared on account changes", async () => {
  const h = await ui({ user: alice, isDemo: true, mode: "synthetic" })
  assert.doesNotMatch(h.text(), /Preview mode/)
  await h.click("Enable Gemini")
  assert.match(h.text(), /Cloud sharing allowed/)
  await h.render({ user: bob })
  assert.doesNotMatch(h.text(), /Cloud sharing allowed/)
  assert.ok(h.button("Enable Gemini"))
  await h.render({ user: null, isDemo: false })
  assert.match(h.text(), /Preview mode/)
  assert.equal(h.button("Enable Gemini"), undefined)
})

test("explicit local analysis can continue after a development conversation without passing its cloud-only scope to the local engine", async () => {
  let requests = 0
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: async () => {
    requests++
    if (requests > 1) throw Object.assign(new Error("Gemini is temporarily unavailable."), { origin: "provider", status: 503 })
    return { route: "development", policy: developmentPolicy, routingVersion: 1, source: "gemini_development", fictionalDataOnly: true, answer: "A verified fictional test summary.", cards: [], context: { version: 2, queries: [] }, cloud: { status: "used", dataHandling: "development" } }
  } })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  await h.click("How can I reduce it?")
  assert.ok(h.button("Use local analysis"))
  await h.click("Use local analysis")
  await h.askText("How can I reduce it?")
  assert.match(h.assistant().at(-1), /₹777/)
  assert.match(h.assistant().at(-1), /hypothetical/)
  assert.equal(requests, 2)
  assert.equal(h.container.querySelector(".ai-error"), null)
  assert.match([...h.container.querySelectorAll(".ai-record-date")].at(-1).textContent, /^Local financial answer/)
  assert.ok(h.button("Enable Gemini")) // The local alternative explicitly turns cloud sharing off.
})

test("concise demo totals, accessible category summaries and numbered hypothetical advice use the same rich renderer", async () => {
  const h = await ui()
  await h.askText("How much did I spend today?")
  assert.equal(h.container.querySelectorAll(".ai-metric").length, 1)
  assert.match(h.container.querySelector(".ai-metric dd").textContent, /₹1,250/)
  assert.equal(h.container.querySelector(".ai-categories"), null)
  await h.click("New chat")
  await h.click("Where did my money go?")
  assert.equal(h.container.querySelectorAll(".ai-categories progress").length, 5)
  for (const progress of h.container.querySelectorAll(".ai-categories progress")) {
    assert.ok(progress.getAttribute("aria-label").includes("share of expenses"))
    assert.ok(progress.getAttribute("aria-valuetext").includes("% of expenses"))
  }
  await h.click("How can I reduce it?")
  const advice = h.container.querySelector("ol.ai-recommendations")
  assert.equal(advice.children.length, 3)
  assert.equal(advice.querySelectorAll('[aria-label="Hypothetical savings estimate"]').length, 3)
  assert.match(advice.textContent, /₹600/)
  assert.match(advice.textContent, /not recorded savings/)
  assert.match(h.text(), /Sample insights/)
  assert.equal(h.calls.routes.length, 0)
})

test("zero-baseline expense comparisons show absolute change, N/A and a text trend indicator", async () => {
  const h = await ui({ user: alice })
  await h.askText("Compare this month with last month")
  const comparison = h.container.querySelector(".ai-comparison")
  assert.ok(comparison.classList.contains("ai-trend-negative"))
  assert.match(comparison.textContent, /\+₹777/)
  assert.match(comparison.textContent, /N\/A/)
  assert.match(comparison.textContent, /More spending/)
  assert.equal(comparison.querySelector("details").open, false)
  assert.equal(comparison.querySelector("summary").textContent, "Scope details")
})

test("income comparisons retain chronological columns and use a positive trend with an accessible label", async () => {
  const presentation = responsePresentation([comparisonBlock({ id: "income", title: "Recorded income", metric: "income", previousLabel: "October 2026", currentLabel: "September 2026", previousStart: "2026-10-01", currentStart: "2026-09-01", ...calculateComparison(3200000, 3000000) })])
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: async () => ({ route: "development", policy: developmentPolicy, routingVersion: 1, source: "gemini_development", fictionalDataOnly: true, answer: "Recorded income comparison.", cards: [], presentation, cloud: { status: "used", dataHandling: "development" } }) })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  const card = h.container.querySelector(".ai-comparison")
  assert.ok(card.classList.contains("ai-trend-positive"))
  const columns = card.querySelectorAll(".ai-comparison-values > div")
  assert.match(columns[0].textContent, /September.*₹30,000/)
  assert.match(columns[1].textContent, /October.*₹32,000/)
  assert.match(card.textContent, /Income increased/)
})

test("GPay application guidance renders semantic numbered steps and a working registered navigation link", async () => {
  const h = await ui()
  await h.askText("How do I import GPay transactions?")
  const ordered = h.container.querySelector("ol.ai-response-list")
  assert.equal(ordered.children.length, 3)
  assert.match(ordered.textContent, /PDF/)
  const link = h.container.querySelector('.ai-response-actions a[href="/transactions-import"]')
  assert.equal(link.textContent.trim(), "Import GPay")
  await act(async () => { link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); await pause() })
  assert.equal(h.container.querySelector('[aria-label="Test navigation location"]').textContent, "/transactions-import")
  assert.equal(h.calls.subscriptions.length, 0)
  assert.match(h.text(), /Sample insights/)
})

test("rich text supports emphasis while HTML and unrestricted links remain inert; contextual follow-ups keep conversation scope", async () => {
  const presentation = responsePresentation([
    { type: "heading", text: "A useful next step" },
    { type: "paragraph", text: "Review **flexible costs**. <img src=x onerror=bad()> https://untrusted.example" },
    { type: "notice", tone: "caution", text: "Protect essential expenses." },
    { type: "actions", ids: ["analytics", "transactions"] },
    { type: "followups", ids: ["compare"] },
  ])
  const requests = []
  const context = { version: 2, queries: [] }
  const h = await ui({ user: alice }, { getCapabilities: async () => developmentPolicy, routeQuestion: async (request) => { requests.push(request); return { route: "development", policy: developmentPolicy, routingVersion: 1, source: "gemini_development", fictionalDataOnly: true, answer: "Review flexible costs.", cards: [], presentation, context, cloud: { status: "used", dataHandling: "development" } } } })
  await h.click("Enable Gemini")
  await h.click("Where did my money go?")
  assert.equal(h.container.querySelector(".ai-response-paragraph strong").textContent, "flexible costs")
  assert.equal(h.container.querySelector(".ai-response img"), null)
  assert.equal(h.container.querySelector('a[href="https://untrusted.example"]'), null)
  assert.ok(h.container.querySelector('.ai-response-actions a[href="/analytics"]'))
  assert.ok(h.container.querySelector('.ai-response-actions a[href="/expenses"]'))
  assert.equal(h.container.querySelector(".ai-response-followups"), null) // footer avoids duplicate chips
  await h.click("Compare this month with last month")
  assert.equal(requests[1].messages.at(-1).content, "Compare this month with last month")
  assert.deepEqual(requests[1].context, context)
  assert.ok(requests[1].messages.some((message) => message.role === "assistant"))
})
