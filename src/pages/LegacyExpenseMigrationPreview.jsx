import { useEffect, useState } from "react"
import { onAuthStateChanged } from "firebase/auth"
import { AlertTriangle, CheckCircle2, Database, ShieldCheck } from "lucide-react"

import Button from "../components/ui/Button"
import Card from "../components/ui/Card"
import Modal from "../components/ui/Modal"
import { auth } from "../firebase"
import {
  getLegacyExpenseMigrationPreview,
  migrateLegacyExpenses,
} from "../services/legacyExpenseMigrationService"

const formatAmount = (amount) =>
  Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })

const formatDatetime = (datetime) =>
  new Date(datetime).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

const LegacyExpenseMigrationPreview = () => {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [isConfirming, setIsConfirming] = useState(false)
  const [isMigrating, setIsMigrating] = useState(false)
  const [migrationResult, setMigrationResult] = useState(null)

  useEffect(() => {
    let active = true

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setPreview(null)
      setError("")
      setMigrationResult(null)
      setIsConfirming(false)

      if (!user) {
        setLoading(false)
        setError("Sign in to preview legacy expense migration.")
        return
      }

      setLoading(true)
      try {
        const result = await getLegacyExpenseMigrationPreview()
        if (active) setPreview(result)
      } catch (loadError) {
        if (active) {
          setError(loadError?.message || "Legacy expenses could not be inspected.")
        }
      } finally {
        if (active) setLoading(false)
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const handleMigration = async () => {
    if (isMigrating) return

    setIsMigrating(true)
    setError("")
    setMigrationResult(null)

    try {
      const result = await migrateLegacyExpenses()
      setMigrationResult(result)
      setIsConfirming(false)
    } catch (migrationError) {
      setError(migrationError?.message || "Legacy expenses could not be migrated.")
    } finally {
      setIsMigrating(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
          <ShieldCheck size={18} /> Safe copy migration
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Legacy Expense Migration Preview
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Preview your old expenses before copying them. Original legacy expenses are never
          changed or deleted.
        </p>
      </div>

      {loading && (
        <Card className="text-sm text-gray-600 dark:text-gray-300">
          Inspecting legacy expenses…
        </Card>
      )}

      {!loading && error && (
        <Card className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        </Card>
      )}

      {!loading && preview && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Legacy expenses found", preview.legacyExpensesFound, <Database key="icon" size={19} />],
              ["Convertible", preview.convertible.length, <CheckCircle2 key="icon" size={19} />],
              ["Problems", preview.problems.length, <AlertTriangle key="icon" size={19} />],
            ].map(([label, value, icon]) => (
              <Card key={label} className="min-w-0" padding="sm">
                <div className="mb-2 text-blue-600 dark:text-blue-400">{icon}</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{value}</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div>
              </Card>
            ))}
          </div>

          {migrationResult && (
            <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                Migration complete
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 text-sm text-gray-700 dark:text-gray-200">
                <div><strong>{migrationResult.migrated}</strong><br />migrated</div>
                <div><strong>{migrationResult.alreadyMigrated}</strong><br />already migrated</div>
                <div><strong>{migrationResult.failed}</strong><br />failed</div>
              </div>
              {migrationResult.failures.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
                  {migrationResult.failures.map((failure) => (
                    <li key={failure.id}>{failure.id}: {failure.message}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Copy the convertible records into your new transaction history. This action does
              not alter the original expenses and can be run safely more than once.
            </p>
            <Button
              className="mt-4 w-full sm:w-auto"
              disabled={preview.convertible.length === 0 || isMigrating}
              onClick={() => setIsConfirming(true)}
            >
              Migrate {preview.convertible.length} Expenses
            </Button>
          </Card>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Converted records
            </h2>
            {preview.convertible.length === 0 ? (
              <Card className="text-sm text-gray-500 dark:text-gray-400">
                No convertible legacy expenses were found.
              </Card>
            ) : (
              preview.convertible.map(({ id, transaction, datetimeSourceField }) => (
                <Card key={id} padding="sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-white">
                        {transaction.category}
                      </div>
                      {transaction.note && (
                        <div className="truncate text-sm text-gray-600 dark:text-gray-300">
                          {transaction.note}
                        </div>
                      )}
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {formatDatetime(transaction.datetime)} · Cash · source: {datetimeSourceField}
                      </div>
                      <div className="mt-1 truncate text-xs text-gray-400">Legacy ID: {id}</div>
                    </div>
                    <div className="shrink-0 font-semibold text-red-600 dark:text-red-400">
                      -₹{formatAmount(transaction.amount)}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </section>

          {preview.problems.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Records with problems
              </h2>
              {preview.problems.map(({ id, problems }) => (
                <Card key={id} className="border-red-200 dark:border-red-900/60" padding="sm">
                  <div className="font-medium text-gray-900 dark:text-white">Legacy ID: {id}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </Card>
              ))}
            </section>
          )}
        </>
      )}

      <Modal
        isOpen={isConfirming}
        isDismissable={!isMigrating}
        onClose={() => setIsConfirming(false)}
        title="Confirm expense migration"
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          This will copy {preview?.convertible.length ?? 0} legacy expenses into the new
          transaction system. Your original expenses will not be deleted.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button
            disabled={isMigrating}
            onClick={() => setIsConfirming(false)}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button disabled={isMigrating} onClick={handleMigration}>
            {isMigrating ? "Migrating…" : "Migrate expenses"}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default LegacyExpenseMigrationPreview
