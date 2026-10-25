# FinSight AI — Gemini-First Routing Priority Fix

## Confirmed causes and what remains unverified

The routing investigation found separate source and control-flow problems.

1. Checked-in HEAD f71d949 (AI Chat window) still contains the original local-first orchestrator. It plans and calculates locally before considering a cloud request, returns immediately for factual questions and empty data, and catches provider failures by returning a local answer. The full development modules are present only as uncommitted working-tree files. A Git deployment built from that commit would not contain the development implementation.
2. In the development working copy, the development branch was already before local parsing, but it depended on a client boolean derived from one capability lookup.
3. FinSightAI converted every failed capability lookup into mode=protected and cached that result for the page session. An unavailable, mismatched or older function could therefore turn a genuinely unknown routing state into a permanent local route.
4. The backend previously entered development only when the frontend explicitly sent mode=development. A stale or incorrectly downgraded client could bypass it.
5. The protected cloud path still converted intended provider failures into local answers. That made failures look like successful local financial responses.

The deployed Netlify function, deployed frontend build and actual signed-in UID were not accessed. These findings establish the source defects and the checked-in/working-copy difference; they do not prove which exact failure occurred in the live deployment.

The local process has no configured Gemini key, development handling flag, fictional-data confirmation or UID allowlist. Only .env.example is present. These local facts do not establish the Netlify runtime settings.

## Corrected routing

For every consented conversational message, the production UI now uses the authenticated /api/finance-chat route action BEFORE local intent recognition or financial answer generation.

The server re-evaluates the verified Firebase UID and current configuration on each message:

- If development eligibility is satisfied, Gemini interprets the full sanitized question and recent conversation, proposes validated read-only financial tools, receives verified backend results and generates the final explanation.
- If protected processing is confirmed, the server returns an explicit protected decision and diagnostic reasons, without financial retrieval or a provider call. The existing browser financial engine then answers ordinary factual questions locally.
- If a route cannot be verified, the operation fails visibly. An unknown state is never converted into protected mode.
- Eligible, consented legacy personal-mode requests are also routed into development on the server, before deterministic question planning.
- If development access disappears during an existing development conversation, the chat cannot silently switch its scope into local responses.

The capability lookup remains useful for consent text and diagnostics. It no longer controls the final route through a permanent frontend cache. Failed checks have a Retry routing check button and retain their actual error.

No new keyword rules, UI redesign, vector database, transaction mutation or Firestore schema change was introduced.

## Eligibility and privacy

Full development routing still requires all of:

- GEMINI_DATA_HANDLING=development.
- GEMINI_DEVELOPMENT_DATA=fictional.
- The exact verified Firebase UID is included in GEMINI_DEVELOPMENT_UIDS, using the existing comma/whitespace-separated server-side allowlist.
- Explicit cloud-sharing consent.
- Appropriate signed-in authentication, origin, Firebase project and existing data-access checks.

GEMINI_API_KEY must also be configured for a provider request to succeed. Missing credentials produce a configuration error, not a local fallback.

The UID is derived exclusively from the verified Firebase token. Neither a client mode, submitted context nor a model tool request can choose another user. UIDs, the allowlist and keys are never returned in diagnostics.

Fictional-data confirmation remains an operator assertion for designated test-only accounts. Ordinary production users retain protected handling; personal-context explanations retain the existing paid-service gate. Development sanitization, excluded record people/notes/IDs, exact paise calculations, sample exclusion, authenticated Firestore access and financial-output guards remain in force.

Existing required server settings are unchanged:

| Variable | Development setting |
| --- | --- |
| GEMINI_API_KEY | Existing backend key |
| GEMINI_MODEL | gemini-3.8-flash |
| GEMINI_DATA_HANDLING | development |
| GEMINI_DEVELOPMENT_DATA | fictional |
| GEMINI_DEVELOPMENT_UIDS | Exact designated test Firebase UIDs |
| FIREBASE_PROJECT_ID | Existing Firebase project, finsight-web |
| AI_ALLOWED_ORIGIN | Exact application origin, or the existing Netlify origin fallbacks |

These values were not enabled or changed remotely. The example configuration remains disabled by default.

## Failures and source labels

Routing diagnostics now distinguish:

| Code | Meaning |
| --- | --- |
| DEVELOPMENT_DISABLED | The backend is not configured for development mode |
| TEST_UID_NOT_ALLOWLISTED | The authenticated UID does not match the test allowlist |
| CLOUD_SHARING_DISABLED | The user has not enabled sharing |
| DEVELOPMENT_DATA_UNCONFIRMED | Fictional test-data policy is not confirmed |
| GEMINI_KEY_MISSING | Backend Gemini configuration is missing |
| GEMINI_PROVIDER_FAILED and other existing provider codes | A provider request failed |
| AI_ROUTING_VERSION_MISMATCH | The function and frontend routing contracts do not match |
| AI_BACKEND_UNAVAILABLE | The AI function could not be reached or returned an unsupported response |
| DEVELOPMENT_RESPONSE_MISMATCH | An intended development route returned something other than a confirmed Gemini response |
| DEVELOPMENT_SESSION_CHANGED | A development conversation lost eligibility and cannot silently become a local chat |

