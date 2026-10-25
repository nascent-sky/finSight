# FinSight Phase 22.1 - PhonePe import and seven-field persistence compatibility

## Confirmed regression and minimal fix

The known-working baseline is local Git tag `v3.2.0`, commit
`49326787f4d7b29e00c388782420db95d7a43bfd`. It was read for comparison and
isolated tests; no checkout, reset or project-wide revert was performed.

The original `normalizeTransaction()` returned exactly seven fields. Phase 22.1
incorrectly added `amountPaise`, `source`, `transactionId`, `utr`,
`upiTransactionId`, `paymentInstrument` and `importIdentityKeys` to the object
written by the shared create-if-missing helper. The supplied production rules
reject each of those extra fields through `keys().hasOnly(...)`.

This is reproduced with the real client SDK and the unchanged rules in an
isolated Firestore Emulator: owner-scoped reads and the metadata query succeed,
but committing the expanded transaction payload returns `permission-denied`.
The v3.2.0 GPay implementation succeeds against those same rules. Transaction
reads were already supported and were not the regression.

The fix restores `normalizeTransaction()` to the original seven-field cloud
contract and projects through it at the shared transaction write boundary.
A separate local normalizer retains source metadata in preview, guest storage
and the existing offline queue. It does not introduce a new database or cloud
collection. Signed-in imports, guest merges and queued synchronization all use
the corrected shared helper.

| Operation | v3.2.0 | Broken Phase 22.1 | Corrected implementation |
| --- | --- | --- | --- |
| Cloud transaction payload | Seven fields | Seven fields plus import metadata | Original seven fields |
| Create-if-missing | Transaction reads target ID, then creates | Reads IDs plus server metadata query, then creates expanded payload | Transaction reads deterministic owner-scoped IDs, then creates seven fields |
| UPI document identity | `gpay_<reference>` | `upi_<reference>` plus app-ID fallback | Same global UPI identity; recognizes legacy GPay IDs |
| Reference-metadata query | None | `array-contains-any` on `importIdentityKeys` | Removed; metadata is not a cloud field |
| Authentication | Current signed-in owner | Added expected-account guards | Guards retained; configuration unchanged |
| Legacy expenses | Ownership-filtered `/expenses` query | Unchanged | Unchanged |
| Collection-group query in import/merge | None | None | None |

## Rules and legacy-query findings

`tests/fixtures/firestore/production.rules` is an unchanged local copy of the
rules pasted by the user from Firebase Console. It is not configured for
production deployment and no deployed rule was edited.

The exact rules allow transaction reads for the owner, including a missing
transaction document. Therefore canonical/legacy ID lookups inside
`users/{uid}/transactions` are allowed. The old metadata query is also allowed
under that owner path; it was unnecessary rather than the demonstrated denial.

The actual legacy merge query includes `where("userId", "==", currentUser.uid)`
and succeeds under the supplied `/expenses` ownership rules. Unfiltered legacy
collection queries, reads of nonexistent legacy documents and unconstrained
transaction collection-group queries are denied in negative emulator tests.
Those denied forms are not used by the current import/shared merge helper.
The existing login sequence, legacy merge followed by canonical transaction
merge, succeeds with synthetic guest records under these same rules. Its order
and legacy-storage implementation were not changed.

## Canonical transaction and duplicate identity

Cloud documents remain at `users/{uid}/transactions/{id}` and contain only:

- `amount`: positive rupee number.
- `datetime`: ISO timestamp string.
- `type`: `expense` or `income`.
- `person`: string.
- `paymentMethod`: `cash` or `upi`.
- `category`: string, retaining the current category selection.
- `note`: the original note string, without hidden import metadata.

UPI/UTR references remain durable in deterministic `upi_<reference>` document
IDs, shared across payment apps and statement formats. The helper also reads
`gpay_<reference>` legacy IDs and provider-scoped app-ID fallback documents in
the same owner collection before creating. The reads and write remain inside
a Firestore transaction. Existing financial records are never rewritten by
reimport, and equal amounts/dates alone never discard distinct references.

Cloud snapshots with only seven fields are recognized by document ID, so a
fresh preview on another device does not require source-metadata fields for
UTR-based duplicate detection. Old guest and queued GPay records can contain
only seven fields plus a `gpay_...` ID. The helper now derives identity from that
ID as well, preventing their merge/sync from duplicating a newer PhonePe record.

