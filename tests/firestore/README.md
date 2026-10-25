# Isolated production-rules regression tests

`production.rules` is an unchanged copy of the rules supplied by the user from
Firebase Console. It is only a local test fixture. There is no deploy configuration.

Run `npm run test:firestore` with Java 17+ and the Firestore Emulator 1.19.8 JAR
at `tmp/emulators/cloud-firestore-emulator-v1.19.8.jar`, or set
`FIRESTORE_EMULATOR_JAR` to that verified JAR. The runner checks its size and MD5
against the [official Firebase CLI v13.35.1 manifest](https://github.com/firebase/firebase-tools/blob/v13.35.1/src/emulator/downloadableEmulators.ts).

Download: [official Firestore Emulator 1.19.8](https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar)

- Size: `63634791` bytes
- MD5: `9b43a6daa590678de9b7df6d68260395`

The runner binds localhost on a free port, loads only this rules fixture and
uses the synthetic `demo-finsight-rules` project. It stops its own emulator on
completion. The tests use the real client SDK, synthetic authenticated users,
and the actual transaction service. They never initialize the application's
Firebase configuration or use an Admin SDK that bypasses the rules.

The v3.2.0 implementation is read with `git show` and bundled in memory for a
baseline comparison; no files are checked out or overwritten. The pre-fix
metadata payload is explicitly rejected, while the seven-field baseline/current
GPay and PhonePe writes, guest merges, offline sync and cross-provider duplicates
are exercised against the same rules. Legacy queries and collection-group
authorization are tested separately to avoid attributing their behavior to an
owner-scoped transaction read.
