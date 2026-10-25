# Development eligibility investigation — 2026-10-25

The reported `DEVELOPMENT_DISABLED` reason is emitted only when
`env.GEMINI_DATA_HANDLING !== "development"` in `financeCapabilities`.
It is an application policy result, not a Gemini provider error. UID matching,
fictional-data confirmation, consent and missing credentials have separate checks.

## Verified deployment mismatch

A read-only audit of the locally linked Netlify site found these timestamps
(2026-10-25, IST / UTC+05:30):

| Event | Time |
| --- | --- |
| Current production deploy published | 08:52:30 |
| `GEMINI_API_KEY` last updated | 09:03:15 |
| `GEMINI_DATA_HANDLING` last updated | 09:25:22 |
| `GEMINI_DEVELOPMENT_DATA` last updated | 09:26:00 |
| `AI_ALLOWED_ORIGIN` last updated | 09:26:58 |
| `GEMINI_DEVELOPMENT_UIDS` last updated | 09:32:09 |

All seven required variables are currently present in the production Functions
scope. The saved mode and fictional-data values match the required strings
exactly; the allowlist contains one entry. These saved settings were updated
after the currently published deployment. The old runtime's literal mode value
was not obtained: the reported reason establishes that it was not exactly
`development`.

[Netlify snapshots function environment values at deployment](https://docs.netlify.com/build/functions/environment-variables/#overrides-and-limitations).
Updating saved settings does not update an already deployed function. A subsequent
deployment is required to apply those settings. No settings were changed and no
deployment was performed during this investigation.

The CLI uploads the local project and functions; GitHub pushes are unnecessary.
For the next operator-authorized deployment, explicitly select the production
build environment as well as the production destination:

```sh
npx netlify deploy --prod --context production
```

[`--prod` selects the live destination; `--context` selects build environment values and defaults to `dev`](https://cli.netlify.com/commands/deploy/).
This context distinction is not the cause of the reported mode failure: the
saved mode flags currently match in both contexts, and the published deploy's
context is production. Production context itself does not disable development AI.
Function runtime variables are read through the supported `process.env` API.

## Safe backend diagnostics

Authenticated capability and route-policy responses now include `diagnostics`.
Errors also include it after successful origin, authentication and JSON checks.
Responses remain `Cache-Control: no-store`; nothing is logged.

| Field | Possible values |
| --- | --- |
| `backendRevision` | `finance-policy-diagnostics-2026-10-25` |
| `dataHandling` | `development`, `paid`, `disabled`, `missing`, `unrecognized` |
| `fictionalData` | `fictional`, `missing`, `unrecognized` |
| `uidAllowlist` | `matched`, `not_matched`, `not_configured` |
| `geminiKey` | `configured`, `missing` |
| `geminiModel` | `configured`, `default` |
| `cloudConsent` | `enabled`, `disabled`, `not_evaluated` |

The existing `routingVersion` still detects incompatible frontend/function
protocols. `backendRevision` distinguishes this diagnostic-capable backend from
older implementations using the same protocol. Neither value claims that the
saved Netlify settings have reached a previously deployed function. Netlify build
context variables are not assumed to exist at function runtime.

Parsing remains deliberately strict: privacy flags require exact lowercase values
without quotes or extra whitespace. UID entries are comma/whitespace separated,
case sensitive, and matched against the verified Firebase token, never a submitted
UID. The allowlist, identifiers, credentials, unknown configuration values,
questions and financial records are never returned by diagnostics. Capability
discovery does not assert consent; routing requires `consent === true`.

No UI or eligibility protections were changed. Ordinary protected processing,
paid handling, origin/authentication checks, quotas and provider error behavior
remain intact. No additional environment variables are required.

## Validation and limits

All 174 automated tests passed, including seven new diagnostic regression tests.
ESLint and the production build passed. Existing bundle-size and Browserslist
warnings remain. Provider transport is mocked in tests; no live Gemini call or
authenticated deployed chat request was made. The current user's UID membership
and consent were not independently verified without their authenticated request.
No application, Netlify Dev or browser preview was started; nothing was deployed.
