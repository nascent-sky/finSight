import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { parsePhonePeCsv, parsePhonePePdfLines, readCsvRows, isPhonePePdf } from "./phonePeStatementParser.js"
import { annotateImportDuplicates, getImportDocumentId, parseAmountPaise, parseStatementDatetime, STATEMENT_LIMITS } from "./statementImportModel.js"
import { loadStatementModule, textPdf } from "../../tests/helpers/statementHarness.mjs"

const csv = await readFile(new URL("../../tests/fixtures/phonepe/statement.csv", import.meta.url), "utf8")
const pages = JSON.parse(await readFile(new URL("../../tests/fixtures/phonepe/statement.pdf-lines.json", import.meta.url), "utf8"))
const canonical = ({ source, ...record }) => record
const { parseStatementFile } = await loadStatementModule("src/services/statementImportService.js")
const csvFile = (text, name = "statement.csv") => new File([text], name, { type: "text/csv" })

test("observed PhonePe CSV/PDF structures yield the same three one-rupee debit records", () => {
  const a = parsePhonePeCsv(csv), b = parsePhonePePdfLines(pages)
  assert.deepEqual(a.parseErrors, [])
  assert.deepEqual(b.parseErrors, [])
  assert.equal(a.transactions.length, 3)
  assert.equal(a.transactions.reduce((sum, row) => sum + row.amountPaise, 0), 300)
  assert.ok(a.transactions.every((row) => row.type === "expense"))
  assert.deepEqual(a.transactions.map(canonical), b.transactions.map(canonical))
  assert.equal(a.transactions[0].datetime, "2026-10-12T10:07:00.000Z")
})

test("actual PDF.js extraction, provider/format detection and normalized equivalence", async () => {
  const a = await parseStatementFile(csvFile(csv, "renamed.csv"))
  const b = await parseStatementFile(textPdf(pages))
  assert.equal(b.provider, "phonepe")
  assert.equal(b.format, "pdf")
  assert.deepEqual(b.parseErrors, [])
  assert.deepEqual(a.transactions.map(canonical), b.transactions.map(canonical))
  const bytes = await textPdf(pages).arrayBuffer()
  assert.equal((await parseStatementFile(new File([bytes], "no-extension", { type: "application/octet-stream" }))).provider, "phonepe")
})

test("references prevent duplicates across CSV/PDF/GPay without discarding distinct UTRs", () => {
  const a = parsePhonePeCsv(csv).transactions, b = parsePhonePePdfLines(pages).transactions
  assert.ok(annotateImportDuplicates(b, a).every((row) => row.duplicate))
  assert.ok(annotateImportDuplicates(a).every((row) => !row.duplicate))
  assert.equal(new Set(a.map(getImportDocumentId)).size, 3)
  const legacy = { ...canonical(a[0]), id: `gpay_${a[0].utr}`, source: undefined, utr: undefined, transactionId: undefined, upiTransactionId: undefined }
  assert.equal(annotateImportDuplicates([a[0]], [legacy])[0].duplicate, true)
  const gpay = { ...a[0], transactionId: undefined, utr: undefined, source: { provider: "gpay", format: "pdf" } }
  assert.equal(getImportDocumentId(gpay), getImportDocumentId(a[0]))
  assert.equal(annotateImportDuplicates([{ ...a[0], amount: 2 }], a)[0].conflict, true)
  assert.equal(annotateImportDuplicates([{ ...a[0], utr: "900000009999", upiTransactionId: "900000009999" }], a)[0].conflict, true)
  const conflict = annotateImportDuplicates([a[0], { ...a[0], amount: 2 }])
  assert.ok(conflict.every((row) => row.conflict && !row.duplicate))
})

test("CSV quoting, embedded commas/newlines, doubled quotes, BOM and all line endings", () => {
  const changed = csv.replace("Paid to Sample Merchant", '"Paid to Sample, ""Corner""\nStore"')
  for (const separator of ["\n", "\r\n", "\r"]) {
    const result = parsePhonePeCsv("\uFEFF" + changed.replaceAll("\n", separator))
    assert.deepEqual(result.parseErrors, [])
    assert.equal(result.transactions[0].person, 'Sample, "Corner" Store')
  }
  assert.deepEqual(readCsvRows('"a,b","c""d"\r\n"multi\nline",e'), [["a,b", 'c"d'], ["multi\nline", "e"]])
})

