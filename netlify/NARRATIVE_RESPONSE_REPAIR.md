# Stable narrative responses and optional presentation

## Diagnosis

`response_schema` is raised by FinSight after a successful provider response has
been extracted and parsed. It is not a Gemini HTTP configuration error. Before
this repair, `validateDevelopmentResponse` required `cardIds` even for valid
narrative text, and `normalizeBlock` required all eight flat UI fields with exact
neutral values for unused fields. Missing an unused `title`, `estimateId`, empty
array or boolean could reject the whole explanation. Unknown card IDs were also
fatal. Several unrelated failures shared one undifferentiated `response_schema`
rule, including final presentation validation.

The supplied deployed message contains only that rule. It does not contain the
offending response field/type, so the exact historical payload cannot be
reconstructed without guessing. No private production conversation was read or
logged. The regression suite reproduces a concrete failure and asserts its exact
diagnostic: `normalizeBlock`, explanation stage, `blocks[0].title`, expected
`string`, received `missing`. This is a verified reproduction of the old contract
failure, not a claim that this was the omitted field in the deployed request.

## New model contract

The single model-facing final response schema is 177 minified bytes:

```json
{
  "answer": "A concise explanation using exact {{fact_key}} placeholders.",
  "blockIds": ["an_optional_prepared_resource_id"]
}
```

Only `answer` is required. `blockIds` is optional. No UI objects, unused fields,
version numbers, card values or navigation URLs are required from the model.
The configured model remains `gemini-3.1-flash-lite`, using the official
`@google/genai` SDK, `responseMimeType: application/json`, and
`responseJsonSchema`. Planning remains a separate request; only validated backend
tools retrieve authenticated UID-scoped records. Gemini receives their sanitized
results for its final narrative and suggestions. Consent, Firebase verification,
development allowlisting, fictional-data attestation, paid-data policy and rate
limits are unchanged.

FinSight independently builds exact-paise metrics, category summaries,
chronological comparisons, expense lists, recommendation cards and hypothetical
savings estimates from the existing engine. The unchanged renderer consumes the
existing strict version-1 public presentation. Valid optional selectors can add
prepared resources; malformed, unknown and duplicate selectors cannot introduce
financial values or arbitrary links, displace backend defaults or trigger model
repairs. Legacy `cardIds` is treated as optional metadata for narrative replies.
Other supplied UI objects are never rendered. Safe discarded-selector warnings
contain only fixed codes, known field names and received types, without IDs.

Narratives still pass the same financial-placeholder and unsupported-claim checks.
Raw figures, unknown facts, invented personal causes, achieved-savings claims and
HTML/scripts/links fail validation. Explicit scenario requirements can be
satisfied by their verified displayed backend cards, rather than forcing Gemini
to repeat every figure. FinSight appends its own verified largest-expense and
transaction lists, preserving record limits and omission notices.

Older typed blocks/sections remain strictly validated for compatibility, but the
model is no longer asked to create them. The local engine and isolated local guest
demo are unchanged. A failed intended Gemini request never becomes a local answer
labelled as Gemini-generated.

## Lifecycle diagnostics

| Boundary | Handling |
| --- | --- |
| SDK extraction | Read non-thought text parts; join split JSON; distinguish empty output, truncation, blocked output and unexpected function calls/responses |
| JSON parsing | `json_invalid` with `json_parser`, actual stage and root `$` path; raw rejected JSON is never echoed |
| Final envelope | Distinguish missing, empty and incorrectly typed `answer`, wrong envelope type and planning/tool responses at final stage |
| Narrative / financial checks | Reuse exact fact resolution, qualitative-count rules and existing financial claim validation, independently of presentation |
| Optional presentation | Discard invalid suggestions, keep authoritative backend blocks, deduplicate and bound displayed blocks |
| Rich rendering | Run existing public presentation validation and render existing components; no UI redesign |

Safe `validation` details now include stage, rule, validator, field, expected
category, received type and whether the single correction budget was used.
Paths, validator names and expected/received categories are allowlisted. Actual
values, prompts, raw provider output, record identifiers, API keys and tokens are
not returned or logged. The existing client preserves these details and Retry.

Optional presentation defects consume **no** correction request. Empty,
truncated, blocked or native-tool output stops immediately with Retry available.
Malformed JSON or invalid narrative/claims can use at most one correction across
the whole development turn. Provider 400 errors are never retried; the existing
bounded transient retry and total deadline remain intact.

## Files changed in this repair

- `lib/geminiRequestSchema.js`: minimal final schema and unambiguous instructions.
- `lib/developmentResponse.js`: independent narrative validation, optional
  references and bounded backend presentation composition.
- `lib/developmentConversation.js`: the same final schema for explanation,
  clarification and GPay guidance; keep backend lists and verified guide steps.
- `lib/geminiFinance.js`: SDK extraction and distinct output-stage errors.
- `lib/modelValidation.js`: precise safe codes, field/type diagnostics and bounded
  correction feedback.
- `lib/modelResponseBlocks.js`: precise diagnostics for legacy flat-block fields.
- `tests/narrativeLifecycle.test.mjs`: complete client/function/SDK/rendering
  regressions for all requested questions and malformed output cases.
- `lib/geminiFinance.test.mjs`, `tests/geminiConfiguration.test.mjs`,
  `tests/development.test.mjs`, `tests/recommendations.test.mjs`,
  `tests/responseBlocks.test.mjs`: assert the current minimal schema and stop
  treating optional metadata defects as financial validation failures.
- This report, `GEMINI_REQUEST_COMPATIBILITY.md`, and
  `../src/features/finance-ai/RICH_RESPONSES.md`: document the current contract.

## Validation and limits

All **245 automated tests**, ESLint and production/PWA build pass. Existing
bundle-size and outdated Browserslist warnings remain. New tests use the real
official SDK with mocked HTTP transport, the actual handler and client, verified
backend calculations, and server rendering of the existing React response
component. They cover all five requested questions with conversation history,
optional metadata, malformed JSON, empty/truncated/thought/tool output, unsafe
content and unsupported financial claims. Existing tests continue to cover local
analysis, guest isolation, authentication, privacy, rates and provider failures.

No live Gemini request was made during this repair. Provider transport acceptance
and real-model conversational quality remain unverified. No new environment
variables or dependencies are needed. No application, Netlify Dev or browser
preview was started; nothing was deployed.

Official compatibility references:
[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
and [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).
