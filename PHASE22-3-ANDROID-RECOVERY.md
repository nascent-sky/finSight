# Android recovery after Bubblewrap regeneration

## Confirmed package-parsing failure

The original `finSight-android/app-release-signed.apk` is versionCode/versionName
**5**, package **com.finsight.app**, minSdk **21**, targetSdk **36**. Its ZIP and
signatures are readable; `apksigner verify` succeeds with v1/v2/v3 signatures.

Its binary Android manifest contains these invalid values:

```xml
<data android:mimeType=".pdf" />
<data android:mimeType=".csv" />
<data android:mimeType=".xlsx" />
```

Bubblewrap copied filename extensions from the web `shareTarget.accept` list into
native Android MIME attributes. Web acceptance lists allow extensions; Android
intent-filter MIME attributes require MIME types. The Android framework's binary
`PackageParser` reproduced the original failure as **-108
(INSTALL_PARSE_FAILED_MANIFEST_MALFORMED)** with
**IntentFilter.MalformedMimeTypeException: .pdf**. This is independent of signing.
The corrected manifest keeps four valid MIME types and supports content-URI VIEW
plus SEND/SEND_MULTIPLE. Extensions remain in web share metadata where valid.

The native `twa-manifest.json` share accept list is now MIME-only as well, so
Bubblewrap cannot copy `.pdf`, `.csv` or `.xlsx` back into native MIME attributes.
The public and bundled web manifests keep their valid extension accept entries.