test("credits and exact paise use the same income semantics in both adapters", () => {
  const creditCsv = csv.replaceAll("Paid to", "Received from").replaceAll("DEBIT", "CREDIT").replaceAll(",1\n", ',"1,234.56"\n')
  const creditPages = pages.map((page) => page.map((line) => line.replaceAll("Paid to", "Received from").replaceAll("DEBIT", "CREDIT").replaceAll("₹1", "₹1,234.56")))
  const a = parsePhonePeCsv(creditCsv), b = parsePhonePePdfLines(creditPages)
  assert.ok(a.transactions.every((row) => row.type === "income" && row.amountPaise === 123456))
  assert.deepEqual(a.transactions.map(canonical), b.transactions.map(canonical))
  const mixed = parsePhonePeCsv(csv.replace("DEBIT", "CREDIT").replace("Paid to", "Received from"))
  assert.deepEqual(mixed.transactions.map((row) => row.type), ["income", "expense", "expense"])
})

test("strict money/calendar parsing preserves India dates around midnight", () => {
  for (const [amount, expected] of [["0.01", 1], ["Rs. 1,23,456.78", 12345678], ["INR 1,234.5", 123450]]) assert.equal(parseAmountPaise(amount), expected)
  for (const value of ["0", "-1", "NaN", "1.001", "1,2", "1e3", "1 trailing", "9007199254740991", "90071992547409.91"]) assert.throws(() => parseAmountPaise(value))
  assert.equal(parseStatementDatetime("01/10/2026", "12:01 AM"), "2026-09-30T18:31:00.000Z")
  assert.equal(parseStatementDatetime("2026-10-01", "23:59:01"), "2026-10-01T18:29:01.000Z")
  for (const [date, time] of [["31/09/2026", "10:00"], ["29/02/2025", "10:00"], ["01/01/2026", "13:00 pm"], ["01/01/2026", "00:00 am"], ["01/01/2026", "24:00"]]) assert.throws(() => parseStatementDatetime(date, time))
  assert.throws(() => parseStatementDatetime("Octember 01, 2026", "10:00"))
})

test("transaction and PDF page safety limits stop processing before import", async () => {
  const repeated = csv.split("\n").slice(0, 4).join("\n") + "\n" + (csv.split("\n")[4] + "\n").repeat(STATEMENT_LIMITS.rows + 1)
  assert.throws(() => parsePhonePeCsv(repeated), /10,000/)
  const reader = await loadStatementModule("src/services/pdfStatementReader.js", [{ name: "page-limit-reader", setup(builder) {
    builder.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: "pages", namespace: "fake-pages" }))
    builder.onLoad({ filter: /.*/, namespace: "fake-pages" }, () => ({ contents: 'export const GlobalWorkerOptions = {}; export const getDocument = () => ({ promise: Promise.resolve({ numPages: 201, getPage() { throw new Error("must not extract") } }), destroy: async () => {} })' }))
  } }])
  await assert.rejects(() => reader.readPdfStatementPages(textPdf(pages)), /200 page/)
})

test("malformed rows are excluded with safe row-specific errors; footers cannot hide later records", () => {
  const result = parsePhonePeCsv(csv.replace(",DEBIT,", ",UNKNOWN,").replace("900000001002,DEBIT,Paid by SAMPLE0000,1", "900000001002,DEBIT,Paid by SAMPLE0000,1.001"))
  assert.equal(result.transactions.length, 1)
  assert.equal(result.parseErrors.length, 2)
  assert.match(result.parseErrors[0], /CSV row 5.*DEBIT or CREDIT/)
  assert.ok(result.parseErrors.every((error) => !/Sample Merchant|900000|T2026/.test(error)))
  const extra = csv + '"Oct 13, 2026",10:00,Paid to Extra,T202610130004,900000001004,DEBIT,Paid by SAMPLE0000,2\n'
  assert.equal(parsePhonePeCsv(extra).transactions.length, 4)
  for (const text of ["", "Name,Amount\nPhonePe,1", '"unterminated', 'a,"b"junk']) assert.throws(() => parsePhonePeCsv(text))
  assert.throws(() => parsePhonePeCsv("x".repeat(STATEMENT_LIMITS.bytes + 1)), /10 MB/)
  assert.throws(() => readCsvRows("x\n".repeat(STATEMENT_LIMITS.csvRows + 1)), /row safety/)
  assert.throws(() => readCsvRows('"' + "x".repeat(STATEMENT_LIMITS.field + 1)), /too long/)
})

