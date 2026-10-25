# FinSight Phase 22.2 — Paytm statement import

Historical Phase 22.2 report. Phase 22.3 removes the optional timestamp refinement
described below and completes the Android handoff. See [PHASE22-3.md](PHASE22-3.md)
for current behavior, verification results and rebuild instructions.

Paytm PDF and XLSX now use the existing unified preview, canonical UPI IDs,
guest records, authenticated transaction service and offline queue. The seven-field
Firestore normalizer and production-equivalent rules are preserved. No Firebase
configuration, production rules, Android files or production data were changed.

## Supported source structures and actual sample verification

The two original `Paytm_UPI_Statement_01_Apr'24_-_31_Mar'25` files were read from
Downloads without copying them into this repository or saving their transactions.
The final application parser was executed against each original file locally.

| Actual source | Parsed records | Credits | Debits | Errors / warnings |
| --- | ---: | ---: | ---: | ---: |
| Text-based PDF, one page | 3 | ₹2,930.00 | ₹0.00 | 0 / 0 |
| XLSX workbook | 3 | ₹2,930.00 | ₹0.00 | 0 / 0 |

Both produce the expected ₹60, ₹1,500 and ₹1,370 income transactions. UPI
references, people, amounts, directions and minute-level timestamps agree across
the files. Personal names, references and account details are absent from the
fixtures and this report. A scan of changed/new files found no source identifiers;
no original PDF or XLSX has been added to Git.

The supported PDF has a `Paytm Statement` heading, one statement-period range,
and a `Passbook Payments History` table with date/time, transaction details,
comments/tags, own account and signed amount columns. PDF.js coordinates separate
wrapped payer names from bank/account text. Repeated table headers, page footers,
summary credits/debits and bank totals do not create transactions. Text records
can continue across pages. Incomplete dates, times, amounts or references produce
sanitized row diagnostics instead of guessed financial records.

The workbook must contain one `Passbook Payment History` (or plural `Payments`)
sheet with the observed eleven columns: Date, Time, Transaction Details, Other
Transaction Details (UPI ID or A/c No), Your Account, Amount, UPI Ref No., Order ID,
Remarks, Tags and Comment. Only this history sheet creates transactions. Summary,
blank rows, repeated headers and labeled balance/total footers are excluded.
Dates use DD/MM/YYYY and the supplied time column preserves seconds. Numeric cells
are read as decimal strings; UPI references remain strings, including leading zeros.

