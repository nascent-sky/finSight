import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileText, Upload } from "lucide-react"
import Card from "../components/ui/Card"
import CategorySelect from "../components/transactions/CategorySelect"
import { useTheme } from "../context/ThemeContext"
import { parseStatementFile } from "../services/statementImportService"
import { annotateImportDuplicates, getImportDocumentId, getImportIdentityKeys, parseStatementDatetime, STATEMENT_ACCEPT, toImportPayload } from "../services/statementImportModel"
import { receiveSharedStatement } from "../services/statementShareService"
import { saveImportedTransactionWithId, subscribeToTransactions, syncPendingTransactions } from "../services/transactionService"
import { diagnoseImportError, groupImportFailures, IMPORT_SAVE_STAGES, importResultTitle, importSaveError } from "../services/transactionImportErrors"

const money = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const localDatetime = (iso) => new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 19)
const fieldClass = "theme-input w-full min-w-0 rounded-lg border px-3 py-2 text-sm"
const ImportFailures = ({ failures }) => <ul className="mt-3 space-y-2 text-sm text-red-700 dark:text-red-300" aria-label="Import failure diagnostics">
  {groupImportFailures(failures).map((failure) => <li key={`${failure.code}:${failure.stage}`}>
    <p>{failure.rows.length ? `Transaction${failure.rows.length === 1 ? "" : "s"} ${failure.rows.slice(0, 10).join(", ")}${failure.rows.length > 10 ? ` and ${failure.rows.length - 10} more` : ""}: ` : "Queued transactions: "}{failure.message}</p>
    <p className="mt-1 text-xs">Code: {failure.code} · Stage: {IMPORT_SAVE_STAGES[failure.stage]}</p>
  </li>)}
</ul>

