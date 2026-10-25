import test, { after, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { JSDOM } from "jsdom"
import React, { act } from "react"
import { loadStatementModule, textPdf } from "../../tests/helpers/statementHarness.mjs"
import { paytmPdfPages, paytmPdfRows, paytmExcelRows, workbookFile, workbookEntries, paytmSheets } from "../../tests/helpers/paytmFixtures.mjs"
import { getImportDocumentId } from "./statementImportModel.js"
import { shareHarness } from "../../tests/helpers/statementShareHarness.mjs"

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://finsight.example/transactions-import" })
const descriptors = new Map()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
const { createRoot } = await import("react-dom/client")
const { default: ImportPage } = await loadStatementModule("src/pages/TransactionImport.jsx", [{ name: "preview-services", setup(builder) {
  builder.onResolve({ filter: /ThemeContext$/ }, () => ({ path: "theme", namespace: "ui-seam" }))
  builder.onResolve({ filter: /transactionService$/ }, () => ({ path: "save", namespace: "ui-seam" }))
  builder.onLoad({ filter: /.*/, namespace: "ui-seam" }, ({ path }) => ({ contents: path === "theme"
    ? "export const useTheme = () => ({ user: globalThis.__importUi.user })"
    : "export const subscribeToTransactions = (...args) => globalThis.__importUi.subscribe(...args); export const saveImportedTransactionWithId = (...args) => globalThis.__importUi.save(...args); export const syncPendingTransactions = (...args) => globalThis.__importUi.sync(...args)" }))
} }])
const csv = await readFile(new URL("../../tests/fixtures/phonepe/statement.csv", import.meta.url), "utf8")
const roots = new Set(), pause = () => new Promise((resolve) => setTimeout(resolve, 0))
const oldCaches = Object.getOwnPropertyDescriptor(globalThis, "caches")
afterEach(async () => { await act(async () => { for (const root of roots) root.unmount() }); roots.clear(); document.body.replaceChildren(); window.history.replaceState({}, "", "/transactions-import"); if (oldCaches) Object.defineProperty(globalThis, "caches", oldCaches); else delete globalThis.caches; delete globalThis.__importUi })
after(() => { dom.window.close(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] } })

async function mount(overrides = {}, strict = false) {
  let listener
  const saves = [], history = []
  const state = { user: null, sync: async () => ({ synced: 0, duplicates: 0, failed: 0 }), subscribe: (callback) => { listener = callback; callback(history); return () => {} }, save: async (id, transaction) => { saves.push({ id, transaction }); history.push({ id, ...transaction }); listener(history.slice()); return { created: true, pending: false } }, ...overrides }
  globalThis.__importUi = state
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  const render = async () => { await act(async () => { const page = React.createElement(ImportPage); root.render(strict ? React.createElement(React.StrictMode, null, page) : page); await pause() }) }
  await render()
  const button = (prefix) => [...container.querySelectorAll("button")].find((el) => el.textContent.startsWith(prefix))
  const click = async (prefix) => { const el = button(prefix); assert.ok(el); assert.equal(el.disabled, false); await act(async () => { el.click(); await pause() }) }
  const load = async (text = csv) => {
    const input = container.querySelector('input[type="file"]')
    Object.defineProperty(input, "files", { configurable: true, value: [text instanceof File ? text : new File([text], "synthetic.csv", { type: "text/csv" })] })
    await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await pause() })
    for (let attempt = 0; attempt < 100 && container.textContent.includes("Reading the statement locally"); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
  }
  const edit = async (label, value) => {
    const el = container.querySelector(`[aria-label="${label}"]`)
    assert.ok(el)
    const prototype = el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value").set.call(el, value); el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); await pause() })
  }
  return { container, saves, load, edit, click, button, render, state }
}