Relevant specifications: [Android data/MIME attributes](https://developer.android.com/guide/topics/manifest/data-element),
[APK signing verification](https://developer.android.com/tools/apksigner).

## Lost code restored

Regeneration replaced the Phase 22.3 launcher with the plain template and removed
`StatementShareIntent.java` and the native tests. It also removed the voice/widget
sources, declarations, permission and resources. The recovery restores:

- Initial and reused launcher preparation, trusted import/error navigation and
  Browser Helper connection cleanup.
- VIEW data URI, EXTRA_STREAM and ClipData normalization to the existing GPay
  multipart share path, with read-only permission forwarding, one-file/MIME/size
  checks, own-provider/file-URL rejection and sanitized failures.
- Native VIEW and SEND filters for PDF, CSV and XLSX, with no extension-only or
  broad wildcard MIME attributes.
- Native test setup, Maven Central and generated share JSON derived from the
  existing TWA manifest.
- Original `ExpenseWidget` and `VoiceInputActivity` code, RECORD_AUDIO permission,
  activity/receiver declarations and widget layout/drawables/day/night colors.
  Unchanged original widget/voice files were recovered individually from local
  Git; no checkout/reset of the project or web importer was performed.

Package name, versionCode 5, versionName 5, minSdk 21, targetSdk 36, signing alias
`android` and the existing keystore are preserved. SHA-256 snapshots verify the
keystore is byte-for-byte unchanged. Only the native accept list was narrowed in
the TWA configuration; package/version/signing values are unchanged.
Existing Phase 22.2/22.3 web work remains intact; the Excel-time action
has not been reintroduced.

## Validation and artifacts

The release APK was rebuilt directly using Gradle, without Bubblewrap:

```powershell
cd finSight-android
.\gradlew.bat --offline --no-daemon :app:assembleRelease :app:testDebugUnitTest `
  '-PfinsightValidationApk=../app-release-signed.apk' `
  '-PfinsightExpectValidApk=false'
```

This runs the restored intent/lifecycle tests, a new extension-as-MIME regression,
and the expected rejection of the original malformed APK. The rebuilt unsigned
release then passes the Android binary package parser with the preserved identity
and SDK constraints. ZIP CRC, required APK entries and 16 KiB alignment also pass.
Release R8 mapping includes the restored URI adapter, launcher, widget and voice
activity. A debug APK rebuild succeeds as well.

`npm test` passes **377 tests**. `npm run lint` passes. The web/native consistency
test now rejects extension-only native MIME entries and checks the custom launcher
and URI adapter are present, so regeneration damage is detected outside the
generated Android directory as well.

The custom password helper did not complete signing and has been removed. As
requested, signing is left to the direct Android SDK command in the user's own
interactive PowerShell terminal. No passwords were provided in chat or stored in
the repository. The validated, aligned unsigned release is ready at:

`finSight-android/app-release-unsigned-phase22-3-fixed-aligned.apk`

The signing command below will create this distinct output filename:

`finSight-android/app-release-signed-phase22-3-fixed.apk`

The old `app-release-signed.apk` is retained for comparison and still has the
malformed manifest. The original AAB is also retained and was not rebuilt or
published by this recovery. Use the corrected filename for the repaired APK.

This corrected signed release has **not yet been produced**; the existing signed
APK remains the old malformed artifact. The debug APK is signed using the normal
debug key and has successfully installed on Android API 35 via ADB.

### Final checks

| Check | Result |
| --- | --- |
| Direct Gradle debug/release assembly | Passed |
| Restored native intent/lifecycle and MIME tests | 14 passed |
| Binary package parser on corrected release | 1 passed; original rejection reproduced separately |
| Web tests | 377 passed |
| ESLint | Passed |
| Debug APK ADB install on API-35 emulator | **Success** |
| Installed debug identity | com.finsight.app, versionCode/name 5, minSdk 21, targetSdk 36 |
| Android VIEW/SEND resolution | All four MIME types resolve to LauncherActivity |
| Release ZIP CRC / required entries / alignment | Passed |
| Existing keystore preservation | SHA-256 unchanged |
| Corrected release signing | Pending the user's direct local password entry |

### Direct PowerShell release signing

From `C:\Users\Niicheon\Project\FinSight`, run:

```powershell
$tools = 'C:\Users\Niicheon\AppData\Local\Android\Sdk\build-tools\36.0.0'
& "$tools\apksigner.bat" sign --ks '.\finSight-android\android.keystore' --ks-key-alias android --v4-signing-enabled false --out '.\finSight-android\app-release-signed-phase22-3-fixed.apk' '.\finSight-android\app-release-unsigned-phase22-3-fixed-aligned.apk'
& "$tools\apksigner.bat" verify --verbose --print-certs '.\finSight-android\app-release-signed-phase22-3-fixed.apk'
& "$tools\zipalign.exe" -c -P 16 4 '.\finSight-android\app-release-signed-phase22-3-fixed.apk'
```

Enter the existing passwords only at the SDK prompts. The expected original
release-certificate SHA-256 is:

`8a2b9fc2cdf746860f9da5562e9c0e13133308703cc0fbabbeb283b8413ca96e`

Verification must succeed and show this same signer before using the release APK
as an update. The unsigned APK cannot be installed until signed. The debug APK is
for emulator/testing; an installed release app requires the original release key.

To rebuild again without regeneration:

```powershell
Push-Location .\finSight-android
.\gradlew.bat --offline --no-daemon :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest '-PfinsightValidationApk=build/outputs/apk/release/app-release-unsigned.apk' '-PfinsightExpectValidApk=true'
Pop-Location
& "$tools\zipalign.exe" -f -P 16 4 '.\finSight-android\app\build\outputs\apk\release\app-release-unsigned.apk' '.\finSight-android\app-release-unsigned-phase22-3-fixed-aligned.apk'
```

## Files changed by the recovery

- `finSight-android/app/src/main/java/com/finsight/app/LauncherActivity.java`
- `finSight-android/app/src/main/java/com/finsight/app/StatementShareIntent.java`
- `finSight-android/app/src/main/AndroidManifest.xml`
- `finSight-android/app/build.gradle`
- `finSight-android/build.gradle`
- `finSight-android/app/src/test/java/com/finsight/app/StatementShareIntentTest.java`
- `finSight-android/app/src/test/java/com/finsight/app/ApkPackageValidationTest.java`
- `src/services/statementShare.test.mjs`
- `finSight-android/twa-manifest.json` (native MIME-only accept list)
- `.gitignore` (temporary recovery diagnostics)
- This report.

The eight widget/voice source/resource files listed above were restored to their
previous Git contents and no longer appear as deletions in the working tree.
The regenerated `manifest-checksum.txt` and bundled raw web manifest were left as
found. The TWA JSON retains version 5 and the original package/key; its accept
list now excludes native-invalid extensions. No version bump was reverted.

## Rebuild and manual testing

Use Gradle/Android Studio against the restored sources. Do not accept another
Bubblewrap regeneration over these custom files. Android MIME attributes must
contain `application/pdf`, `text/csv`, `application/csv` or the XLSX MIME type;
extension-only values belong solely in web share metadata.

After local signing, verify that the new release uses the same certificate as the
original Bubblewrap APK. An installed app signed with a different certificate
requires separate investigation; this recovery never replaces the signing key or
uninstalls an existing production app. Following the user's request, the corrected
debug APK was installed successfully on a separate headless API-35 emulator running
with `-read-only -no-snapshot`. FinSight was not launched. The saved emulator profile
and production financial records were not modified. No production deployment occurred.

Manual checks on the intended Android device remain: install the corrected
same-key update, then test GPay PDF, PhonePe PDF/CSV and Paytm PDF/XLSX with Open with
and Share, cold/warm app state, and read-only URI grants. The TWA still loads the
configured web origin, so its deployed web/PWA must contain the matching Phase 22.3
receiver and have an initialized service worker. No web deployment or financial
record changes were performed here.
