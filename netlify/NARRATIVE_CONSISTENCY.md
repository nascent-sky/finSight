# Narrative consistency with verified financial results

## Confirmed cause

The previous response-composition change removed every `q0_*` fact for a
record-list request, including `expense_count`, `transaction_count`, totals,
shown/omitted counts and period facts. `developmentConversation.js` also replaced
the selected transactions in the explanation prompt with `transactions: []`.
The original requested scope and `empty: false` remained, but there was no
explicit positive count or usable ranked result beside the empty array.

This was an explanation-evidence loss, not a failed authenticated retrieval: the
same backend execution still built the correct list, count and total for the UI.
Existing tests actually asserted the pruned prompt. The old narrative validator
checked JSON, placeholders, raw numbers and several unsupported claims, but did
not validate negative presence assertions such as “no recorded transactions.”
The reported number-free sentence therefore passed even against nonempty results.

The regression fixture recreates the reported thirteen expenses and ₹6,254
total, including the five ranked amounts, and proves the sentence is rejected.
No production database or provider conversation was inspected. These input and
validation defects are confirmed in source and serialized SDK requests; the
model's private reasoning about the previous empty array is not observable.

The period was retained in the old prompt. History did not overwrite backend
calculations: fresh authenticated records were indexed and queried before the
explanation. The new receipt makes that current authority explicit rather than
asking the model to infer it from missing fields or earlier conversation text.

## Evidence and checks

`narrativeConsistency.js` builds a typed receipt from canonical records and the
validated query. It includes exact current/prior scopes, relevant record counts,
expense/income totals in integer paise, category counts/totals, chronological
comparisons, and bounded ranked transactions with their financial role/order.
IDs, people, notes, credentials and tokens are excluded. Prompt category detail is
bounded without describing omitted categories as empty. Unknown data is kept
unknown rather than converted to zero.

The final prompt now contains the real bounded transaction selection, explicit
total/shown/omitted counts and `authoritativeEvidence`. Safe count, total, period
and complete `record_status` placeholders are retained. The working provider
output schema remains exactly `answer` with optional `blockIds`.

Targeted factual predicates are checked against the receipt before rendering:

- Absence/presence claims must agree with the relevant record, expense, income or
  category state. An unqualified absence cannot ignore a nonempty comparison
  period. Correct absence claims for genuinely empty scopes remain valid.
- Typed financial references cannot relabel income as expenses, move current
  counts/amounts into another verified period, or present a category/period total
  as an individual ranked transaction.
- Trend assertions use the chronological comparison frame. A category trend uses
  that category's own values, so it may legitimately differ from the overall
  trend. Correct two-period comparisons and qualitative conditional advice remain
  valid.
- Conditional purchase-deferral estimates cannot become guaranteed or recurring
  monthly savings claims.

These are bounded presence, scope, metric, role and direction checks, not a new
keyword intent router or an unrestricted natural-language theorem prover. The
existing strict numeric/date-placeholder and financial-claim validation remains
active. Complete verified statement placeholders are preferred for factual
summaries; distinct qualitative guidance is left intact. No change is made to
the financial engine or the arithmetic populating cards.

Safe failures use `GEMINI_NARRATIVE_CONTRADICTION` plus a specific rule and the
existing `validation` metadata (`financial_claim`, `answer`, stage and expected
category). Rejected prose, raw provider messages, records, keys and tokens are not
logged or echoed in repair feedback.

## Recovery and retry

1. Validate the final explanation against the current receipt.
2. On a contradiction, use at most one correction pass within the existing shared
   per-turn correction budget. Only fixed validation feedback is added; tool
   results, evidence, scope and history are identical. No records are re-retrieved
   during repair.
3. Revalidate the correction. If it succeeds, the result remains Gemini-generated.
4. If it fails, render a concise statement generated directly from the verified
   receipt and the same prepared financial blocks. This response has
   `source: local_verified`, a **Verified financial answer · Local explanation**
   label, and explicit narrative-recovery metadata. The rejected narrative is
   discarded entirely.

