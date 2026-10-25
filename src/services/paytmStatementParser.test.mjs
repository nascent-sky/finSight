import test from "node:test"
import assert from "node:assert/strict"
import { parsePaytmAmount, parsePaytmWorkbookRows, resolvePaytmPdfDate, readPaytmStatementPeriod } from "./paytmStatementParser.js"
import { annotateImportDuplicates, findImportMatch, getImportDocumentId } from "./statementImportModel.js"
import { loadStatementModule, textPdf } from "../../tests/helpers/statementHarness.mjs"
import { paytmSheets, paytmPdfPages, paytmHeading, paytmTableHeader, paytmBlocks, paytmExcelRows, paytmPdfRows, parseFixturePdf, workbookEntries, workbookFile } from "../../tests/helpers/paytmFixtures.mjs"

const { parseStatementFile } = await loadStatementModule("src/services/statementImportService.js")
const { validateWorkbookArchive } = await loadStatementModule("src/services/xlsxStatementReader.js")
const totals = (rows) => rows.reduce((result, row) => { result[row.type] += row.amountPaise; return result }, { income: 0, expense: 0 })

test("actual PDF.js extraction and real XLSX reader agree on the sanitized source layouts", async () => {
  const pdf = await parseStatementFile(textPdf(paytmPdfPages)), excel = await parseStatementFile(workbookFile())
  for (const result of [pdf, excel]) {
    assert.equal(result.provider, "paytm"); assert.equal(result.transactions.length, 3)
    assert.deepEqual(totals(result.transactions), { income: 293000, expense: 0 })
    assert.deepEqual(result.parseErrors, []); assert.deepEqual(result.warnings, [])
    assert.ok(result.transactions.every((row) => row.paymentMethod === "upi" && row.category === "Other" && row.utr.startsWith("000")))
  }
  assert.equal(pdf.transactions[0].person, "Sample Payer One")
  assert.equal(pdf.transactions[0].datetime, "2024-08-09T13:39:00.000Z")
  assert.equal(excel.transactions[0].datetime, "2024-08-09T13:39:52.000Z")
  assert.equal(excel.transactions[0].timestampPrecision, "second")
  assert.equal(pdf.transactions[0].timestampPrecision, "minute")
  assert.deepEqual(pdf.transactions.map(getImportDocumentId), excel.transactions.map(getImportDocumentId))
  // Workbook detection is content-based, even with an unhelpful filename/MIME.
  const file = workbookFile()
  assert.equal((await parseStatementFile(new File([await file.arrayBuffer()], "download.bin"))).provider, "paytm")
})

for (const [first, second] of [[paytmPdfRows(), paytmExcelRows()], [paytmExcelRows(), paytmPdfRows()]]) {
  test(`Paytm ${first[0].source.format} then ${second[0].source.format}: precision differences are three duplicates`, () => {
    const saved = first.map((row) => ({ id: getImportDocumentId(row), ...row }))
    assert.deepEqual(annotateImportDuplicates(second, saved), Array.from({ length: 3 }, () => ({ duplicate: true, conflict: false })))
    assert.ok(second.every((row) => !findImportMatch(row, saved).conflict))
  })
}
test("different references stay distinct; meaningful same-reference changes require review", () => {
  const row = paytmExcelRows()[0], existing = [{ ...row, id: getImportDocumentId(row) }]
  assert.equal(findImportMatch({ ...row, utr: "000000009999", upiTransactionId: "000000009999" }, existing), null)
  for (const updates of [{ amount: 61 }, { type: "expense" }, { person: "Another Party" }, { datetime: "2024-08-09T14:39:52.000Z" }, { datetime: "2024-08-09T13:39:57.000Z" }]) {
    const changed = { ...row, ...updates }
    assert.equal(findImportMatch(changed, existing).conflict, true)
    assert.equal(annotateImportDuplicates([changed], existing)[0].conflict, true)
  }
  assert.equal(findImportMatch({ ...row, person: " SAMPLE  PAYER ONE " }, existing).conflict, false)
})

