// Starts only an isolated Firestore rules emulator. Never starts FinSight,
// hosting, Authentication, a browser or any production Firebase connection.
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { readFile, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const root = fileURLToPath(new URL("../../", import.meta.url))
const jar = resolve(root, process.env.FIRESTORE_EMULATOR_JAR || "tmp/emulators/cloud-firestore-emulator-v1.19.8.jar")
const rules = fileURLToPath(new URL("../fixtures/firestore/production.rules", import.meta.url))
const project = "demo-finsight-rules"
try {
  if ((await stat(jar)).size !== 63634791 || createHash("md5").update(await readFile(jar)).digest("hex") !== "9b43a6daa590678de9b7df6d68260395") throw new Error("Emulator JAR checksum mismatch.")
} catch {
  throw new Error("A verified Firestore Emulator 1.19.8 JAR is required. See tests/firestore/README.md.")
}
const reserve = createServer()
await new Promise((resolve, reject) => { reserve.once("error", reject); reserve.listen(0, "127.0.0.1", resolve) })
const port = reserve.address().port
await new Promise((resolve) => reserve.close(resolve))
const emulator = spawn("java", ["-jar", jar, "--host", "127.0.0.1", "--port", String(port), "--rules", rules, "--project_id", project, "--single_project_mode", "--single_project_mode_error", "--websocket_port", "0"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
let logs = "", startError
emulator.on("error", (error) => { startError = error })
for (const stream of [emulator.stdout, emulator.stderr]) stream.on("data", (chunk) => { logs = (logs + String(chunk)).slice(-12000) })
try {
  const deadline = Date.now() + 45000
  let ready = false
  while (Date.now() < deadline) {
    if (startError) throw startError
    if (emulator.exitCode !== null) throw new Error(`Firestore emulator exited before startup.\n${logs}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/emulator/v1/projects/${project}:ruleCoverage`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) { ready = true; break }
    } catch { /* The rules emulator is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!ready) throw new Error(`Firestore emulator did not become ready.\n${logs}`)
  const tests = spawn(process.execPath, ["--test", "tests/firestore/statementRules.test.mjs"], { cwd: root, env: { ...process.env, FIRESTORE_EMULATOR_HOST: `127.0.0.1:${port}`, FINSIGHT_RULES_TEST_PROJECT: project }, stdio: "inherit", windowsHide: true })
  process.exitCode = await new Promise((resolve, reject) => { tests.once("error", reject); tests.once("exit", (code) => resolve(code ?? 1)) })
} finally {
  emulator.kill()
  await new Promise((resolve) => { if (emulator.exitCode !== null) resolve(); else emulator.once("exit", resolve) })
}
