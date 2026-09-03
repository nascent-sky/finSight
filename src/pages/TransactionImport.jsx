import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { FileText, Tag, Upload } from "lucide-react"

import Card from "../components/ui/Card"
import { useTheme } from "../context/ThemeContext"
import { parseGooglePayStatement } from "../services/gpayStatementParser"
import { saveImportedTransactionWithId } from "../services/transactionService"

const formatAmount = (amount) =>
  Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 })

const formatDatetime = (datetime) =>
  new Date(datetime).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  })

const SHARED_PDF_CACHE = "finsight-shared-pdf-v1"
const SHARED_PDF_CACHE_PATH = "/__finsight_shared_pdf__"

const TransactionImport = () => {
  const { user } = useTheme()
  const inputRef = useRef(null)
  const hasLoadedSharedPdf = useRef(false)
  const [fileName, setFileName] = useState("")
  const [result, setResult] = useState(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [error, setError] = useState("")

  const summary = useMemo(() => {
    const transactions = result?.transactions ?? []

    return {
      total: transactions.length,
      expenses: transactions.filter((transaction) => transaction.type === "expense").length,
      income: transactions.filter((transaction) => transaction.type === "income").length,
    }
  }, [result])

  const parseFile = useCallback(async (file) => {
    setFileName(file.name)
    setResult(null)
    setImportResult(null)
    setError("")

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Select a valid PDF file.")
      return
    }

    setIsParsing(true)

    try {
      setResult(await parseGooglePayStatement(file))
    } catch (parseError) {
      setError(parseError?.message || "The statement could not be parsed.")
    } finally {
      setIsParsing(false)
    }
  }, [])

  useEffect(() => {
    const sharedState = new URLSearchParams(window.location.search).get("shared")
    if (!sharedState || hasLoadedSharedPdf.current) return

    hasLoadedSharedPdf.current = true
    window.history.replaceState({}, document.title, window.location.pathname)

    if (sharedState !== "1") {
      setError("The shared item was missing or was not a valid PDF.")
      return
    }

    const loadSharedPdf = async () => {
      try {
        const cache = await caches.open(SHARED_PDF_CACHE)
        const cachedResponse = await cache.match(SHARED_PDF_CACHE_PATH)

        if (!cachedResponse) {
          throw new Error("The shared PDF is no longer available. Please share it again.")
        }

        const blob = await cachedResponse.blob()
        const encodedName = cachedResponse.headers.get("X-FinSight-Filename")
        const fileName = encodedName
          ? decodeURIComponent(encodedName)
          : "shared-statement.pdf"
        const file = new File([blob], fileName, {
          type: blob.type || "application/pdf",
        })

        await cache.delete(SHARED_PDF_CACHE_PATH)
        await parseFile(file)
      } catch (sharedError) {
        setError(sharedError?.message || "The shared PDF could not be loaded.")
      }
    }

    void loadSharedPdf()
  }, [parseFile])

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    await parseFile(file)
  }

  const handleImport = async () => {
    if (!result?.transactions.length || isImporting) return

    setIsImporting(true)
    setImportResult(null)
    setError("")
    const counts = { imported: 0, duplicates: 0, failed: 0, pending: 0 }

    for (const transaction of result.transactions) {
      try {
        if (!transaction.upiTransactionId) {
          throw new Error("The transaction does not have a UPI transaction ID.")
        }

        const savedTransaction = await saveImportedTransactionWithId(
          `gpay_${transaction.upiTransactionId}`,
          transaction,
        )

        if (savedTransaction.created) {
          counts.imported += 1
          if (savedTransaction.pending) counts.pending += 1
        } else {
          counts.duplicates += 1
        }
      } catch {
        counts.failed += 1
      }
    }

    setImportResult(counts)
    setIsImporting(false)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="theme-hero rounded-2xl p-6 shadow-lg">
        <h1 className="text-3xl font-bold">Import Google Pay Statement</h1>
        <p className="mt-2 opacity-90">
          Preview statement transactions locally before importing
        </p>
      </div>

      <Card padding="lg">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="theme-text font-semibold">Select your statement PDF</h2>
            <p className="theme-muted-text mt-1 text-sm">
              The file is processed only in this browser and is not uploaded.
            </p>
            {fileName ? (
              <p className="theme-muted-text mt-2 flex items-center gap-2 text-xs">
                <FileText size={14} /> {fileName}
              </p>
            ) : null}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={isParsing}
            onClick={() => inputRef.current?.click()}
            className="theme-button-primary flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
          >
            <Upload size={17} />
            {isParsing ? "Parsing..." : "Select PDF"}
          </button>
        </div>
      </Card>

      {error ? (
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
        </Card>
      ) : null}

      {isParsing ? (
        <Card padding="lg" className="text-center">
          <p className="theme-muted-text">Reading every page of the statement...</p>
        </Card>
      ) : null}

      {result ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Transactions found", value: summary.total },
              { label: "Expenses", value: summary.expenses },
              { label: "Income", value: summary.income },
              { label: "UPI Lite top-ups excluded", value: result.excludedTopUps },
            ].map((item) => (
              <Card key={item.label} className="text-center">
                <p className="theme-text text-2xl font-bold">{item.value}</p>
                <p className="theme-muted-text mt-1 text-xs">{item.label}</p>
              </Card>
            ))}
          </div>

          {result.transactions.length > 0 ? (
            <div className="flex flex-col items-stretch gap-3 sm:items-end">
              <button
                type="button"
                disabled={isImporting}
                onClick={handleImport}
                className="theme-button-primary rounded-lg px-5 py-2.5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60"
              >
                {isImporting
                  ? "Importing Transactions..."
                  : `Import ${result.transactions.length} Transactions`}
              </button>

              {!user?.uid ? (
                <p className="theme-muted-text text-sm">
                  Guest imports are saved on this device and can be merged after sign-in.
                </p>
              ) : null}

              {importResult ? (
                <Card className="w-full border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 sm:max-w-md">
                  <h2 className="font-semibold text-green-700 dark:text-green-300">
                    Import complete
                  </h2>
                  <div className="theme-muted-text mt-2 grid grid-cols-3 gap-3 text-sm">
                    <p><strong className="theme-text block">{importResult.imported}</strong> imported</p>
                    <p><strong className="theme-text block">{importResult.duplicates}</strong> already imported</p>
                    <p><strong className="theme-text block">{importResult.failed}</strong> failed</p>
                  </div>
                  {importResult.pending > 0 ? (
                    <p className="theme-muted-text mt-3 text-xs">
                      {importResult.pending} saved on this device and waiting to sync.
                    </p>
                  ) : null}
                </Card>
              ) : null}
            </div>
          ) : null}

          {result.transactions.length === 0 ? (
            <Card padding="lg" className="text-center">
              <FileText className="theme-muted-text mx-auto" size={32} />
              <p className="theme-text mt-3 font-semibold">No transactions found</p>
              <p className="theme-muted-text mt-1 text-sm">
                This Google Pay statement does not contain importable transactions.
              </p>
            </Card>
          ) : (
            <section className="space-y-3" aria-label="Parsed transaction preview">
              {result.transactions.map((transaction, index) => {
                const isIncome = transaction.type === "income"

                return (
                  <Card
                    key={`${transaction.datetime}-${transaction.person}-${index}`}
                    className="transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="theme-panel theme-accent-text flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
                        <Tag size={21} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <h2 className="theme-text font-semibold">Other</h2>
                          <span className="theme-muted-text text-sm">· {transaction.person}</span>
                        </div>
                        <div className="theme-muted-text mt-1 flex flex-wrap gap-x-2 text-xs">
                          <span>{formatDatetime(transaction.datetime)}</span>
                          <span aria-hidden="true">·</span>
                          <span>UPI</span>
                        </div>
                      </div>
                      <p
                        className={`shrink-0 text-right font-bold ${
                          isIncome
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {isIncome ? "+" : "−"}₹{formatAmount(transaction.amount)}
                      </p>
                    </div>
                  </Card>
                )
              })}
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}

export default TransactionImport