test("wrapped payees and records continued on a new PDF page stay in their block", async () => {
  const first = pages[0].slice(0, 5)
  first[3] = first[3].replace("Sample Merchant", "Sample")
  first.splice(4, 0, "Merchant")
  const next = ["Transaction Statement for Synthetic Account", "Date Transaction Details Type Amount", ...pages[0].slice(5)]
  const multi = [first, next]
  const parsed = parsePhonePePdfLines(multi)
  assert.deepEqual(parsed.parseErrors, [])
  assert.deepEqual(parsed.transactions.map(canonical), parsePhonePeCsv(csv).transactions.map(canonical))
  assert.deepEqual((await parseStatementFile(textPdf(multi))).transactions.map(canonical), parsed.transactions.map(canonical))
})

test("ambiguous/incomplete PDF records are excluded and flagged", () => {
  for (const mutate of [
    (line) => line.replace("03:37 pm", "unreadable time"),
    (line) => line.replace("UTR No. 900000001001", "UTR No. ???"),
    (line) => line.replace("DEBIT ₹1", "DEBIT CREDIT ₹1 ₹2"),
    (line) => line.replace("₹1", "₹1.001"),
    (line) => line.replace("₹1", "₹-1"),
    (line) => line.replace("₹1", "₹1e3"),
  ]) {
    const result = parsePhonePePdfLines(pages.map((page) => page.map(mutate)))
    assert.ok(result.parseErrors.length || result.warnings.length)
  }
  assert.equal(isPhonePePdf([["PhonePe", "Paid to Random ₹1"]]), false)
  assert.throws(() => parsePhonePePdfLines([["Date Transaction Details Type Amount"]]), /recognizable/)
})

test("unsupported, corrupt, empty, oversized, image-only and encrypted inputs fail safely", async () => {
  await assert.rejects(() => parseStatementFile(csvFile("")), /non-empty/)
  await assert.rejects(() => parseStatementFile(new File(["not a PDF"], "phonepe.pdf")), /valid PDF/)
  await assert.rejects(() => parseStatementFile(new File(["PK binary"], "paytm.xlsx")), /Supported statements/)
  await assert.rejects(() => parseStatementFile(new File([new Uint8Array([255, 254])], "test.csv")), /UTF-8/)
  await assert.rejects(() => parseStatementFile({ size: STATEMENT_LIMITS.bytes + 1, arrayBuffer() {} }), /10 MB/)
  await assert.rejects(() => parseStatementFile(new File(["%PDF-broken"], "test.pdf")), /could not be read/)
  await assert.rejects(() => parseStatementFile(textPdf([[]])), /no readable text/)
  await assert.rejects(() => parseStatementFile(textPdf([["Unsupported statement"]])), /not a supported/)
  const fake = await loadStatementModule("src/services/pdfStatementReader.js", [{ name: "encrypted-reader", setup(builder) {
    builder.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: "encrypted", namespace: "fake-pdf" }))
    builder.onLoad({ filter: /.*/, namespace: "fake-pdf" }, () => ({ contents: 'export const GlobalWorkerOptions = {}; export const getDocument = () => ({ promise: Promise.reject(Object.assign(new Error("locked"), { name: "PasswordException" })), destroy: async () => {} })' }))
  } }])
  await assert.rejects(() => fake.readPdfStatementPages(textPdf(pages)), /password-protected/)
})

test("existing GPay parser retains debit, credit and UPI Lite exclusion behavior", async () => {
  const { parseGooglePayStatementLines, parseGooglePayStatement } = await loadStatementModule("src/services/gpayStatementParser.js")
  const lines = ["Google Pay transaction statement", "12 Oct, 2026", "3:37 pm", "Paid to Sample Merchant ₹1", "UPI Transaction ID: 900000001001", "13 Oct, 2026", "11:00 am", "Received from Sample Payer ₹20.50", "UPI Transaction ID: 900000001010", "14 Oct, 2026", "10:00 am", "Top-up to UPI Lite ₹100"]
  const parsed = parseGooglePayStatementLines(lines)
  assert.equal(parsed.excludedTopUps, 1)
  assert.deepEqual(parsed.transactions.map((row) => [row.type, row.amount]), [["expense", 1], ["income", 20.5]])
  assert.deepEqual(await parseGooglePayStatement(textPdf([lines])), parsed)
  const unified = await parseStatementFile(textPdf([lines]))
  assert.equal(unified.provider, "gpay")
  assert.equal(getImportDocumentId(unified.transactions[0]), getImportDocumentId(parsePhonePeCsv(csv).transactions[0]))
})