The frontend and function share an explicit routingVersion contract. An older function rejecting capability/route requests is identified as a deployment mismatch instead of being interpreted as protected mode.

Provider/configuration/routing errors remain retryable errors and use the existing Retry/Edit controls. Intended Gemini requests no longer fall back to local financial answers, including in the protected analytical path. Ordinary factual protected calculations continue working locally.

Response sources are validated. Gemini-generated development responses require the correct source, fictional-data marker, routing version and successful development processing metadata. Unknown or inconsistent sources cannot be labelled local or Gemini-generated by default.

Development clarification prose is now generated by Gemini too. A model planning result that requests clarification no longer receives a canned local sentence under a Gemini-generated label.

## Interpretation and exact financial results

The existing development pipeline remains responsible for:

1. Sending full sanitized questions, bounded user/assistant history and validated scope to Gemini.
2. Validating up to three structured financial queries, real local-date boundaries, categories, payment filters and user-requested savings targets.
3. Coalescing date ranges and retrieving only the authenticated account's relevant transactions.
4. Calculating exact figures and constructing verified facts/cards in the backend.
5. Returning those results to Gemini for its final conversational response.
6. Rejecting invented figures, unknown fact references and unsupported cards.

The shared client transport is now independently testable and is the same implementation used by the Firebase-backed production service. Tests exercise its HTTP serialization, error handling and source validation against the actual Netlify function handler and official SDK adapter with mocked provider transport.

Try Asking, Keep Exploring, comparison cards, New Chat, themes, responsive CSS and the existing Netlify architecture remain intact.

## Validation

**167 automated tests passed. ESLint passed. Production/PWA build passed.** Existing large-chunk and outdated Browserslist warnings remain.

Thirteen new vertical integration regressions verify:

- Client → orchestrator → Netlify → mocked official Gemini SDK routing before any local planning, including a deliberately unusable local index.
- All seven requested conversational inputs, recent assistant history and retained scope.
- Validated tools, exact authenticated retrieval and verified results returned to Gemini.
- Provider failure after retrieval remains an error.
- Stale protected flags and legacy personal-mode calls cannot bypass eligible development routing.
- Older capability/route contracts are deployment errors.
- Missing key, disabled mode, non-allowlisted UID, unconfirmed fictional data and disabled consent have distinct outcomes.
- Ordinary local calculations remain available.
- Invalid tool operations and cross-user identity assertions cannot change retrieval.
- Mismatched source labels are rejected.
- Gemini-generated clarification text.
- Configuration changes are re-evaluated per message rather than trusting a permanent page cache.

Existing auth, Firestore isolation, protected/free-tier, synthetic demo, numerical accuracy, privacy, retry, cancellation, concurrency, Analytics and transaction regressions also pass.

The tests use fictional records and explicit mock provider responses. They do not prove live Gemini connectivity, natural-language quality, quota availability or the configuration/build currently deployed on Netlify.

No application server, Netlify Dev or browser preview was started. Nothing was deployed and no live financial data was modified.

## Files corrected for this routing update

| File | Change |
| --- | --- |
| src/features/finance-ai/chatOrchestrator.js | Server routing before local processing; remove provider-error local fallbacks |
| src/features/finance-ai/financeRouting.js | Shared routing version, diagnostics and response-source validation |
| src/services/financeChatService.js | Thin Firebase-backed wrapper around the actual client transport |
| src/services/financeChatClient.js | Authenticated route requests, full history serialization, deployment/source checks and retryable errors |
| src/pages/FinSightAI.jsx | Route every consented question; retain lookup failures; retry checks and truthful labels/reasons |
| netlify/functions/finance-chat.mjs | Server-authoritative per-message routing and eligible personal-request upgrade |
| netlify/lib/developmentPolicy.js | Distinct eligibility checks and reasons without exposing identities |
| netlify/lib/developmentConversation.js | Gemini-generated clarification instead of a canned development response |
| netlify/tests/routing.test.mjs | Full client/function/SDK routing regressions |
| netlify/tests/development.test.mjs | Updated capability contract assertion |
| src/features/finance-ai/conversation.test.mjs | Assert intended provider failures stay errors |
| tests/browser/finance-chat-fixture.jsx | Explicit isolated routing mock; fixture was not opened |
| PHASE21-1.md | This investigation, correction and verification report |