const ImportSession = ({ user, sharedFile, sharedError }) => {
  const inputRef = useRef(null), sharedLoaded = useRef(false), active = useRef(true)
  const [fileName, setFileName] = useState("")
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState([])
  const [history, setHistory] = useState({ records: [], ready: false, error: "" })
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [lookupAttempt, setLookupAttempt] = useState(0)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  useEffect(() => subscribeToTransactions(
    (records, metadata) => setHistory({ records, ready: metadata?.isReady ?? true, error: "" }),
    (problem) => { const diagnostic = diagnoseImportError(problem, "firestore-read"); setHistory((previous) => ({ ...previous, ready: false, error: `${diagnostic.message} Code: ${diagnostic.code}. Stage: ${IMPORT_SAVE_STAGES[diagnostic.stage]}.` })) },
  ), [lookupAttempt])

  const parseFile = useCallback(async (file) => {
    setFileName(file.name)
    setResult(null)
    setImportResult(null)
    setAcknowledged(false)
    setError("")
    setIsParsing(true)
    try {
      const parsed = await parseStatementFile(file)
      if (!active.current) return
      setResult(parsed)
      setSelected(parsed.transactions.map(() => true))
    } catch (parseError) {
      if (active.current) setError(parseError?.message || "The statement could not be parsed.")
    } finally { if (active.current) setIsParsing(false) }
  }, [])

  useEffect(() => {
    if (!sharedFile || sharedLoaded.current === sharedFile) return
    sharedLoaded.current = sharedFile
    void parseFile(sharedFile)
  }, [sharedFile, parseFile])

  const rows = useMemo(() => {
    const transactions = result?.transactions || []
    const duplicates = annotateImportDuplicates(transactions, history.records)
    const pendingIdentities = new Set(history.records.filter((record) => record.pending).flatMap(getImportIdentityKeys))
    return transactions.map((transaction, index) => {
      let validation = ""
      try { toImportPayload(transaction) } catch (problem) { validation = problem.message }
      return { transaction, ...duplicates[index], queuedDuplicate: duplicates[index].duplicate && getImportIdentityKeys(transaction).some((key) => pendingIdentities.has(key)), validation, selected: selected[index] }
    })
  }, [result, history.records, selected])
  const approved = rows.filter((row) => row.selected && !row.duplicate && !row.conflict && !row.validation)
  const summary = rows.reduce((totals, { transaction }) => {
    const amount = Number(transaction.amount)
    if (Number.isFinite(amount)) totals[transaction.type] += Math.round(amount * 100)
    return totals
  }, { expense: 0, income: 0 })
  const duplicateCount = rows.filter((row) => row.duplicate && !row.queuedDuplicate).length
  const alreadyQueuedCount = rows.filter((row) => row.queuedDuplicate).length
  const pendingCount = history.records.filter((record) => record.pending).length
  const busy = isParsing || isImporting || isSyncing
  const needsAcknowledgement = Boolean(result?.parseErrors.length || result?.warnings.length)
  const updateRow = (index, updates) => {
    setResult((previous) => ({ ...previous, transactions: previous.transactions.map((transaction, position) => position === index ? { ...transaction, ...updates } : transaction) }))
    setImportResult(null)
  }
  const handleImport = async () => {
    if (!approved.length || busy || !history.ready || (needsAcknowledgement && !acknowledged)) return
    setIsImporting(true)
    setImportResult(null)
    setError("")
    const counts = { imported: 0, duplicates: duplicateCount, failed: 0, pending: 0, alreadyQueued: alreadyQueuedCount, failures: [] }, savedRows = []
    for (const row of approved) {
      if (!active.current) break
      try {
        let transaction
        try { transaction = toImportPayload(row.transaction) }
        catch (problem) { throw importSaveError(problem, "validation") }
        const saved = await saveImportedTransactionWithId(getImportDocumentId(transaction), transaction, { expectedUid: user?.uid ?? null })
        if (!active.current) break
        if (saved.created) { if (saved.pending) counts.pending++; else counts.imported++ }
        else if (saved.pending) counts.alreadyQueued++
        else counts.duplicates++
        savedRows.push(rows.indexOf(row))
      } catch (problem) { counts.failed++; counts.failures.push({ row: rows.indexOf(row) + 1, ...diagnoseImportError(problem) }) }
    }
    if (!active.current) return
    setSelected((previous) => previous.map((value, index) => savedRows.includes(index) ? false : value))
    setImportResult(counts)
    setIsImporting(false)
  }

  const handleSync = async () => {
    if (busy || !user?.uid) return
    if (!navigator.onLine) { setSyncResult({ offline: true }); return }
    setIsSyncing(true)
    setSyncResult(null)
    try {
      const synced = await syncPendingTransactions(user)
      if (active.current) setSyncResult(synced)
    } catch (problem) {
      if (active.current) setSyncResult({ synced: 0, duplicates: 0, failed: pendingCount, failures: [diagnoseImportError(problem, "synchronization")] })
    } finally { if (active.current) setIsSyncing(false) }
  }

  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="theme-hero rounded-2xl p-6 shadow-lg">
      <h1 className="text-3xl font-bold">Import UPI Statement</h1>
      <p className="mt-2 opacity-90">Google Pay PDF · PhonePe PDF or CSV · Paytm PDF or Excel (XLSX)</p>
    </div>
    <Card padding="lg">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="theme-text font-semibold">Select your statement</h2>
          <p className="theme-muted-text mt-1 text-sm">Processed locally on this device. Up to 10 MB and 10,000 transactions.</p>
          {fileName && <p className="theme-muted-text mt-2 flex items-center gap-2 break-all text-xs"><FileText size={14} />{fileName}</p>}
        </div>
        <input ref={inputRef} type="file" aria-label="Statement PDF, CSV or XLSX" accept={STATEMENT_ACCEPT} disabled={busy} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void parseFile(file) }} />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="theme-button-primary flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"><Upload size={17} />{isParsing ? "Parsing…" : "Select PDF, CSV or XLSX"}</button>
      </div>
    </Card>
    {error && <Card><p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p></Card>}
    {sharedError && <Card><p role="alert" className="text-sm text-red-700 dark:text-red-300">{sharedError}</p></Card>}
    {isParsing && <Card><p role="status" className="theme-muted-text">Reading the statement locally…</p></Card>}
    {history.error && <Card><p role="alert">{history.error}</p><button type="button" className="theme-accent-text mt-2" onClick={() => setLookupAttempt((value) => value + 1)}>Retry duplicate check</button></Card>}
    {user?.uid && pendingCount > 0 && <Card>
      <p className="theme-muted-text text-sm">{pendingCount} transactions are saved on this device and waiting for Firestore synchronization.</p>
      <button type="button" disabled={busy} className="theme-button-primary mt-3 rounded-lg px-4 py-2 text-sm disabled:opacity-60" onClick={handleSync}>{isSyncing ? "Synchronizing…" : "Retry pending sync"}</button>
    </Card>}
    {syncResult && <Card>
      <h2 className="theme-text font-semibold">{syncResult.offline ? "Waiting for connection" : syncResult.failed ? "Synchronization failed" : "Synchronization checked"}</h2>
      <p role="status" className="theme-muted-text mt-2 text-sm">{syncResult.offline ? "Queued transactions remain saved on this device. Connect to synchronize them." : `${syncResult.synced} synced · ${syncResult.duplicates} already saved · ${syncResult.failed} failed`}</p>
      {syncResult.failures?.length > 0 && <><p className="theme-muted-text mt-2 text-sm">Unsent records remain in the offline queue for retry.</p><ImportFailures failures={syncResult.failures} /></>}
    </Card>}
    {result && <>
      <p className="theme-muted-text text-sm">Detected {{ phonepe: "PhonePe", paytm: "Paytm", gpay: "Google Pay" }[result.provider]} · {result.format.toUpperCase()} · {rows.length} transactions</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Debits", `${rows.filter(({ transaction }) => transaction.type === "expense").length} · ${money(summary.expense)}`],
          ["Credits", `${rows.filter(({ transaction }) => transaction.type === "income").length} · ${money(summary.income)}`],
          ["Duplicates", rows.filter((row) => row.duplicate).length],
          ["Needs review", result.parseErrors.length + rows.filter((row) => row.conflict || row.validation).length],
        ].map(([label, value]) => <Card key={label} className="text-center"><p className="theme-text font-bold">{value}</p><p className="theme-muted-text mt-1 text-xs">{label}</p></Card>)}
      </div>
      {result.excludedTopUps > 0 && <p className="theme-muted-text text-sm">{result.excludedTopUps} UPI Lite top-ups excluded.</p>}
      {!history.ready && !history.error && <p role="status">Checking saved transactions for duplicates…</p>}
      {typeof navigator !== "undefined" && !navigator.onLine && <p className="theme-muted-text text-sm">Offline duplicate checks use cached history. Queued imports are checked again when syncing.</p>}
      {(result.parseErrors.length > 0 || result.warnings.length > 0) && <Card>
        <h2 className="theme-text font-semibold">Parsing warnings</h2>
        <ul className="theme-muted-text mt-2 list-inside list-disc space-y-1 text-sm">{[...result.parseErrors, ...result.warnings].map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        <label className="theme-text mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} />I reviewed these warnings and the selected records. Exclude unreadable records.</label>
      </Card>}
      {rows.length === 0 ? <Card><p className="theme-text">No complete, importable transactions found.</p></Card> : <>
        <section className="space-y-3" aria-label="Parsed transaction preview">
          {rows.map(({ transaction, duplicate, queuedDuplicate, conflict, validation, selected: checked }, index) => <Card key={index}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label className="theme-text flex items-center gap-2 font-semibold"><input type="checkbox" aria-label={`Import transaction ${index + 1}`} checked={Boolean(checked) && !duplicate && !conflict} disabled={busy || duplicate || conflict} onChange={(event) => setSelected((previous) => previous.map((value, position) => position === index ? event.target.checked : value))} />Transaction {index + 1}</label>
              {duplicate && <span className="theme-muted-text text-sm">{queuedDuplicate ? "Already queued — excluded" : "Duplicate — excluded"}</span>}
              {conflict && <span role="alert" className="text-sm text-red-700 dark:text-red-300">Reference conflict — review existing transaction</span>}
            </div>
            <fieldset disabled={busy || duplicate || conflict} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="theme-muted-text space-y-1 text-sm">Person<input aria-label={`Person ${index + 1}`} value={transaction.person} className={fieldClass} onChange={(event) => updateRow(index, { person: event.target.value })} /></label>
              <label className="theme-muted-text space-y-1 text-sm">Amount (₹)<input aria-label={`Amount ${index + 1}`} type="number" min="0.01" step="0.01" value={transaction.amount} className={fieldClass} onChange={(event) => updateRow(index, { amount: event.target.value })} /></label>
              <label className="theme-muted-text space-y-1 text-sm">Date and time (India)<input aria-label={`Date and time ${index + 1}`} type="datetime-local" step="1" value={transaction.datetime ? localDatetime(transaction.datetime) : ""} className={fieldClass} onChange={(event) => { const [date, time] = event.target.value.split("T"); let datetime = ""; try { datetime = parseStatementDatetime(date, time) } catch { /* Invalid edits remain blocked. */ } updateRow(index, { datetime }) }} /></label>
              <label className="theme-muted-text space-y-1 text-sm">Direction<select aria-label={`Direction ${index + 1}`} className={fieldClass} value={transaction.type} onChange={(event) => updateRow(index, { type: event.target.value })}><option value="expense">Debit · Expense</option><option value="income">Credit · Income</option></select></label>
              <CategorySelect value={transaction.category} onChange={(event) => updateRow(index, { category: event.target.value })} />
              <label className="theme-muted-text space-y-1 text-sm">Note<input aria-label={`Note ${index + 1}`} value={transaction.note} className={fieldClass} onChange={(event) => updateRow(index, { note: event.target.value })} /></label>
            </fieldset>
            <p className="theme-muted-text mt-3 break-all text-xs">{transaction.transactionId && `Transaction ID: ${transaction.transactionId} · `}UPI / UTR: {transaction.utr || transaction.upiTransactionId || "Unavailable"}{transaction.paymentInstrument && ` · ${transaction.paymentInstrument}`}</p>
            {transaction.sourceDetails && <details className="theme-muted-text mt-2 break-words text-xs"><summary>Source details</summary>{Object.entries(transaction.sourceDetails).map(([key, value]) => <p key={key}>{key}: {value}</p>)}</details>}
            {validation && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{validation}</p>}
          </Card>)}
        </section>
        <div className="space-y-2">
          {(duplicateCount > 0 || alreadyQueuedCount > 0) && <p className="theme-muted-text text-sm">{duplicateCount} already imported · {alreadyQueuedCount} already queued · {approved.length} new transactions selected</p>}
          <button type="button" disabled={busy || !history.ready || !approved.length || (needsAcknowledgement && !acknowledged)} onClick={handleImport} className="theme-button-primary rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-60">{isImporting ? "Importing Transactions…" : `Import ${approved.length} Transactions`}</button>
          {rows.some((row) => row.selected && row.validation) && <p className="theme-muted-text text-sm">Invalid records are excluded. Correct or deselect them before continuing.</p>}
          {!user?.uid && <p className="theme-muted-text text-sm">Guest imports are saved on this device and can be merged after sign-in.</p>}
        </div>
      </>}
      {importResult && <Card><h2 className="theme-text font-semibold">{importResultTitle(importResult)}</h2><p role="status" className="theme-muted-text mt-2 text-sm">{importResult.imported} imported · {importResult.duplicates} already imported · {importResult.failed} failed</p>{importResult.pending > 0 && <p className="theme-muted-text mt-2 text-sm">{importResult.pending} saved on this device and waiting to sync.</p>}{importResult.alreadyQueued > 0 && <p className="theme-muted-text mt-2 text-sm">{importResult.alreadyQueued} already queued on this device.</p>}{importResult.failed > 0 && <><ImportFailures failures={importResult.failures} /><p className="theme-muted-text mt-2 text-sm">Failed records remain selected. Correct the reported problem, then retry. Saved records are checked for duplicates.</p></>}</Card>}
    </>}
  </div>
}

const TransactionImport = () => {
  const { user } = useTheme()
  // Keep the actual File above the account-keyed preview. Resolving Firebase
  // sign-in must not consume a handoff in a guest session that then unmounts.
  const request = useRef(null)
  const [shared, setShared] = useState({ file: null, error: "" })
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("shared")
    if (!token) return
    let mounted = true
    request.current ||= receiveSharedStatement(token)
    const clearQuery = () => {
      const url = new URL(window.location.href)
      url.searchParams.delete("shared")
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
    }
    request.current.then((file) => {
      if (mounted) { setShared({ file, error: "" }); clearQuery() }
    }).catch((problem) => {
      if (mounted) { setShared({ file: null, error: problem.message }); clearQuery() }
    })
    return () => { mounted = false }
  }, [])
  return <ImportSession key={user?.uid || "guest"} user={user} sharedFile={shared.file} sharedError={shared.error} />
}
export default TransactionImport
