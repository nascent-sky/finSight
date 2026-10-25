# Ranked-expense and Shopping recommendation polish

## Largest Expenses card

Only the largest-expense presentation changes. It now uses a compact structured
card with the requested period, total recorded spending, ranks, category icons,
individual INR amounts, dates, payment methods and “Showing 5 of 13 expenses”
information. Small contribution bars use each transaction's share of the full
verified total, not the sum of the five displayed rows. Category accents reuse
Analytics' existing `getCategoryColor` palette. Open Transactions keeps its
existing implemented route and navigation action.

The backend projects canonical records directly into `ranked_expenses`; it does
not parse money/dates from display strings or ask Gemini to construct financial
UI. The public presentation validator checks row order, dates within the query
scope, payment/category filters, exact amounts, displayed-row sums, counts and
shares. The Gemini output schema remains the same required `answer` with optional
`blockIds`; this additional server-owned presentation block does not change it.

The same largest-expense view can render for account/local/demo results without
changing their datasets, routing or calculations. General transaction lists,
category breakdowns, comparisons and recommendation-card styling remain intact.

The card preserves financial detail even when a verified amount also appears in
the conversational explanation. A regression checks both copies remain visible;
only the pre-existing exact duplicate-row policy remains for repeated full lists.

Desktop amounts align right. Below 400px, including 320px, the amount moves onto
its own right-aligned row so the category/date/payment information can wrap.
Flexible tracks, zero minimum widths, wrapping headers and long-label handling
avoid a fixed-width card. Existing theme surfaces/foregrounds are used; category
icons have separate light/dark contrast treatments. Semantic ordered lists,
date elements, decorative icon labels and accessible contribution values remain.

## Gradual Shopping reductions

General cloud recommendations now use the existing exact integer-paise reduction
helper for gradual alternatives. A recommendation shows the 10% saving in its
conditional explanation and the 20% scenario in its existing compact estimate.
For a ₹1,200 recorded Shopping basis this is:

- 10% hypothetical reduction: ₹120.
- 20% hypothetical reduction: ₹240, leaving ₹960.

The same gradual default applies to the already eligible Entertainment review
candidate; no essential category is added to automatic recommendations. Recorded
counts and verified spending remain the basis. Language explicitly depends on
flexibility and does not label purchases unnecessary or promise monthly savings.

Full-purchase deferral is retained for an explicit purchase-deferral request or a
clear request to discuss that deferral option. Negated requests and ordinary
Shopping-reduction questions keep the gradual default. This is a presentation
opt-in only; it does not alter conversational intent routing, tool scopes or
stored context. Explicit requested percentage scenarios, including 100%, retain
their existing validated behavior. Target-savings calculations are unchanged.

Combined summaries continue to sum only disjoint, verified scenarios; their label
now distinguishes gradual reductions from optional purchase deferrals. Individual
estimates remain embedded in the existing recommendation design.

## Changed files

| File | Purpose |
| --- | --- |
| `../src/features/finance-ai/AssistantResponse.jsx` | Compact ranked card with Analytics colors/icons and responsive financial rows |
| `../src/features/finance-ai/responseBlocks.css` | Ranked-card-only styles and 320px safeguards |
| `../src/features/finance-ai/financialPresentation.js` | Canonical ranked-row projection; use it for largest-expense layouts |
| `../src/features/finance-ai/responseBlocks.js` | Strict validation for the new server-owned presentation type |
| `lib/developmentConversation.js` | Put the same verified ranked card into authenticated responses and pass the explicit deferral presentation choice |
| `lib/responseComposition.js` | Gradual 10–20% defaults, conditional copy and explicit deferral opt-in |
| `lib/geminiFinance.js` | Pass the same presentation choice to the existing explanation adapter; SDK request code unchanged |
| `lib/modelResponseBlocks.js` | Plain-text projection of a ranked card when needed for history/compatibility |
| `../src/features/finance-ai/rankedExpenses.test.mjs` | Four focused data, validation, component and responsive-rule tests |
| `tests/responseComposition.test.mjs` | Gradual arithmetic and explicit/negated deferral tests; updated expected estimates |
| `tests/narrativeLifecycle.test.mjs` | Ranked-card integration, narrative/visual coexistence and explicit-deferral conversation coverage |
| `tests/narrativeConsistency.test.mjs`, `tests/responseBlocks.test.mjs` | Assert the new presentation and gradual defaults without changing factual expectations |
| This report and `../src/features/finance-ai/RICH_RESPONSES.md` | Current presentation details and validation |

## Validation and limitations

All **275 automated tests**, ESLint and production/PWA build pass. Existing
bundle-size and outdated Browserslist warnings remain. New checks cover the
reported thirteen-expense/₹6,254 example, ranks, dates/payment methods, shares of
the full total, count disclosure, Analytics colors, navigation, long labels,
320px CSS rules, exact gradual savings, explicit/negated deferral and narrative
amounts retained alongside the visual card.

Hashes confirm that the provider request schema, SDK generation/parsing/retry
implementation, financial engine, exact reduction arithmetic, financial claim
verification, authenticated retrieval, privacy policies and guest/local data
logic remain unchanged. No dependencies or environment variables were added.

Tests use isolated React/DOM rendering and mocked provider transport. Per the
requested restrictions, no application, browser preview or Netlify Dev was
started; nothing was deployed and no live API call was made. Responsive rules
and semantics are tested, but browser screenshots and pixel-level visual review
were not performed.
