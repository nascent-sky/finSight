# Concise, intent-aware financial responses

The record-evidence pruning described below was subsequently corrected to retain
explicit counts, scope and actual bounded rankings. See
[Narrative consistency](NARRATIVE_CONSISTENCY.md) for the confirmed issue, typed
evidence checks and verified recovery behavior.

## Root cause

The final composer appended every default backend block and then every valid
model-suggested block. It deduplicated complete JSON objects, not their financial
meaning. A recommendation containing a savings estimate and a separate savings
card were different objects, so both appeared. Broad catalogs also allowed a
largest-expense request to select totals and categories unrelated to its requested
ranked list. Record lists were appended in a separate final step, independently
of narrative lists. Generic recommendation defaults applied the same ten-percent
cut to the largest categories, including categories that might be essential.

The renderer reset numbering for each consecutive recommendation group and used
a full savings card inside each recommendation. The shared INR formatter omitted
trailing paise zeros, so text and cards could show `₹90.3` instead of `₹90.30`.

## Composition policy

`lib/responseComposition.js` projects the existing verified analyses into a
cloud-specific, read-only presentation catalog. The validated plan's intent,
task, period, category and payment filter determine the available resources.
There are no new keyword-routing rules or model-output fields.

| Request | Primary presentation |
| --- | --- |
| Spending overview | Brief narrative, one category breakdown, relevant actions |
| Biggest / individual expenses | Brief introduction, one authoritative record list, compact scope total and any omission notice; no automatic category report |
| Direct total | Concise explanation, one matching financial metric |
| Income versus expenses | Distinct income, expense and net metrics |
| Period comparison | Chronological comparison card with matching comparison facts |
| General reductions | Up to three conditional recommendations, compact relevant estimates, at most one combined summary per distinct scenario scope |
| Explicit percentage reduction | The exact requested backend-calculated scenario, including a labelled zero estimate when the selected scope is empty |
| GPay import | One verified numbered guide and the implemented Import GPay navigation action |

Deduplication uses scope and financial role. Equal amounts for different
categories, periods or payment methods remain distinct. Comparison aliases are
shown once. A breakdown already contains its scope total, and a category
comparison can replace the separate totals it explicitly covers. An estimate
inside a recommendation is not shown again as a standalone card. Model references
outside the relevant prepared catalog are discarded without a repair request.

Record detail has one presentation owner. The final explanation context omits
individual transaction facts/details for list requests; FinSight supplies the
verified rows. The composer additionally removes exact structured narrative rows
already represented by owned records or guide steps. It does not remove words by
keyword, infer the meaning of arbitrary sentences, or discard distinct advice.
Reduction follow-ups retain their financial scope but do not re-append a previous
ranked list; recommendations about largest expenses use those selected records.
Record blocks enter the final presentation once, within the existing shared list
and response-size limits. Related actions precede long record lists.

Gemini is asked for one or two useful sentences rather than another report.
Comparison prompts expose chronological comparison facts and relevant driver
facts, rather than contradictory query-oriented change percentages. General
advice prompts omit the old generic ten/twenty-percent scenario facts. The complete
authoritative backend fact map and its financial-validation rules remain intact.
No extra model call is made for formatting.

## Conditional recommendations

Cloud recommendations prioritize recorded Shopping and Entertainment purchases
as candidates for **review**, without declaring that those costs are unnecessary.
The record count and date come from actual records in the authenticated query
scope. An illustrative estimate uses the exact amount of one recorded purchase
as the basis for deferring a similar purchase **only if it is optional**. It is
not a recurring-purchase prediction or a claim that every purchase can be cut.

Healthcare, Education, essential Food and Transport do not receive automatic
category cuts. If no review candidate exists, the response offers conditional
guidance without inventing savings. Explicit user-requested percentage scenarios
retain their original verified arithmetic and rate. Target scenarios remain
labelled illustrative, with flexibility unconfirmed.

A combined general-advice estimate is calculated only from disjoint category
scenarios in the same scope. Its integer-paise basis, saving and remaining amount
reconcile exactly. Partial-period labels remain visible. Neither individual nor
combined estimates represent achieved savings or guaranteed monthly forecasts.

## Existing renderer and formatting

The existing components, themes, colors and public version-1 response contract
remain. Embedded savings use a compact inline treatment with verified basis and
remaining amounts, rather than another large nested card. Standalone scenario
and combined-summary cards remain available. Recommendation numbering continues
across separate groups with native `ol` start values and visible sequential
numbers. Wrapping, touch targets, single-column mobile rules and semantic labels
are retained.

The existing shared `formatExpenseAmount` now uses Indian digit grouping and two
fractional digits when paise are present: `₹90.30`, `₹812.70`, and `₹2,000`.
Amounts remain exact integer paise in calculations; this changes formatting only.

## Files changed in this request

| File | Change |
| --- | --- |
| `lib/responseComposition.js` | Intent-specific cloud catalogs, conditional evidence-based recommendations, semantic deduplication and narrative ownership |
| `lib/developmentResponse.js` | Use prepared policy, compose owned records once and remove exact structured overlap after financial validation |
| `lib/developmentConversation.js` | Prepare relevant resources and concise explanation context; preserve existing tools, history, limits and returned verified lists |
| `lib/geminiFinance.js` | Four composition-only edits in the explanation adapter: import/use the prepared cloud layout, supply its presentation policy, and pass it to the composer |
| `../src/features/finance-ai/AssistantResponse.jsx` | Compact embedded estimates and continuing recommendation numbering |
| `../src/features/finance-ai/responseBlocks.css` | Wrapping inline estimate presentation using existing semantic theme colors |
| `../src/components/analytics/expenseChartUtils.js` | Central INR decimal display |
| `tests/responseComposition.test.mjs` | Seven deterministic relevance, numerical, scope, estimate, formatting and zero-scenario tests |
| `tests/narrativeLifecycle.test.mjs` | Four additional actual client/function/SDK/React-rendering regressions for duplicate records, reduction follow-ups, GPay steps and numbering |
| `tests/geminiConfiguration.test.mjs`, `tests/responseBlocks.test.mjs`, `tests/development.test.mjs`, `tests/recommendations.test.mjs` | Update relevant prepared-resource, chronological-fact and two-decimal currency expectations |
| This report and `../src/features/finance-ai/RICH_RESPONSES.md` | Current composition behavior and validation |

## Validation and preserved boundaries

All **256 automated tests**, ESLint and production/PWA build pass. Existing
bundle-size and outdated Browserslist warnings remain. Tests cover duplicate
financial blocks, repeated savings, distinct equal-value scopes, relevant intent
layouts, actual card values, partial periods, exact explicit scenarios, numbered
recommendations, INR formatting, responsive/contrast rules, existing contract
compatibility, protected/local behavior and guest/account isolation.

The SDK request implementation, model configuration, minimal final schema,
financial verification, Firebase/UID-scoped retrieval, authentication, consent,
data-handling policies and Gemini-first routing are unchanged. File hashes confirm
that the schema, privacy/retrieval helpers and local/demo engine files are
unchanged. Reversing only the four composition edits restores the adapter's exact
pre-task hash; no SDK request, parsing, thinking or retry code was changed.

Guest/local data selection, financial layouts, calculations and source labels
are unchanged. They share the renderer's numbering/compact styling and the INR
formatting improvement. No dependency or environment change is required. Tests
use mocked provider transport and isolated React/DOM rendering; no new live
Gemini call or visual browser verification is claimed. No app, Netlify Dev or
browser preview was started, and nothing was deployed.