test("financial-year resolution handles December, January, leap days and ambiguity without using today", () => {
  const period = readPaytmStatementPeriod([["Paytm Statement 1 APR'24 - 31 MAR'25"]])
  assert.equal(resolvePaytmPdfDate("31 Dec", period), "2024-12-31")
  assert.equal(resolvePaytmPdfDate("01 Jan", period), "2025-01-01")
  assert.equal(resolvePaytmPdfDate("29 Feb", { start: "2023-04-01", end: "2024-03-31" }), "2024-02-29")
  for (const [date, range] of [["29 Feb", period], ["31 Mar", { start: "2024-04-01", end: "2024-12-31" }], ["09 Aug", { start: "2023-04-01", end: "2025-03-31" }]]) assert.throws(() => resolvePaytmPdfDate(date, range), /unambiguously/)
  assert.throws(() => readPaytmStatementPeriod([["No period"]]), /period/)
  assert.throws(() => readPaytmStatementPeriod([["1 APR'24 - 31 MAR'25", "1 APR'25 - 31 MAR'26"]]), /period/)
})
test("wrapped records continue across pages and repeated table headers/footer are ignored", async () => {
  const pages = [
    [...paytmHeading, ...paytmTableHeader, ...paytmBlocks[0].slice(0, 3), [{ x: 22, text: "Page 1 of 2" }]],
    [...paytmTableHeader, ...paytmBlocks[0].slice(3), ...paytmBlocks[1], ...paytmBlocks[2], [{ x: 22, text: "Page 2 of 2" }]],
  ]
  const parsed = await parseStatementFile(textPdf(pages))
  assert.equal(parsed.transactions.length, 3)
  assert.deepEqual(parsed.parseErrors, [])
  assert.deepEqual(totals(parsed.transactions), { income: 293000, expense: 0 })
})
test("PDF missing or multiple references and missing time require review; summary is never imported", () => {
  for (const mutate of [
    (pages) => { pages[0].find((line) => line.some((item) => item.text.includes("000000001201")))[0].text = "UPI Ref No: missing" },
    (pages) => { pages[0].find((line) => line.some((item) => item.text.includes("000000001201")))[0].text += " UPI Ref No: 000000009999" },
    (pages) => { pages[0].find((line) => line.some((item) => item.text === "7:09 PM"))[0].text = "" },
    (pages) => { pages[0].find((line) => line.some((item) => item.text === "09 Aug"))[0].text = "Unreadable date" },
  ]) {
    const pages = structuredClone(paytmPdfPages); mutate(pages)
    const result = parseFixturePdf(pages)
    assert.equal(result.transactions.length, 2); assert.equal(result.parseErrors.length, 1)
    assert.doesNotMatch(result.parseErrors[0], /000000001201|Sample Payer/)
  }
})
test("fictional signed debits, precise paise, midnight and optional metadata preserve semantics", () => {
  const sheets = structuredClone(paytmSheets), row = sheets[1].data[1]
  Object.assign(row, { 0: "01/01/2025", 1: "00:00:01", 2: "Paid to Fictional Shop", 5: "-1,234.56", 7: "ORDER-1234", 8: "Reviewed", 9: "Shopping", 10: "Optional source comment" })
  sheets[1].data.push([], ["Grand Total", "", "", "", "", "+2,930.00"])
  const result = parsePaytmWorkbookRows(sheets), saved = result.transactions[0]
  assert.equal(saved.amountPaise, 123456); assert.equal(saved.type, "expense"); assert.equal(saved.person, "Fictional Shop")
  assert.equal(saved.datetime, "2024-12-31T18:30:01.000Z")
  assert.equal(saved.sourceDetails.comment, "Optional source comment"); assert.equal(saved.transactionId, "ORDER-1234")
  assert.equal(result.transactions.length, 3); assert.deepEqual(result.parseErrors, [])
  assert.deepEqual(parsePaytmAmount("+ Rs.0.01"), { amountPaise: 1, type: "income" })
  for (const amount of ["-0", "+1.234", "+1,23", "+Infinity", "+900719925474099.99"]) assert.throws(() => parsePaytmAmount(amount))
})
test("malformed spreadsheet rows produce sanitized diagnostics while retaining valid rows", () => {
  for (const updates of [{ 0: "08/09/24" }, { 0: "31/02/2024" }, { 1: "25:00" }, { 5: "-60.00" }, { 6: "" }, { 6: "private-not-a-reference" }, { 4: "x".repeat(10001) }]) {
    const sheets = structuredClone(paytmSheets); Object.assign(sheets[1].data[1], updates)
    const result = parsePaytmWorkbookRows(sheets)
    assert.equal(result.transactions.length, 2); assert.equal(result.parseErrors.length, 1)
    assert.doesNotMatch(result.parseErrors[0], /Sample|private-not/)
  }
  const sheets = structuredClone(paytmSheets); sheets[1].data[1][2] = "Refund from Sample Store"
  assert.match(parsePaytmWorkbookRows(sheets).warnings[0], /refund or self-transfer/)
})
test("missing history or unsupported columns fail clearly; Summary never becomes payments", async () => {
  await assert.rejects(() => parseStatementFile(workbookFile(workbookEntries(paytmSheets.slice(0, 1)))), /History worksheet/)
  const sheets = structuredClone(paytmSheets); sheets[1].data[0][6] = "Unknown"
  await assert.rejects(() => parseStatementFile(workbookFile(workbookEntries(sheets))), /eleven-column header/)
  await assert.rejects(() => parseStatementFile(new File(["bad archive"], "bad.xlsx")), /ZIP workbook/)
})
for (const [name, mutate, pattern] of [
  ["formulas with cached financial results", (e) => { e["xl/worksheets/sheet2.xml"] = e["xl/worksheets/sheet2.xml"].replace('<v>', '<f>1+1</f><v>') }, /Formula-backed/],
  ["macros", (e) => { e["xl/vbaProject.bin"] = "fake" }, /Macro/],
  ["embedded content", (e) => { e["xl/embeddings/object.bin"] = "fake" }, /embedded/],
  ["external workbook links", (e) => { e["xl/externalLinks/externalLink1.xml"] = "fake" }, /external workbook/],
  ["XML entities", (e) => { e["xl/sharedStrings.xml"] = '<!DOCTYPE x [<!ENTITY y "x">]>' + e["xl/sharedStrings.xml"] }, /entities/],
  ["excess worksheet dimension", (e) => { e["xl/worksheets/sheet2.xml"] = e["xl/worksheets/sheet2.xml"].replace('r="A1"', 'r="XFD1048576"') }, /dimension/],
  ["compression bombs", (e) => { e["xl/padding.xml"] = "a".repeat(1024 * 1024) }, /decompression/],
  ["too many entries", (e) => { for (let i = 0; i < 130; i++) e[`padding${i}`] = "x" }, /entry safety/],
]) test(`XLSX preflight rejects ${name}`, async () => {
  const entries = workbookEntries(); mutate(entries)
  await assert.rejects(() => parseStatementFile(workbookFile(entries)), pattern)
})
test("ordinary external hyperlinks are not opened and do not invalidate genuine exports", async () => {
  const entries = workbookEntries()
  entries["xl/worksheets/_rels/sheet1.xml.rels"] = '<Relationships><Relationship TargetMode="External" Target="https://example.invalid/never-fetch" Type="hyperlink"/></Relationships>'
  assert.equal((await parseStatementFile(workbookFile(entries))).transactions.length, 3)
})
test("archive integrity, forged expanded sizes, encryption and truncation are rejected", async () => {
  const original = new Uint8Array(await workbookFile().arrayBuffer())
  for (const mode of ["size", "crc", "encrypted", "truncated"]) {
    const bytes = original.slice(), view = new DataView(bytes.buffer)
    let central = 0
    while (view.getUint32(central, true) !== 0x02014b50) central++
    if (mode === "size") view.setUint32(central + 24, 1, true)
    if (mode === "crc") view.setUint32(central + 16, 0, true)
    if (mode === "encrypted") view.setUint16(central + 8, 1, true)
    assert.throws(() => validateWorkbookArchive(mode === "truncated" ? bytes.buffer.slice(0, -10) : bytes.buffer))
  }
})
test("repeated shared strings cannot amplify a tiny archive into an unbounded preview", async () => {
  const sheets = structuredClone(paytmSheets)
  // Unique, moderately compressible characters stay below the ZIP ratio limit;
  // all rows reuse one shared string, exceeding the resolved-text bound instead.
  const large = Array.from({ length: 9000 }, (_, i) => String.fromCharCode(33 + (i * 37 + Math.floor(i / 11)) % 90)).join("")
  sheets[1].data.push(...Array.from({ length: 1900 }, () => ["", "", "", "", "", "", "", "", large]))
  await assert.rejects(() => parseStatementFile(workbookFile(workbookEntries(sheets))), /resolved-text safety/)
})
