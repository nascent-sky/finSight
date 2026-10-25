# Rich financial responses

The targeted largest-expense card and gradual Shopping defaults are described in
[Final response polish](../../../netlify/FINAL_RESPONSE_POLISH.md).

The transaction card now also handles ordinary lists through the same
`TransactionList` renderer and `transactionListBlock` projection. Both local
analysis and authenticated backend results use it. The existing `ranked_expenses`
block remains compatible; `transaction_list` carries chronological selections.
These are program-owned presentation blocks, not additions to Gemini's minimal
`answer`/optional `blockIds` schema.

The header groups the readable inclusive date range, full matching count and
verified expense total. Rows retain canonical category, amount, local date and
payment method with Analytics colors. Only largest-expense queries show ranks;
ordinary lists retain the selected record order. Limits remain five largest or
50 ordinary records (shared across queries on the backend). Truncation is shown
inside the card; empty results have no empty card. Existing transaction navigation
follows the records, including consistency-recovery responses. The isolated guest
demo continues to omit navigation into real account transactions.

React row keys derive from encoded authoritative transaction IDs, are absent
from DOM content and provider evidence, and never deduplicate equal-looking
records. Older local feeds missing IDs use canonical feed positions as a
compatibility fallback. Totals, filters, shares and exact-paise validations remain
authoritative. No model, SDK request configuration, financial engine, privacy
policy or authentication changes are required.

Latest validation: **286 tests passed**, ESLint passed, and production/PWA build
passed. Coverage includes the three first-week expenses totaling ₹579, local
timezone boundaries, category/payment filters, distinct equal-looking records,
shared limits, guest isolation, multi-turn SDK transport fixtures, consistency
recovery, semantic lists, navigation and 320px/theme CSS safeguards. Provider
transport is mocked; browser pixel layout and assistive-technology behavior were
not exercised. No app, backend, Netlify Dev, preview or deployment was started.
Existing chunk-size and outdated Browserslist warnings remain.

For the current intent-aware cloud composition and deduplication policy, see
[Concise financial responses](../../../netlify/RESPONSE_COMPOSITION.md).

The provider grammar and error diagnostics were subsequently simplified without
changing these components. See
[Stable narrative responses](../../../netlify/NARRATIVE_RESPONSE_REPAIR.md)
for the current provider contract and validation results.

The existing chat shell, auth-based data selection, consent, suggestions, Retry,
New Chat and account-isolation boundary remain in place. This change replaces the
assistant message body with a reusable, validated presentation layer.

## Supported blocks

| Block | Behavior |
| --- | --- |
| Paragraph / heading | Short prose, bold emphasis and highlighted INR values; React text nodes only. |
| List | Semantic numbered steps or bullet lists. |
| Metric | Exact integer-paise income, expense or net-cash-flow values supplied by the financial engine. |
| Comparison | Existing card structure with chronological periods, verified change, explicit trend label and expandable scope details. |
| Categories | Verified category amounts and shares, accessible progress bars, total/basis labels and disclosed omitted categories. |
| Savings | Clearly labelled hypothetical estimate, recorded spending basis, exact cut, remaining spend and period. |
| Recommendation | Numbered guidance cards with optional backend-calculated estimate references. |
| Notice | Blue information or amber caution. |
| Actions | Actual navigation through the registered FinSight routes. |
| Follow-ups | Supported question IDs routed through the existing composer and retained context. |

Green marks income, savings estimates and favorable trends. Coral marks
unfavorable spending/income changes. Blue marks guidance and information; amber
marks cautions and spending opportunities. The response stylesheet uses existing
FinSight surfaces, borders and typography with explicit semantic colors for light
and dark themes. Trend meaning is also expressed in text and icons, never color
alone. Mobile layouts use one-column metric grids, wrapping content/actions and
touch targets; no charting, markdown or runtime UI library was added.

## Financial authority and model output

`presentation: { version: 1, blocks: [...] }` is a strict public contract.
Unknown fields/types, invalid numbers, inconsistent shares, incorrect savings
arithmetic, invalid comparison changes and unsupported actions are rejected. The
HTTP client validates this contract before returning a cloud answer, and the
renderer validates again before displaying it. Unknown presentations do not
silently become unverified financial cards.

Gemini's structured schema permits only supported blocks. It selects financial
blocks by `availableBlocks` IDs; it cannot provide amount/percentage/card-value
fields. The backend creates these resources from its own financial calculations.
Text still uses existing verified fact placeholders and claim checks. Unknown
IDs, duplicate financial blocks, invented figures, unsupported personal claims,
HTML block types and arbitrary action URLs fail validation. HTML-like strings
are escaped as text; there is no `dangerouslySetInnerHTML`, arbitrary link
renderer or generated CSS.

Legacy answer/section replies remain supported and are converted into safe
presentation blocks. The normal number of provider calls is unchanged. The
existing single correction budget, provider-error behavior, request deadline,
authentication, UID allowlist, consent and paid-data-handling gate remain active.

