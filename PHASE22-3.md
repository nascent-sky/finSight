# FinSight Phase 22.3 — Android UPI statement handoff

After Bubblewrap regeneration, the native implementation was restored and its
extension-as-MIME packaging defect corrected. See
[PHASE22-3-ANDROID-RECOVERY.md](PHASE22-3-ANDROID-RECOVERY.md) for the current
version-5 APK validation, successful ADB debug installation and release-signing
commands. The native Bubblewrap configuration now accepts MIME types only;
filename extensions remain in the web manifests.

Android Open with and Share now deliver the actual file to the existing unified
web importer. The optional Excel-time update feature has been removed. All Phase
22.2 parsers, preview editing, ordinary browser uploads, canonical UPI identities,
guest storage, offline transactions and the seven-field Firestore boundary remain.

## Confirmed code gaps and correction

The local `v3.2.0` GPay implementation was inspected through Git history without
checking it out or overwriting current work. It used Android Browser Helper's
multipart `POST /share-target`, the service-worker staging cache and the existing
import page. That path is reused for every provider and supported format.

The current native launcher previously passed intents straight to Browser Helper
2.6.2. Its share reader recognizes SEND/SEND_MULTIPLE and reads `EXTRA_STREAM`;
it does not take a VIEW data URI or a clip-only SEND as that shared stream.
Its separate VIEW file-handling path also checks both read and write permission,
while exported statements commonly grant read permission only. The web importer
consumed a multipart cache handoff, not the separate file-handling API.
Native filters and several manifest copies also lacked XLSX.

On the web side, the handoff was consumed inside the account-keyed import session:
the query was removed and cached bytes deleted before asynchronous parsing.
Firebase resolving the signed-in account could unmount that guest session and
discard the file before a preview appeared. A regression test now covers account
resolution before cache delivery and another account change after delivery.

