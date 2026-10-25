# Gemini request compatibility repair

The final provider contract has since been simplified to required narrative text
with optional prepared block IDs. See [Stable narrative responses](NARRATIVE_RESPONSE_REPAIR.md)
for the current schema, diagnostics and validation results. The flat-block repair
below is retained as the earlier investigation record.

## Finding and evidence limits

The rich-response change replaced the last tracked working explanation schema
(`answer` plus `cardIds`) in `generationConfig.responseJsonSchema` with three
alternative root shapes and seven alternative rich-block shapes. The captured
pre-repair schema is in `tests/fixtures/rich-response-schema-before.json`: 2,420
bytes when minified, 81 object/array nodes, depth 11. The SDK, JSON MIME type,
LOW/MEDIUM thinking configuration and separate planner/tool/explanation lifecycle
were not changed by that rich schema. There are no SDK `tools`,
`functionDeclarations` or `toolConfig` parameters to conflict with JSON output.

This identifies the new schema as the request-configuration change associated
with the regression. It does **not** establish the exact Google grammar-compiler
constraint that rejected a production request: the old handler discarded that
provider detail. Google's structured-output documentation supports `anyOf` in
some schemas; a union alone is not proof of an invalid parameter. It also warns
that complex/deep schemas can be rejected and recommends simplifying them.

The linked site's model setting was verified read-only as
`gemini-3.1-flash-lite`. Its API key is protected by Netlify Secrets Controller.
Production secret values cannot be read locally through the CLI/API. Synthetic
comparison probes using that protected return value did not produce a usable
authenticated provider response, so they establish neither production credential
validity nor provider-side acceptance of either schema. No successful live Gemini
call is claimed. No secrets settings or remote configuration were changed.

## Correction

- `lib/geminiRequestSchema.js` separates the provider grammar from the existing
  rich public presentation and strict financial validators. The final schema is
  one `blocks`/`cardIds` envelope with one flat block shape, 791 minified bytes,
  20 nodes, depth 6, no schema unions or nullable type alternatives. Each block
  uses required scalar fields and a string array; unused fields have neutral
  values. The model selects prepared resource IDs and exact fact placeholders.
- The planner has its own flat schema (873 bytes, depth 6). Wire-only empty
  strings, zero target and minus-one reduction sentinels normalize immediately
  before the existing plan validator. Zero-percent reductions remain zero.
  Retained canonical scopes still use the original contract and are not
  normalized. Bounds, permissions, date limits and unsupported-field checks
  remain authoritative in backend validation.
- The lifecycle remains Gemini planning → validated authenticated read-only
  financial tools → Gemini explanation. Final response formatting is never mixed
  into native function-calling declarations. Context/history are preserved.
- `modelResponseBlocks.js` converts flat selectors into the existing rich
  presentation. It rejects nonempty unused fields, unknown fields, unsupported
  actions, unknown resource IDs, unverified amounts and inconsistent claims.
  Existing cards, numbered recommendations, categories, savings estimates,
  navigation, themes, local guest demo and deterministic calculations remain.
  Legacy typed block/answer/section responses still pass strict server validation.
- The default and `.env.example` now specify `gemini-3.1-flash-lite`; explicit
  `GEMINI_MODEL` is honored without substituting another model. Keep the existing
  server-side `GEMINI_API_KEY`, consent, UID allowlist and paid/development privacy
  settings. No new environment variable or runtime dependency is required.

## Errors and retry policy

`lib/geminiErrors.js` uses the official SDK's HTTP `status`, with bounded parsing
of its error body. A schema 400 is no longer mistaken for an unsupported model
just because Google's message contains "model" or "not supported".

| Failure | Result |
| --- | --- |
| Provider 400 configuration | `GEMINI_REQUEST_REJECTED`, API 502, provider status 400, `retryable: false`; no SDK, correction or application retry |
| Provider credential rejection | `GEMINI_AUTH_FAILED`, separate credential reason, no retry |
| Provider 429 | `GEMINI_RATE_LIMITED`, API 429; no automatic retry consuming quota |
| Provider 503 | `GEMINI_PROVIDER_FAILED`, API 503; development allows only one short bounded retry |
| Transport / deadline | Distinct transport / timeout codes; existing request deadline retained |
| Malformed JSON / structured output | `model_output` origin with validation rule and actual stage; existing one-correction budget per development turn |
| Financial validation | Separate unverified-figure, fact-reference or financial-claim code; never an unverified rendered card |
| Local schema preflight | `configuration` origin before constructing the SDK client; no provider call |

Diagnostics contain only stage, HTTP status, canonical provider code, fixed safe
message/reason, configured model, schema version, attempt count and allowlisted
request field paths/keywords. Raw provider messages/details, prompts, credentials,
UIDs and financial values are neither echoed nor logged. The client preserves
these diagnostics and the nonretryable flag. No chatbot UI changes are required.

## Validation

`tests/geminiConfiguration.test.mjs` exercises the actual official
`@google/genai` SDK and inspects serialized HTTP request bodies with mocked
transport, rather than mocking `generateContent` success alone. It covers the
first question, follow-up advice, an explicit savings scenario, history, exact
read-only tool order/results, flat financial-card selection, canonical-scope
validation, 400/429/503/transport errors, bounded retries, malformed JSON,
financial hallucination and rejection of the captured old schema before sending.
The client/orchestrator routing suite additionally checks that a provider 400
retains its stage and nonretryable flag without any local fallback.

All **238 automated tests**, ESLint and production/PWA build pass. The build has
the existing bundle-size and outdated Browserslist warnings. Transport tests do
not establish live provider acceptance or live conversational response quality.
No application, Netlify Dev or browser preview was started; nothing was deployed.

## Changed files for this repair

| Files | Purpose |
| --- | --- |
| `lib/geminiRequestSchema.js` | Flat provider schemas, planner normalization, compatibility preflight |
| `lib/developmentContract.js`, `lib/developmentConversation.js` | Send the flat planner format and normalize only model output before existing tool validation |
| `lib/developmentResponse.js`, `lib/modelResponseBlocks.js` | Flat final output instructions and conversion into existing rich blocks |
| `lib/geminiFinance.js` | Model default, actual SDK request stages, schema preflight and provider-error mapping |
| `lib/geminiErrors.js`, `lib/aiErrors.js`, `lib/modelValidation.js` | Safe provider diagnostics, retryability, stage propagation and correction feedback |
| `functions/finance-chat.mjs`, `../src/services/financeChatClient.js` | Preserve safe error metadata through the existing HTTP boundary |
| `../.env.example` | Document the requested model |
| `tests/geminiConfiguration.test.mjs`, `tests/fixtures/*.json` | Actual serialized SDK configuration and captured pre-repair schemas |
| `lib/geminiFinance.test.mjs`, `tests/recommendations.test.mjs`, `tests/responseBlocks.test.mjs`, `tests/routing.test.mjs` | Updated schema expectations and client 400 regression |
| `GEMINI_REQUEST_COMPATIBILITY.md`, `../src/features/finance-ai/RICH_RESPONSES.md` | Findings, evidence limits and validation report |

## Official references

- [Google structured output and supported JSON schema subset](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [Official JavaScript SDK ApiError.status](https://googleapis.github.io/js-genai/release_docs/classes/errors.ApiError.html)
- [Google API error troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)
- [Netlify's production secret access policy](https://www.netlify.com/blog/general-availability-secrets-controller/)
