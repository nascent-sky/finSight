# FinSight AI — Free-Tier Connectivity and Privacy

The reported HTTP 503 was an application privacy restriction, not evidence of a Gemini API failure. The implementation now separates safe intent interpretation, isolated synthetic demonstrations and personal financial explanations.

## Exact gate and refactor

Previously requireGeminiConfiguration rejected every request when GEMINI_DATA_HANDLING !== "paid". Both the Netlify endpoint and the shared SDK request helper called that gate, including for intent interpretation.

The helper now distinguishes whether private context will be transmitted. A backend key is required for every provider call. The paid-data-handling condition still protects both raw-question interpretation and explanations using real financial context. It does not block abstract intent requests or fixed synthetic demonstrations.

GEMINI_DATA_HANDLING=disabled, unset, or any value other than paid uses the safe path for cloud requests. It never grants permission to transmit real financial context. Only the exact paid value enables the existing personal-context path, after user consent.

## Data paths

| Path | Data sent to Gemini | Calculations/data access |
| --- | --- | --- |
| Direct financial answer | Nothing | Existing canonical browser engine, or authenticated backend |
| Safe free-tier intent | Program-owned operator and metric enums, a continuation boolean and an optional previous intent enum | Exact dates, category/method filters, targets, retrieval and paise arithmetic stay in FinSight |
| Synthetic demo | Fixed server-owned fictional facts and fixed example questions | Isolated fictional records; no Firestore read or personal feed subscription |
| Paid personal explanation | Existing relevant calculated facts, bounded redacted expense details and bounded user question history | Authenticated server retrieval and deterministic calculations; existing paid gate and consent remain required |

The free-tier projection never copies raw questions, past questions, amounts, dates, timezone, category labels, payment methods, identifiers, record counts, financial summaries, private notes or transaction arrays into the provider payload. Unknown meaning fails closed with a local clarification requirement. This is a finite semantic projection, not a claim that arbitrary text becomes safe through redaction.

Gemini selects only a validated operation in safe mode. It cannot return dates, amounts, filters, arbitrary database queries or mutations. Explicit locally understood intent and filters are checked before retrieval. Real records are queried only under the UID from the verified Firebase token and are never passed to the free-tier model.

Google's [Gemini terms](https://ai.google.dev/gemini-api/terms) exclude personal, confidential and sensitive submissions from unpaid services; the safe path therefore avoids personal wording as well as actual financial records.

## Synthetic conversations

The /ai page now offers My finances and Synthetic Gemini demo. The demo is explicitly labelled fictional in its notice, answer prefix, source line and comparison cards. Its composer accepts a fixed example question rather than arbitrary personal text.

The API accepts mode=synthetic, consent, a questionId and bounded history of fixed question IDs. It rejects real messages, records, financial context, arbitrary prompts and client claims that data is synthetic. The adapter constructs its data internally from fixed fictional records; callers cannot bypass the paid gate by passing synthetic=true alongside real analysis.

The demo uses the production Google SDK adapter to generate its answer. Its financial figures come from the deterministic engine and the existing verified-fact placeholder guard. There is no canned runtime model answer. Provider failures remain errors.

Synthetic history is rebuilt from up to twenty approved questions using structured scope, so category and period survive long follow-up chains. Personal and demo chats are isolated: switching modes remounts the session and clears history, scope and consent. New Chat, account changes and cancellation retain their existing reset behavior.

## Provider and configuration errors

Errors now include a stable code and origin, plus providerStatus when a provider HTTP status is available. Raw provider errors, credentials and prompts are not returned or logged.

| Example | Origin | Code |
| --- | --- | --- |
| Missing backend key | configuration | GEMINI_KEY_MISSING |
| Private-context processing not authorized | privacy | GEMINI_PRIVATE_CONTEXT_DISABLED |
| Free-tier wording cannot be safely projected | privacy | SAFE_INTENT_NEEDS_CLARIFICATION |
| Gemini rate/quota rejection | provider | GEMINI_RATE_LIMITED |
| Gemini rejects credentials/permissions | provider | GEMINI_AUTH_FAILED |
| Configured model unavailable | provider | GEMINI_MODEL_UNAVAILABLE |
| Gemini rejects request parameters | provider | GEMINI_REQUEST_REJECTED |
| Invalid/unverified model output | provider | GEMINI_OUTPUT_INVALID |
| Application account quota reached | application | AI_RATE_LIMITED |

The frontend preserves this metadata and distinguishes backend configuration, privacy restrictions and Gemini provider failures in visible messages. A local fallback remains labelled local; a successful intent call is labelled Gemini interpreted · FinSight calculated. A synthetic result is labelled a synthetic Gemini demonstration.

Authentication, anonymous-user restrictions, origin validation, consent, request-size limits, IP/domain limits and shared per-UID usage/concurrency limits remain enforced for both modes.

## SDK verification

The installed official SDK remains @google/genai 2.31.0, backend-only. It uses new GoogleGenAI with GEMINI_API_KEY and models.generateContent with the exact configured model, default gemini-3.8-flash. No fallback model is selected.

The implementation uses responseMimeType=application/json, responseJsonSchema and supported LOW thinking for intent requests, with the existing LOW/MEDIUM explanation choice. No MINIMAL setting is used. SDK attempts, timeout, output bounds and cancellation remain explicit.

This matches Google's [generateContent JavaScript example](https://ai.google.dev/api/generate-content) and the model's documented [structured-output and thinking support](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). Official SDK HTTP serialization is exercised through mocked transports for both the free intent and synthetic response paths.

## Configuration

No new free-tier switch or dependency is required.

- GEMINI_API_KEY: existing backend key; never a VITE_ variable.
- GEMINI_MODEL: existing model configuration, default gemini-3.8-flash.
- GEMINI_DATA_HANDLING: keep disabled or unset for safe intent and synthetic-only model payloads. Set paid only after the operator establishes appropriate paid-service data handling for that API project.
- FIREBASE_PROJECT_ID and permitted origin configuration: retained unchanged.

The key's actual quota and model entitlement are determined by the provider. This change does not enable billing, infer a billing tier from a key, purchase quota or deploy any configuration. A missing/unsupported model or exhausted free quota returns a provider-specific error.

The local environment contained no Gemini key and no configured .env file. No successful live Gemini response is claimed. Existing deployed secret configuration was not accessed or changed.

## Validation and limits

**133 automated tests passed. ESLint passed. Production/PWA build passed.** The existing large-bundle and outdated Browserslist warnings remain.

New tests cover safe requests reaching the official SDK transport, absence of real values/history in model input, exact local scope preservation, synthetic generated responses and long follow-up context, zero demo financial retrieval, private-context bypass rejection, invalid model output, auth/consent/rate limits, error origins/codes, and local answers without a key.

All final provider tests use fake credentials and mocked network transports. They verify wiring and isolation, not live model connectivity or free-tier quota.

The safe free-tier path deliberately cannot interpret arbitrary private wording. Unsupported/ambiguous meaning requires clarification, while paid processing remains gated. Synthetic questions and data are intentionally fixed. Existing 36-month/5,000-record retrieval limits, 50-item lists, bounded conversations, financial arithmetic and output guards remain.

No application or backend server was started, no browser preview was opened, and nothing was deployed. Live financial records and Firestore schema were not modified.