`read-excel-file` 9.3.12 (`/universal`) and `fflate` 0.8.3 are pinned in the lockfile.
The workbook reader is loaded on demand and works locally without uploading the
workbook. Package documentation: [read-excel-file](https://github.com/catamphetamine/read-excel-file#readme).

## Date precision, identity and review

- Missing PDF years are resolved uniquely inside the declared statement period.
  April–December resolve to 2024 and January–March to 2025 for these samples.
  Leap days, dates outside the period, conflicting periods and multiple possible
  years are validated; the current year is never substituted.
- India-local dates/times are converted to UTC ISO strings using +05:30. Money is
  parsed in exact integer paise before the existing positive rupee amount is saved.
  Incoming amounts map to income, outgoing amounts to expense, payment method to
  UPI and initial category to Other. Description/sign contradictions require review.
  Refund/self-transfer and unfamiliar descriptions receive classification warnings.
- The authoritative UPI reference uses the existing `upi_<reference>` document ID.
  Existing `gpay_<reference>` and provider-scoped aliases are checked as before.
  Distinct references remain distinct even with identical dates, people and amounts.
- Importing PDF then Excel, or Excel then PDF, creates three records followed by
  zero new records and three duplicates. Missing seconds do not change identity.
  Paytm amount, direction, date, minute, person or contradictory precise-second
  values require review when associated with the same reference. Person comparison
  ignores case and repeated whitespace. Existing GPay/PhonePe conflict semantics
  remain in place when neither side identifies itself as Paytm.
- As requested, Excel following a saved minute-only time offers an explicit
  **Use Excel time** action. It displays both India-local times and changes only
  datetime after approval. Ordinary reimport never silently changes saved time.
  PDF following Excel keeps the existing seconds.
- Because the cloud schema has no precision/source field, a matching zero-second
  cloud time is a review candidate, rather than proof of PDF origin. Nonzero saved
  seconds are never automatically replaced. The transaction checks the reviewed
  previous time again, preserves all six other fields and refuses to recreate a
  deleted target or overwrite a concurrent time change.

## Persistence and unchanged Firestore compatibility

New Paytm imports call `saveImportedTransactionWithId()` and the same shared
read-before-create Firestore transaction used by GPay, PhonePe, queue sync and guest
merges. Reads stay under `users/{uid}/transactions/{id}`; no legacy-expenses or
collection-group lookup has been introduced.

Every cloud create/update still projects through `normalizeTransaction()`:
`amount`, `datetime`, `type`, `person`, `paymentMethod`, `category`, `note` only.
Source details, account descriptions, order IDs, precision and reviewed correction
intent remain local in the preview, guest storage or existing IndexedDB queue.
They are not added to Firestore documents. The UPI reference is retained in the
document ID. Source metadata is consequently unavailable after a cloud-only reload;
users can copy a desired source remark into the editable Note before import.

An approved offline time update amends an existing pending create, or queues a
guarded correction for an existing cloud record. It does not queue a second
financial record. Retry after a lost acknowledgement checks the same ID. Failed
sync keeps queue data and sanitized Code/Stage diagnostics. Normal transaction
editing/deletion also handles queued corrections without dropping user edits or
resurrecting deleted transactions.

## Workbook safety limits

Existing limits remain: 10 MiB input, 10,000 transactions, 12,000 worksheet rows,
200 PDF pages, 100,000 PDF text lines and 10,000 characters per field.
Workbook preflight additionally enforces 128 archive entries, 8 MiB per entry,
32 MiB total decompressed output, compression ratio at most 200, at most 32
columns and 150,000 cells. Resolved shared-string text is capped at 16 Mi characters
so repeated references cannot amplify a small archive into an unbounded preview.

Central-directory checks precede decompression. Streaming output lengths and CRCs
are checked against declared entries. Invalid/truncated ZIPs, encryption, ZIP64,
unsafe/duplicate paths, XML entities, macros, embedded objects and external workbook
links are rejected. Formula-bearing worksheets, including cached formula values,
require a values-only export. Ordinary external hyperlinks present in the actual
export are allowed as inert metadata; no links are followed or content executed.

## Verification results

| Check | Result |
| --- | --- |
| `npm test` | **374 passed**, 0 failed (337 existing + 37 new) |
| `npm run test:firestore` | **28 passed**, 0 failed (20 existing + 8 new) |
| `npm run lint` | Passed |
| `npm run build` | Passed; production bundle and PWA service worker generated |
| Actual original samples | Both 3 credits / 293,000 paise, no errors or warnings |

The emulator uses only localhost and `demo-finsight-rules`, with the unchanged
`tests/fixtures/firestore/production.rules`. New coverage exercises both Paytm
import orders, strict seven-field documents, approved time refinement, guest merge,
offline queue/sync, cross-provider legacy IDs, distinct references, conflicts and
normal CRUD with a queued time correction. Transport regression tests additionally
cover partial permission failures, interrupted commits, repeat retries, deleted or
changed refinement targets and local metadata retention. Actual PDF.js and the real
XLSX package are used with generated fictional fixtures. Existing GPay, PhonePe,
authentication, permission-denied diagnostics and encrypted/scanned PDF tests pass.

The XLSX reader chunk is approximately 54.4 kB (17.7 kB gzip) and is included in
the generated PWA precache, together with the PDF reader/worker. The build reports
the existing large-main-chunk and outdated Browserslist-data warnings; neither
prevents the build. No application server, browser preview or production connection
was used for these checks. Nothing was committed, pushed or deployed.

## Exact files changed

| File | Change |
| --- | --- |
| `package.json`, `package-lock.json` | Pinned local workbook/ZIP dependencies |
| `src/services/paytmStatementParser.js` | New PDF/XLSX normalization, period and column parsing |
| `src/services/xlsxStatementReader.js` | New guarded local OOXML reader |
| `src/services/pdfStatementReader.js` | Optional positioned lines; existing string API preserved |
| `src/services/statementImportService.js` | Content detection and Paytm dispatch |
| `src/services/statementImportModel.js` | XLSX acceptance, Paytm conflicts and time review eligibility |
| `src/services/transactionService.js` | Local metadata and guarded approved time corrections through existing persistence |
| `src/pages/TransactionImport.jsx` | Paytm/XLSX labels, source details and explicit time review |
| `src/services/paytmStatementParser.test.mjs` | New parser, equivalence, dates and workbook safety coverage |
| `src/services/statementPersistence.test.mjs` | Paytm guest/account/offline/retry/time-update regressions |
| `src/services/statementImportUI.test.mjs` | Paytm upload/editing, reviewed time action and failure UI |
| `src/services/statementImport.test.mjs` | XLSX now recognized; invalid XLSX and legacy XLS expectations |
| `tests/helpers/paytmFixtures.mjs` | Fictional layouts and in-memory OOXML fixtures |
| `tests/helpers/statementHarness.mjs` | Positioned in-memory PDF test fixture support |
| `tests/firestore/statementRules.test.mjs` | Paytm real-client-SDK emulator regressions |
| `PHASE22-2.md` | This implementation and verification report |

## Remaining limits and manual verification

Only the observed Paytm history layouts and compatible variations are supported;
other Paytm wallet/bank formats, legacy XLS, encrypted/formula workbooks and scanned
or password-protected PDFs need a supported text/values-only export. Ambiguous
records remain reported for review instead of being guessed. A cold offline device
needs one successful online app load to install/cache the updated parser assets.

Android's current SEND/SEND_MULTIPLE filters, TWA share configuration and PWA share
handler accept PDF/CSV. They were inspected and left unchanged. For Phase 22.3,
XLSX sharing needs the narrow MIME type
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `.xlsx`
acceptance across those existing handoff components. XLSX file selection on the
current import page is supported now; native XLSX open/share is deferred.

Suggested manual checks in an explicitly chosen test account or guest session:

1. Select each original Paytm file and check three credits totaling ₹2,930 with
   zero debits. Review the source details, classification, categories and time.
2. Import PDF, then select Excel: expect zero new and three already imported.
   Verify the saved minute and Excel seconds; approve **Use Excel time** for a row
   and confirm that row keeps its ID, amount, category and note.
3. In a separate empty guest session/test account, import Excel first, then PDF:
   expect zero new and three duplicates; seconds must remain unchanged.
4. Test a guest import followed by Merge Data, and an offline signed-in import
   followed by Retry pending sync. Confirm three seven-field owner documents and
   cross-device synchronization. Repeat the import/sync to confirm no new records.
5. Smoke-test one GPay PDF and PhonePe PDF/CSV reimport, plus ordinary transaction
   editing/deletion. Report any failure using only its sanitized Code and Stage.

These live manual checks have not been performed by the agent; production records
were not imported, deleted or changed.