Period comparisons preserve their original query scope for conversational
follow-ups, while displayed cards run earlier → later with recalculated changes.
Matching chronological comparison facts are provided for model explanations.
When the earlier recorded amount is zero, the absolute change remains available
and the percentage is `null`, displayed as **N/A**. Category-versus-category cards
retain their requested category order rather than inventing a timeline.

## Layout selection and navigation

Simple totals use a compact metric; overviews use category summaries; reductions
use a few numbered recommendations with explicitly hypothetical estimates;
cash-flow questions use an income/expense/net row. Full transaction requests
retain verified record lists and omission notices. Multi-query development lists
retain the existing shared maximum of fifty displayed records, and the backend
reserves presentation capacity for those records rather than letting model prose
expand the answer into an oversized report. Presentations are bounded to sixteen
blocks and a fixed serialized size.

The explicit action registry is:

| ID | Label | Implemented route |
| --- | --- | --- |
| `analytics` | View Analytics | `/analytics` |
| `transactions` | Open Transactions | `/expenses` |
| `gpay_import` | Import GPay | `/transactions-import` |

The backend also checks action relevance for the requested tools/guide. No Budget
page, unrestricted URL or transaction mutation action is supported.

GPay guidance describes the implemented workflow: select a statement PDF, review
the parsed transactions, then confirm the import. Protected/local and guest
sessions can answer application guidance without financial retrieval or provider
calls. Eligible development messages still reach Gemini first; its planner can
select the verified application guide and generate structured steps, with no
financial record retrieval. The navigation button uses React Router and opens the
actual importer. It does not import anything automatically.

## Guest compatibility

The isolated local demo uses the same engine and renderer. It remains labelled
`Demo · Local sample analysis`, makes no provider or Firestore requests, and
retains its sample-specific conversation scope. Financial demo blocks omit links
to real Analytics/Transactions views; application-guidance navigation remains
available. Sample data never enters the account feed or real totals/reports.

## Changed files for this request

| Files | Purpose |
| --- | --- |
| `AssistantResponse.jsx`, `responseBlocks.css` | Reusable accessible response components, existing comparison-card extraction, semantic colors and responsive styling. |
| `responseBlocks.js` | Public schema, strict validation, action/follow-up registries, chronological normalization and safe legacy list formatting. |
| `financialPresentation.js` | Deterministic block catalogs/layouts and concise record summaries. |
| `appGuidance.js` | Verified GPay workflow and registered navigation. |
| `financialEngine.js`, `financialContext.js` | Presentation projections, chronological facts and shared exact reduction calculations. |
| `chatOrchestrator.js`, `demoAnalysis.js` | Local/guest formatting and application guidance after server-authoritative development routing. |
| `src/pages/FinSightAI.jsx` | Render blocks in the existing message body, contextual footer chips and concise source/scope metadata. |
| `src/services/financeChatClient.js` | Validate returned rich payloads. |
| `netlify/lib/modelResponseBlocks.js` | Strict model-block schema, authorized reference resolution and plain-text history projection. |
| `netlify/lib/developmentResponse.js`, `developmentConversation.js` | Rich structured output, prepared catalogs, bounded lists and existing fact-validation/correction integration. |
| `netlify/lib/developmentContract.js` | Supported GPay application-guide planning operation. |
| `netlify/lib/developmentScenarios.js` | Re-export the same exact reduction arithmetic from the shared calculation module. |
| `netlify/lib/geminiFinance.js`, `modelValidation.js` | Shared structured presentation for paid/synthetic explanations and precise block/action validation feedback. |
| `netlify/functions/finance-chat.mjs` | Authenticated protected application guidance with validated conversation context. |
| `responseBlocks.test.mjs` | Nine shared schema, numerical, guest, chronology, route, responsive-rule and contrast regressions. |
| `netlify/tests/responseBlocks.test.mjs` | Eight actual handler/official-SDK adapter regressions using mocked transport. |
| `accountDemoUI.test.mjs` | Five additional real React/DOM tests for rich rendering, navigation, semantic/accessibility structure and follow-ups. |
| `netlify/lib/geminiFinance.test.mjs` | Assert the expanded structured-output schema. |

## Validation and remaining limits

All **226 automated tests**, ESLint and the production/PWA build pass. Existing
large-chunk and outdated Browserslist warnings remain. Tests cover schemas,
financial/reference validation, malicious blocks/actions, exact savings,
chronological and zero-baseline comparisons, shared list limits, demo isolation,
memory-router navigation, semantic lists, readable labels, mobile CSS rules and
at least 4.5:1 semantic foreground contrast against conservative tinted surfaces
for every existing light/dark theme.

No new environment variables or runtime dependencies are required. Provider
transport is mocked; no live Gemini response quality or provider-side schema
acceptance is claimed. DOM/CSS tests do not replace browser screenshots,
pixel-level mobile verification or assistive-technology testing. The app, Netlify
Dev and browser previews were not started, and nothing was deployed.