Full source metadata, app transaction IDs and instruments remain available in
preview, guest storage and pending records. They are not replicated as extra
Firestore transaction fields. A missing UTR cannot prove a cross-app identity;
app-ID-only records retain their explicit review warning. No amount/date
heuristic, extra financial document, metadata collection or rule relaxation is
used to manufacture cross-app identity when a common reference is unavailable.

## Preserved Phase 22.1 behavior

PhonePe UTF-8 CSV and text-based PDF adapters remain unchanged. Both supplied
samples were previously verified in place as three debit records of 100 paise,
totaling 300 paise, with matching normalized fields except source format.
Original statements and identifiers were not copied into fixtures.

CSV retains its observed eight-column header/preamble/footer handling, quoted
fields, escaped quotes and embedded commas/newlines. PDF retains positioned
PDF.js extraction, wrapped details, page continuations and disclaimer filtering.
CREDIT maps to income and DEBIT to expense. Money is validated in integer paise
locally and represented in the existing rupee `amount` field for cloud storage.
India-local dates/times are validated and serialized as UTC ISO timestamps.

Preview editing, record selection, categories, sanitized Code/Stage diagnostics,
failed-record retry, separate queued-save counts and pending-sync retry remain.
Guest imports reuse local storage; signed-in offline imports reuse the pending
IndexedDB queue. Sync uses the same corrected seven-field cloud write helper.
PhonePe parsing, GPay parsing, analytics/AI, Android share metadata and file
handoff behavior were not rewritten for this compatibility fix.

Safety limits remain 10 MiB per file, 10,000 transactions, 12,000 CSV records,
200 PDF pages, 100,000 extracted lines and 10,000 characters per field/line.
Encrypted, corrupt, scanned/image-only and unsupported documents fail locally.
The existing PWA precache includes PDF.js, its worker and provider parser chunks.

## Files changed for the rules compatibility fix

| File | Purpose |
| --- | --- |
| `src/services/transactionService.js` | Restore seven-field cloud normalizer; keep metadata local; correct shared create-if-missing, merge/sync and ID-only legacy identity handling; remove server metadata query. |
| `src/services/statementImportModel.js` | Recognize provider-scoped fallback identity from a seven-field cloud document's ID. |
| `src/services/statementPersistence.test.mjs` | Assert seven-field cloud payloads and local metadata retention; verify the removed server query is unnecessary. |
| `tests/fixtures/firestore/production.rules` | Unchanged copy of the supplied production rules, used only for local tests. |
| `tests/firestore/statementRules.test.mjs` | Real SDK/rules regression tests comparing v3.2.0 and the corrected implementation. |
| `tests/firestore/run.mjs` | Run a localhost-only synthetic-project rules emulator, then stop it. |
| `tests/firestore/README.md` | Reproduction instructions and official emulator checksum/source. |
| `package.json` | Add the explicit `test:firestore` command. |
| `.gitignore` | Exclude the downloaded emulator binary. |
| `PHASE22-1.md` | Current findings, fix, tests and limitations. |

## Verification

- `npm test`: 337 passed, 0 failed.
- `npm run test:firestore`: 20 passed, 0 failed, with the exact supplied rules.
- `npm run lint`: passed.
- `npm run build`: passed, including PWA generation with 14 precache entries.
  Existing large-chunk and stale Browserslist advisories remain.
- `git diff --check`: passed.

The rules tests compare the v3.2.0 service read through `git show` with the
current service using the real client SDK and synthetic authenticated users.
They reproduce rejection of the pre-fix expanded payload, including rejection
of each added field individually, and success of the baseline/current GPay and
PhonePe save paths. They verify CSV then PDF and PDF then CSV reimports yield
0 new records and 3 duplicates, as well as cross-provider identity, distinct
UTRs, conflict protection, guest merging, old ID-only guest/queue records,
offline sync, legacy ownership-filtered queries and non-owner denial.

The emulator is a temporary localhost-only process for `demo-finsight-rules`.
It uses no production authentication, live data or Admin SDK bypass. The runner
terminates its own emulator after testing. No application, hosting server,
Netlify Dev, browser preview or Android emulator was started. No Firebase
configuration or production rules were changed. No deployment, commit, push,
transaction migration or alteration of existing production data was performed.

## Remaining limits

Manual verification of the updated production build and physical Android/PWA
behavior remains with the user. Emulator verification establishes compatibility
with the supplied rules, not a deployment result. Other PhonePe layouts,
scanned PDFs and alternate CSV encodings remain unsupported. Additional source
metadata is deliberately local to preserve the existing cloud schema; the
shared bank reference in the document ID is the cross-device import identity.
Paytm PDF/XLSX adapters and unified native file opening remain later phases.