Reference implementations:
[Browser Helper 2.6.2 SharingUtils](https://github.com/GoogleChrome/android-browser-helper/blob/android-browser-helper-2.6.2/androidbrowserhelper/src/main/java/com/google/androidbrowserhelper/trusted/SharingUtils.java),
[Browser Helper 2.6.2 LauncherActivity](https://github.com/GoogleChrome/android-browser-helper/blob/android-browser-helper-2.6.2/androidbrowserhelper/src/main/java/com/google/androidbrowserhelper/trusted/LauncherActivity.java).

## Resulting file flow

1. Android resolves narrow PDF, CSV and XLSX MIME filters for SEND or content-URI
   VIEW. A one-file SEND_MULTIPLE is supported; multiple distinct files are rejected.
2. The existing launcher normalizes the data URI, `EXTRA_STREAM` and/or ClipData
   into one content-URI stream before Browser Helper reads the intent. Matching
   repeated references to one URI are accepted; conflicting URIs are rejected.
3. The adapter requires a live read grant and an external provider, rejects our
   own provider and `file://` paths, checks known size/MIME metadata and strips
   unrelated text and write/persistable/prefix grants. Generic MIME metadata can
   use the provider's PDF/CSV/XLSX display-name extension. No storage permission,
   native file copy, parser, upload endpoint or new Android import screen is added.
4. Browser Helper uses its existing share target and AndroidX grants read access
   to the selected TWA browser. The browser posts the file as multipart field
   `statement` to the same-origin `/share-target` service-worker handler. Both
   initial and reused-activity launches prepare the intent; reused connections are
   released before creating the next Browser Helper launcher.
5. The worker bounds the incoming multipart body, validates one nonempty supported
   file up to 10 MiB, and stages its bytes in the existing local cache. Each handoff
   has a separate random one-use key; overlapping shares do not overwrite each
   other. File names/content URIs are not placed in navigation URLs. Abandoned
   handoffs expire after five minutes and are purged when the worker wakes.
6. The same import page receives a `File`, preserves it above account-keyed preview
   state, invokes `parseStatementFile()` automatically and displays the ordinary
   editable preview. React StrictMode and authentication resolution do not consume
   the handoff twice. Files are removed from the staging cache even when expired
   or invalid. Legacy `shared=1` GPay handoffs remain readable.
7. Only the user's Import button saves transactions. Provider detection, duplicate
   checks, guest/account handling and offline synchronization use existing services.

MIME types: `application/pdf`, `text/csv`, `application/csv`, and
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`. No broad
`*/*`, `application/*` or `text/*` intent filter was added. Share metadata also
accepts `.pdf`, `.csv` and `.xlsx`. Unsupported/missing transfers show an explicit
error on the import page rather than implying a preview was loaded. A non-TWA
browser fallback that cannot deliver the stream shows a delivery error.

## Timestamp behavior

The Excel-time button, eligibility helper, correction options, conditional updates,
queue correction handling and their obsolete tests were removed. Duplicate imports
never update the saved timestamp, category, note or any other financial field.
New Excel imports still preserve seconds. PDF then Excel keeps the saved PDF time;
Excel then PDF keeps the saved Excel time. Both directions retain reference-based
duplicate/conflict detection and produce no second financial record.

An unsupported command left in a queue by an older development build is retained
with an invalid-payload diagnostic; synchronization never reinterprets it as a new
transaction. This guard performs no timestamp update or data migration.

## Files changed in this phase

The prior Phase 22.2 working-tree implementation was preserved. Phase 22.3 changes:

| File | Purpose |
| --- | --- |
| `finSight-android/app/src/main/java/com/finsight/app/StatementShareIntent.java` | New adapter from external content-URI intents to the existing TWA share stream |
| `finSight-android/app/src/main/java/com/finsight/app/LauncherActivity.java` | Prepare before launch, handle reused intents, trusted import/error routing |
| `finSight-android/app/src/main/AndroidManifest.xml` | Narrow content VIEW and XLSX SEND filters |
| `finSight-android/app/build.gradle` | Generate share resource from TWA JSON; native test dependencies/options |
| `finSight-android/build.gradle` | Maven Central for build/test dependency resolution |
| `finSight-android/twa-manifest.json` | XLSX share MIME and extension |
| `finSight-android/app/src/main/res/raw/web_app_manifest.json` | Matching bundled manifest |
| `public/manifest.json`, `vite.config.js` | Matching static/generated PWA share targets |
| `public/share-target-handler.js` | Bounded multipart handling, XLSX support, isolated one-use cache entries |
| `src/services/statementShareService.js` | New one-use file receiver and sanitized delivery errors |
| `src/pages/TransactionImport.jsx` | Automatic shared-file preview survives auth changes; time action removed |
| `src/services/statementImportModel.js` | Remove time-refinement helper; duplicate semantics preserved |
| `src/services/transactionService.js` | Remove timestamp update/queue command machinery; normal create-if-missing retained |
| `src/services/paytmStatementParser.test.mjs` | Remove obsolete refinement eligibility test |
| `src/services/statementPersistence.test.mjs` | Remove obsolete correction tests; preserve timestamp/duplicate and queue-command guards |
| `src/services/statementImportUI.test.mjs` | Real file-to-preview coverage for all five formats, StrictMode/auth race and no timestamp action |
| `src/services/statementShare.test.mjs` | MIME consistency, actual bytes, isolated/legacy/expired transfers |
| `tests/helpers/statementShareHarness.mjs` | Real worker handler with synthetic multipart requests and cache seam |
| `tests/firestore/statementRules.test.mjs` | Remove correction cases; verify unchanged timestamps and seven-field documents |
| `finSight-android/app/src/test/java/com/finsight/app/StatementShareIntentTest.java` | Native intent, permission policy, metadata and cold/warm lifecycle tests |
| `PHASE22-2.md`, `PHASE22-3.md` | Historical report notice and this current handoff report |

No production Firebase rules/configuration, collection paths, financial records,
release signing material, provider parsers or unrelated app screens were changed
in this phase. No commit, push, installation or deployment was performed.

## Verification

| Check | Result |
| --- | --- |
| `npm test` | **377 passed**, zero failures |
| `npm run test:firestore` | **25 passed**, zero failures; localhost `demo-finsight-rules`, unchanged production-equivalent rules |
| `npm run lint` | Passed |
| `npm run build` | Passed; production and PWA service-worker assets generated |
| `gradlew.bat :app:testDebugUnitTest` | **13 passed**, zero failures, Robolectric Android API 28 |
| `gradlew.bat :app:assembleDebug` | Passed; local debug APK generated |

The browser tests exercise actual multipart bytes through the real service-worker
handler, local receiver, real PDF.js/XLSX/provider adapters and React preview for
GPay PDF, PhonePe PDF, PhonePe CSV, Paytm PDF and Paytm XLSX. They verify that no
financial save occurs before explicit review/import. Native tests exercise actual
Android intent classes, the existing Browser Helper share reader, provider metadata
and read-permission policy, with TWA launch replaced by a test seam. They cover
read-only grants, clip-only shares, multiple/conflicting URIs, missing permission,
own-provider/file-URL rejection, sizes, unknown MIME fallback, generated metadata,
task restart and initial/reused launcher lifecycle.

The JavaScript and Robolectric tests do not replace a physical-device check of
Chrome's URI grant, multipart posting and OS chooser behavior. No physical-device
test or launch of the production app was performed. The existing main-chunk and
Browserslist warnings remain. Gradle reports existing deprecation/SDK-tooling
warnings; the debug build and tests succeed.

## APK/AAB and web rebuild requirements

The local debug artifact is:
`finSight-android/app/build/outputs/apk/debug/app-debug.apk`.
It is debug-signed and intended for a dedicated test installation/profile. Use the
existing release signing key for an update that preserves installed app data.

1. Both the Android wrapper and web/PWA assets must be updated together. Native
   manifest/Java changes require a new APK/AAB; a web update cannot add native
   Open with filters. Conversely, this TWA loads its web app from
   `https://finsight-pwa.netlify.app` and does not bundle the new web JavaScript in
   its APK, so rebuilding/installing the wrapper alone does not update that site.
2. Before publishing an Android update, increase the current versionCode **4** and
   align the version fields in `app/build.gradle` and `twa-manifest.json`. Release
   version/signing settings were not changed as part of these local checks.
3. From `finSight-android`, run `gradlew.bat :app:testDebugUnitTest :app:assembleDebug`
   for local testing. Generate/sign release APK/AAB through the existing Android
   Studio release process (or configured `:app:assembleRelease :app:bundleRelease`).
   A release bundle was not signed or published here.
4. Keep the existing verified HTTPS origin, package and signing-key Digital Asset
   Links association. Open the updated FinSight web/TWA once online so the active
   service worker and parser assets are installed. Process-cold/offline launches
   can then use that existing registration and precache. A fresh browser profile
   without an installed service worker cannot receive this local multipart handoff
   offline; it must be initialized online first. This is the retained GPay TWA
   share architecture, not a new network file-import endpoint.
5. Preserve these custom Java files when using Bubblewrap regeneration: the
   generated launcher template alone does not contain the new adapter.

Web deployment, Play upload and production installation require separate approval
and were not attempted. For isolated device tests, use matching approved web assets
on a verified test origin/build rather than assuming the local APK changes the
currently deployed web code.

## Necessary device tests

- With matching builds and an initialized service worker, Open with and Share one
  GPay PDF, PhonePe PDF/CSV and Paytm PDF/XLSX. Each must immediately show provider,
  format, totals and editable transaction preview without pressing Select file.
- Repeat while FinSight/Chrome are already open, and after stopping/relaunching
  the app. Share another file after returning to the source app. Confirm the new
  file's preview replaces the old document rather than reusing stale bytes.
- Verify signed-in startup, guest startup and sign-in resolution during delivery.
  No transaction should save merely because a file was opened.
- Repeat offline after installation/cache warm-up. Review/import, reconnect and
  synchronize through the existing queue. Reimport matching PDF/Excel or PDF/CSV:
  expect duplicates and an unchanged saved timestamp, including Excel seconds
  when Excel was imported first.
- Exercise a source granting read access only, clip-only SEND where available,
  a cancelled/missing-grant share, multiple files and a file over 10 MiB. Valid
  single-file inputs must reach preview; invalid inputs must show an error without
  private paths/details in logs or a financial write.

The five supported statement formats are unchanged; native chooser behavior still
depends on the exporting app declaring a supported MIME type and granting access
to its content URI. No broad all-file handler was registered to compensate for
unrelated or incorrectly advertised formats.