const waitFor = async (condition) => {
  for (let attempt = 0; attempt < 300 && !condition(); attempt++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  assert.ok(condition(), "Expected the received file to produce a preview automatically")
}
const stage = async (file) => {
  const h = shareHarness(), response = await h.share([file])
  Object.defineProperty(globalThis, "caches", { configurable: true, value: h.caches })
  const url = new URL(response.headers.get("Location"))
  window.history.replaceState({}, "", `${url.pathname}${url.search}`)
  return h
}
const phonePePages = JSON.parse(await readFile(new URL("../../tests/fixtures/phonepe/statement.pdf-lines.json", import.meta.url), "utf8"))
const gpayLines = ["Google Pay transaction statement", "12 Oct, 2026", "3:37 pm", "Paid to Sample Merchant ₹1", "UPI Transaction ID: 900000001001"]
for (const [label, file, expected, count] of [
  ["GPay PDF", textPdf([gpayLines]), "Google Pay · PDF", 1],
  ["PhonePe PDF", textPdf(phonePePages), "PhonePe · PDF", 3],
  ["PhonePe CSV", new File([csv], "fictional.csv", { type: "text/csv" }), "PhonePe · CSV", 3],
  ["Paytm PDF", textPdf(paytmPdfPages), "Paytm · PDF", 3],
  ["Paytm XLSX", workbookFile(), "Paytm · XLSX", 3],
]) test(`${label} multipart Android handoff automatically displays the real parser preview without file selection`, async () => {
  const h = await stage(file), ui = await mount({}, true)
  await waitFor(() => ui.container.textContent.includes(`Detected ${expected} · ${count} transactions`))
  assert.equal(ui.saves.length, 0)
  assert.equal(ui.button(`Import ${count} Transactions`).disabled, false)
  assert.equal(h.stored.size, 0)
  assert.equal(new URLSearchParams(window.location.search).has("shared"), false)
})
test("a received file survives authentication resolving before cache delivery and after preview creation", async () => {
  const h = await stage(new File([csv], "fictional.csv", { type: "text/csv" }))
  let release, opens = 0
  Object.defineProperty(globalThis, "caches", { configurable: true, value: { open: () => { opens++; return new Promise((resolve) => { release = () => resolve(h.cache) }) } } })
  const ui = await mount({}, true)
  ui.state.user = { uid: "signed-in-fixture" }
  await ui.render()
  await act(async () => { release(); await pause() })
  await waitFor(() => ui.container.textContent.includes("PhonePe · CSV · 3 transactions"))
  assert.equal(opens, 1); assert.equal(ui.saves.length, 0)
  ui.state.user = { uid: "different-fixture" }; await ui.render()
  await waitFor(() => ui.container.textContent.includes("PhonePe · CSV · 3 transactions"))
  assert.equal(opens, 1); assert.equal(h.stored.size, 0)
})
test("missing browser delivery is reported without pretending that a file was received", async () => {
  window.history.replaceState({}, "", "/transactions-import?shared=missing")
  const ui = await mount()
  await waitFor(() => ui.container.textContent.includes("browser did not deliver"))
  assert.equal(ui.container.querySelector('[aria-label="Parsed transaction preview"]'), null)
})
test("Excel reimport keeps the saved PDF timestamp and offers no timestamp update action", async () => {
  const history = paytmPdfRows().map((row) => ({ id: getImportDocumentId(row), ...row })), calls = []
  const original = structuredClone(history)
  const ui = await mount({ subscribe: (callback) => { callback(history); return () => {} }, save: async (...args) => { calls.push(args); return { created: false } } })
  await ui.load(workbookFile())
  assert.equal(ui.button("Import 0 Transactions").disabled, true)
  assert.equal([...ui.container.querySelectorAll("button")].filter((button) => /Excel time|saved time/i.test(button.textContent)).length, 0)
  assert.deepEqual(history, original); assert.equal(calls.length, 0)
})

test("Paytm workbook preview shows totals, editable fields and source metadata using the shared save flow", async () => {
  const sheets = structuredClone(paytmSheets); sheets[1].data[1][8] = "Review this source remark"
  const ui = await mount()
  await ui.load(workbookFile(workbookEntries(sheets)))
  assert.match(ui.container.textContent, /Detected Paytm · XLSX · 3 transactions/)
  assert.match(ui.container.textContent, /₹2,930.00/)
  assert.match(ui.container.textContent, /Review this source remark/)
  assert.ok(ui.container.querySelector('input[type="file"]').accept.includes(".xlsx"))
  await ui.edit("Note 1", "Reviewed note")
  await ui.click("Import 3 Transactions")
  assert.equal(ui.saves.length, 3)
  assert.equal(ui.saves[0].transaction.note, "Reviewed note")
  assert.equal(ui.saves[0].transaction.type, "income")
  assert.equal(ui.saves[0].transaction.datetime, paytmExcelRows()[0].datetime)
  assert.match(ui.container.textContent, /3 imported/)
  await ui.load(workbookFile())
  assert.equal(ui.button("Import 0 Transactions").disabled, true)
  assert.match(ui.container.textContent, /3 already imported/)
})
test("preview shows count/totals, accepts corrections and saves only approved canonical transactions", async () => {
  const ui = await mount()
  await ui.load()
  assert.match(ui.container.textContent, /PhonePe · CSV · 3 transactions/)
  assert.match(ui.container.textContent, /₹3.00/)
  await ui.edit("Amount 1", "2.50")
  await ui.edit("Person 1", "Corrected Merchant")
  await ui.edit("Direction 1", "income")
  await ui.edit("Date and time 1", "2026-10-13T00:01:00")
  await act(async () => { const category = ui.container.querySelector('select[name="category"]'); category.value = "Income"; category.dispatchEvent(new dom.window.Event("change", { bubbles: true })) })
  await ui.click("Import 3 Transactions")
  assert.equal(ui.saves.length, 3)
  assert.equal(ui.saves[0].transaction.amountPaise, 250)
  assert.equal(ui.saves[0].transaction.person, "Corrected Merchant")
  assert.equal(ui.saves[0].transaction.type, "income")
  assert.equal(ui.saves[0].transaction.category, "Income")
  assert.equal(ui.saves[0].transaction.datetime, "2026-10-12T18:31:00.000Z")
  assert.match(ui.container.textContent, /3 imported/)
  await ui.load()
  assert.equal(ui.button("Import 0 Transactions").disabled, true)
  assert.equal(ui.container.textContent.match(/Duplicate — excluded/g).length, 2)
  assert.match(ui.container.textContent, /Reference conflict — review existing transaction/)
})

test("partial parsing requires explicit acknowledgement and invalid edits are excluded", async () => {
  const ui = await mount()
  await ui.load(csv.replace(",DEBIT,", ",UNKNOWN,"))
  assert.equal(ui.button("Import 2 Transactions").disabled, true)
  assert.match(ui.container.textContent, /CSV row 5/)
  await act(async () => { const checkbox = [...ui.container.querySelectorAll('input[type="checkbox"]')].find((el) => !el.getAttribute("aria-label")); checkbox.click() })
  assert.equal(ui.button("Import 2 Transactions").disabled, false)
  await ui.edit("Amount 1", "0")
  assert.match(ui.container.textContent, /Invalid records are excluded/)
  await ui.click("Import 1 Transactions")
  assert.equal(ui.saves.length, 1)
})

test("offline success reports pending sync and user selection excludes a record", async () => {
  const saves = []
  const ui = await mount({ user: { uid: "synthetic-user" }, save: async (id, transaction) => { saves.push({ id, transaction }); return { created: true, pending: true } } })
  await ui.load()
  await act(async () => ui.container.querySelector('[aria-label="Import transaction 1"]').click())
  await ui.click("Import 2 Transactions")
  assert.equal(saves.length, 2)
  assert.match(ui.container.textContent, /2 saved on this device and waiting to sync/)
})

test("missing UTR warnings require review before an app-ID-only record can be approved", async () => {
  const ui = await mount()
  await ui.load(csv.replace("900000001001", ""))
  assert.match(ui.container.textContent, /cross-app duplicates cannot be verified/)
  assert.equal(ui.button("Import 3 Transactions").disabled, true)
})

test("account change resets preview and stops a running import batch", async () => {
  let release
  const saves = []
  const ui = await mount({ user: { uid: "first-user" }, save: async (id) => { saves.push(id); return new Promise((resolve) => { release = () => resolve({ created: true }) }) } })
  await ui.load()
  await ui.click("Import 3 Transactions")
  ui.state.user = { uid: "second-user" }
  await ui.render()
  assert.equal(ui.container.querySelector('[aria-label="Parsed transaction preview"]'), null)
  await act(async () => { release(); await pause() })
  assert.equal(saves.length, 1)
  assert.doesNotMatch(ui.container.textContent, /Import complete/)
})

test("three save rejections report Import failed with sanitized diagnostics and remain selected", async () => {
  const ui = await mount({ save: async () => { throw Object.assign(new Error("private transaction, token and key must never render"), { code: "permission-denied" }) } })
  await ui.load()
  await ui.click("Import 3 Transactions")
  assert.match(ui.container.textContent, /Import failed/)
  assert.doesNotMatch(ui.container.textContent, /Import complete/)
  assert.match(ui.container.textContent, /0 imported.*0 already imported.*3 failed/)
  assert.match(ui.container.textContent, /permission-denied/)
  assert.doesNotMatch(ui.container.textContent, /private transaction, token and key/)
  assert.equal(ui.button("Import 3 Transactions").disabled, false)
})

test("partial import reports the failed row; retry saves it without resaving successful records", async () => {
  const saved = new Map(), attempts = [], history = []
  let callback, rejectSecond = true
  const ui = await mount({
    subscribe: (listener) => { callback = listener; callback(history); return () => {} },
    save: async (id, transaction, options) => {
      attempts.push(id)
      assert.deepEqual(options, { expectedUid: null })
      if (id.endsWith("1002") && rejectSecond) throw { code: "permission-denied", importStage: "firestore-write", message: "private response" }
      assert.equal(saved.has(id), false)
      saved.set(id, transaction); history.push({ id, ...transaction }); callback(history.slice())
      return { created: true }
    },
  })
  await ui.load(); await ui.click("Import 3 Transactions")
  assert.match(ui.container.textContent, /Partially imported/)
  assert.match(ui.container.textContent, /2 imported.*1 failed/)
  assert.match(ui.container.textContent, /Transaction 2: Permission denied/)
  assert.match(ui.container.textContent, /Stage: Saving to Firestore/)
  assert.doesNotMatch(ui.container.textContent, /private response/)
  assert.equal(ui.button("Import 1 Transactions").disabled, false)
  rejectSecond = false
  await ui.click("Import 1 Transactions")
  assert.equal(saved.size, 3)
  assert.equal(attempts.length, 4)
  assert.match(ui.container.textContent, /1 imported.*2 already imported.*0 failed/)
})

test("offline records are reported as queued, separate from imported or failed", async () => {
  const ui = await mount({ user: { uid: "synthetic-user" }, save: async (id, transaction, options) => { assert.deepEqual(options, { expectedUid: "synthetic-user" }); return { created: true, pending: true } } })
  await ui.load(); await ui.click("Import 3 Transactions")
  assert.match(ui.container.textContent, /Saved on this device/)
  assert.match(ui.container.textContent, /0 imported.*0 already imported.*0 failed/)
  assert.match(ui.container.textContent, /3 saved on this device and waiting to sync/)
  assert.doesNotMatch(ui.container.textContent, /Import complete/)
})

test("pending synchronization failures expose sanitized code/stage and remain retryable", async () => {
  let callback
  const pending = { id: "upi_900000001001", amount: 1, type: "expense", datetime: "2026-10-12T10:07:00.000Z", upiTransactionId: "900000001001", pending: true }
  let failSync = true
  const ui = await mount({ user: { uid: "synthetic-user" }, subscribe: (listener) => { callback = listener; callback([pending]); return () => {} }, sync: async () => {
    if (failSync) return { synced: 0, duplicates: 0, failed: 1, failures: [{ code: "permission-denied", stage: "firestore-write", message: "private server response" }] }
    callback([])
    return { synced: 1, duplicates: 0, failed: 0 }
  } })
  await ui.click("Retry pending sync")
  assert.match(ui.container.textContent, /Synchronization failed/)
  assert.match(ui.container.textContent, /permission-denied/)
  assert.match(ui.container.textContent, /Stage: Saving to Firestore/)
  assert.doesNotMatch(ui.container.textContent, /private server response/)
  assert.equal(ui.button("Retry pending sync").disabled, false)
  failSync = false
  await ui.click("Retry pending sync")
  assert.match(ui.container.textContent, /1 synced.*0 failed/)
})
