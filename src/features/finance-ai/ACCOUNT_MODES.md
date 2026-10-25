# Automatic account analysis and guest demo

FinSight AI now derives its data source from the application's Firebase auth
readiness and current user. There is no visible mode selector or synthetic-demo
question dropdown.

| Auth state | AI behavior |
| --- | --- |
| Not resolved | Show a loading state; mount no chat, record subscription or capability request. |
| Regular signed-in Firebase user | Analyze that account's canonical records, with explicit cloud consent and the existing server policies. |
| Signed out or anonymous guest | Show `Demo · Sample financial data` and an interactive local sample-data conversation. |

## Account isolation and transitions

`App.jsx` exposes its existing `isAuthReady` state through `ExpensesContext`.
`FinanceChatSession` keys its inner conversation by auth/source/account identity.
Login, logout, anonymous-to-regular changes, different UIDs and a return to auth
loading unmount the previous conversation synchronously in the next render.
Messages, input, context, errors, pending requests and consent do not carry over.
Unmounting aborts the previous cloud request and stops its subscription.

The account-record adapter checks the expected UID against Firebase's current
regular user before subscribing. It suppresses callbacks after account changes or
unsubscribe, tags the feed with its owner, and never starts a guest transaction
subscription. The HTTP client also discards a cloud result if the authenticated
account changed while awaiting its response. Backend token verification,
authenticated UID-scoped read-only Firestore access and numerical tools remain
unchanged.

Cloud sharing is off initially for each account/source session. Development
allowlists and operator-confirmed fictional data remain mandatory for development
Gemini use; personal-context explanations retain the paid-data-handling gate.
Protected users retain local analysis and permitted abstract intent processing.
Ordinary user copy explains these restrictions without environment-variable or
allowlist terminology. Safe developer diagnostics remain available in local
development builds and for designated allowlisted test accounts.

Intended cloud failures remain visible with Retry. `Use local analysis` is an
explicit choice, clears cloud-specific scope, and re-plans against this account's
own index. A provider error never silently becomes a purported Gemini answer.

## Guest demo and quota safeguards

The public demo makes **zero Gemini, finance API or Firestore requests**. There
is no new unauthenticated provider endpoint. Existing per-user server counters
are not a durable global public quota budget, so public Gemini access was not
introduced. The existing authenticated synthetic API remains protected and is no
longer exposed as a selectable UI mode.

The demo works offline and uses the existing deterministic financial planner and
engine. Its fixed, frozen fixtures cover August–October 2026, income and expense
records, multiple categories and payment methods. Relative dates use the clearly
displayed sample reference date, 24 October 2026. Free-text questions, unchanged
Try Asking / Keep Exploring chips, comparisons, budgeting suggestions and scoped
follow-ups use only these fixtures.

The original fixtures retain reserved sample IDs and sample flags, so ordinary
financial indexes exclude them. Only the isolated demo evaluator projects those
AI-owned fixtures into its private calculation inputs. Demo context has its own
`demo-v1` envelope and rejects account-context contracts. Nothing writes fixtures
or conversations to local transaction storage, Firestore or ExpensesContext;
guest transactions elsewhere in FinSight are not consumed or modified.

Responses are explicitly labelled `Demo · Local sample analysis`; comparison
cards identify sample data. The demo does not claim to produce Gemini output.
Unsupported/ambiguous language can require clarification because this public path
uses the local planner rather than a generative model.

## Files changed for this request

| File | Change |
| --- | --- |
| `src/App.jsx` | Expose the established auth-ready flag to the AI page. |
| `src/pages/FinSightAI.jsx` | Automatic account/demo/loading selection; keyed session boundary; remove tabs/dropdown and large demo warning; preserve chat controls; local-analysis choice. |
| `src/features/finance-ai/financeSession.js` | Auth identity, scoped subscription adapter and user-facing privacy/error copy. |
| `src/features/finance-ai/demoAnalysis.js` | Isolated immutable sample dataset and deterministic interactive demo. |
| `src/features/finance-ai/financeChat.css` | Small theme-aware demo indicator and developer details; comparison-card styles unchanged. |
| `src/features/finance-ai/financeRouting.js` | Truthful local-demo source label. |
| `src/services/financeChatService.js` | Bind AI record subscriptions to the authenticated account. |
| `src/services/financeChatClient.js` | Reject responses arriving after auth changes. |
| `src/features/finance-ai/accountDemo.test.mjs` | Seven identity, isolation, numerical, context and late-response regressions. |
| `src/features/finance-ai/accountDemoUI.test.mjs` | Ten real React/DOM regressions covering loading, guests, login/logout, consent, callbacks, comparisons, New chat and provider failures. |
| `tests/browser/finance-chat-fixture.jsx` | Update isolated QA fixture to the automatic session contract; fixture was not opened. |
| `package.json`, `package-lock.json` | Add pinned jsdom 26.1.0 as a test-only dependency compatible with the project's Node runtime. |

## Validation and limits

All **204 tests**, ESLint and the production/PWA build pass. Existing bundle-size
and outdated Browserslist warnings remain. Component tests run in isolated jsdom
without starting the application or a browser; Firebase and provider dependencies
are replaced with explicit test seams. Existing backend authentication, privacy,
Gemini SDK, quota, numerical and conversation tests also pass.

No new environment variables or server permissions are required. No real account
records or live Gemini calls were used, and browser visual behavior was not
inspected. No app server, Netlify Dev or preview was started; nothing was deployed.