A spent planning/output correction budget prevents another correction. A provider
failure during the single attempted factual repair can still return these known
verified results. Provider/configuration/auth/privacy/tool errors without an
observed contradiction preserve their existing error behavior. Cancellation and
request deadlines remain authoritative; no recovery bypasses them. The existing
bounded transient-provider retry policy is unchanged.

The client accepts verified development recovery only with its explicit recovery
contract, confirmed fictional-data handling and the existing routing version.
Generic local answers still cannot masquerade as Gemini-generated development
answers. Paid and isolated synthetic explanations use the same consistency and
honest-source behavior behind their original data-handling gates.

The existing message footer supplies **Retry Gemini explanation** for the latest
recovered answer. A client-side request snapshot retains the original question,
history and scope from before that question. Retrying “What about last month?”
therefore does not step back another month, append a duplicate question, or use
the recovery as previous scope. New Chat clears the snapshot; account/logout
session boundaries continue to discard all prior data and in-flight work.

Cards, colors, comparisons, recommendation components, navigation, local analysis
and the automatic guest demo are preserved. No large warning panel or redesign
was added. Explanations remain concise; hypothetical estimates retain their
conditional, period-specific labels rather than recurring-savings promises.

## Changed files

| File | Purpose |
| --- | --- |
| `lib/narrativeConsistency.js` | Current typed receipt, verified statements and grounded factual checks |
| `lib/narrativeRecovery.js` | One-budget correction and explicitly labelled verified fallback |
| `lib/developmentConversation.js` | Preserve counts/rankings, supply current receipt, and recover from contradictory final explanations |
| `lib/responseComposition.js` | Retain essential presence/count facts while keeping response composition concise |
| `lib/developmentResponse.js`, `lib/modelValidation.js` | Apply consistency checks to minimal/legacy narrative shapes and expose precise safe rules |
| `lib/geminiFinance.js`, `lib/syntheticFinance.js` | Supply verified receipt/recovery to paid and fixed synthetic explanations; keep provider request implementation unchanged |
| `functions/finance-chat.mjs` | Pass the authenticated index, preserve recovery metadata and require explicit verified-recovery qualification |
| `../src/features/finance-ai/financeRouting.js` | Shared recovery/source qualification and honest source label |
| `../src/services/financeChatClient.js` | Accept only qualified verified recovery alongside the existing successful sources |
| `../src/pages/FinSightAI.jsx` | Reuse existing Retry styling and replay the original request/scope |
| `tests/narrativeConsistency.test.mjs` | Ten receipt, contradiction, recovery, budget and SDK lifecycle tests |
| `tests/narrativeLifecycle.test.mjs`, `tests/responseComposition.test.mjs` | Replace old assertions that required missing record evidence |
| `../src/features/finance-ai/accountDemoUI.test.mjs` | Actual React/DOM retry, relative-scope and logout regression |
| This report and `RESPONSE_COMPOSITION.md` | Confirmed findings and current behavior |

## Validation and limits

All **267 automated tests**, ESLint and production/PWA build pass. Tests include
the exact reported contradiction, nonempty/empty periods, missing categories,
ranked individual-versus-category facts, current/prior counts, reversed month
comparisons, legitimate category trends and advice, conditional savings, one
repair with identical evidence, exhausted repair, failed repair, shared budget,
paid explanations, source qualification and original-question UI retry.

The provider model/configuration, SDK generation/parsing/retry implementation,
minimal JSON schema, financial engine, UID-scoped retrieval and privacy gates
remain intact. No environment variables or dependencies are added. Tests use the
actual SDK with mocked HTTP transport and isolated React/DOM rendering; no live
Gemini call or browser visual verification is claimed. Targeted checks do not
prove every possible free-form semantic claim. Existing bundle-size and outdated
Browserslist warnings remain. No application, Netlify Dev or browser preview was
started, and nothing was deployed.
