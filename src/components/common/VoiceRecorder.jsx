import { useState, useEffect, useRef } from 'react'
import { Mic, Square, RefreshCw, CheckCircle } from 'lucide-react'
import { useVoiceToExpense } from '../../hooks/useVoiceToExpense'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { showToast } from '../../utils/toastStore'

export default function VoiceRecorder({
  onExpenseDetected,
  autoSave = false,
  externalTranscript = null,
  onExternalTranscriptConsumed = null,
}) {
  const [showPreview, setShowPreview] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const handledExpenseRef = useRef(null)

  const {
    isListening,
    transcript,
    error,
    parsedExpense,
    startListening,
    stopListening,
    clearError,
    resetTranscript,
  } = useVoiceToExpense(null, externalTranscript)

  useEffect(() => {
    if (error) {
      showToast(error, 'error', 5000)
    }
  }, [error])

  useEffect(() => {
    if (!parsedExpense || handledExpenseRef.current === parsedExpense) {
      return undefined
    }

    handledExpenseRef.current = parsedExpense

    if (parsedExpense.amount <= 0) {
      return undefined
    }

    let isActive = true
    const timeoutId = window.setTimeout(() => {
      if (!isActive) return

      setShowPreview(true)
      showToast(
        `Detected: ₹${parsedExpense.amount} - ${parsedExpense.category}`,
        'success',
        4000
      )

      if (!autoSave || !onExpenseDetected) {
        return
      }

      const saveDetectedExpense = async () => {
        try {
          const saveResult = await onExpenseDetected({
            id: Date.now(),
            amount: parsedExpense.amount,
            category: parsedExpense.category,
            note: parsedExpense.note || parsedExpense.merchant || 'Voice input',
            date: new Date().toISOString().split('T')[0],
            merchant: parsedExpense.merchant,
            originalTranscript: parsedExpense.originalTranscript,
          })

          if (!isActive) return
          if (saveResult?.pendingAuth) return

          resetTranscript()
          setShowPreview(false)

          if (onExternalTranscriptConsumed) {
            onExternalTranscriptConsumed()
          }
        } catch (error) {
          console.error('Failed to auto-save voice expense', error)
        }
      }

      void saveDetectedExpense()
    }, 0)

    return () => {
      isActive = false
      window.clearTimeout(timeoutId)
    }
  }, [
    autoSave,
    onExpenseDetected,
    onExternalTranscriptConsumed,
    parsedExpense,
    resetTranscript,
  ])

  const handleSubmit = async () => {
    if (!parsedExpense || !onExpenseDetected) return

    setIsSubmitting(true)
    try {
      const saveResult = await onExpenseDetected({
        id: Date.now(),
        amount: parsedExpense.amount,
        category: parsedExpense.category,
        note: parsedExpense.note || parsedExpense.merchant || 'Voice input',
        date: new Date().toISOString().split('T')[0],
        merchant: parsedExpense.merchant,
        originalTranscript: parsedExpense.originalTranscript,
      })
      if (saveResult?.pendingAuth) {
        setIsSubmitting(false)
        return
      }
      showToast(`✓ Expense saved: ₹${parsedExpense.amount}`, 'success', 3000)
      resetTranscript()
      setShowPreview(false)

      if (onExternalTranscriptConsumed) {
        onExternalTranscriptConsumed()
      }

      setIsSubmitting(false)
    } catch {
      showToast('Failed to save expense', 'error', 3000)
      setIsSubmitting(false)
    }
  }
  // Recording mode - pulsing mic button
  if (!showPreview) {
    return (
      <Card padding="lg" className="w-full min-w-0 border-2 border-dashed border-indigo-300 dark:border-indigo-700 bg-linear-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20">
        <div className="flex min-w-0 flex-col items-center gap-4 py-6">
          <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">Quick Voice Input</p>
          
          <button
            onClick={isListening ? stopListening : startListening}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center font-bold text-white transition-all duration-300 ${
              isListening
                ? 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/50 animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-700 shadow-lg'
            }`}
            title={isListening ? 'Stop recording' : 'Start recording'}
          >
            {isListening ? (
              <Square size={28} className="animate-bounce" />
            ) : (
              <Mic size={28} />
            )}
          </button>

          <div className="text-center">
            <p className={`text-sm font-medium ${isListening ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
              {isListening ? 'Recording...' : 'Tap to record expense'}
            </p>
            {transcript && (
              <p className="mt-2 max-w-full break-words text-xs italic text-gray-500 dark:text-gray-400">
                "{transcript}"
              </p>
            )}
          </div>

          {error && (
            <div className="w-full bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              <button
                onClick={clearError}
                className="text-xs text-red-600 dark:text-red-400 hover:underline mt-1"
              >
                Dismiss
              </button>
            </div>
          )}

          <p className="max-w-full break-words text-center text-xs text-gray-500 dark:text-gray-400">
            Say something like: "Spent 50 rupees at Starbucks for lunch"
          </p>
        </div>
      </Card>
    )
  }

  // Preview mode - confirm expense
  return (
    <Card padding="lg" className="w-full min-w-0 border-2 border-green-300 dark:border-green-700 bg-linear-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20">
      <div className="min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-green-100 dark:bg-green-900/40 p-2">
            <CheckCircle size={24} className="text-green-600 dark:text-green-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white">Expense Detected</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">Confirm or modify below</p>
          </div>
        </div>

        {/* Parsed Details */}
        <div className="grid min-w-0 grid-cols-2 gap-3 rounded-lg bg-white p-3 dark:bg-gray-800">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">Amount</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              ₹{parsedExpense?.amount || 0}
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">Category</p>
            <p className="break-words text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              {parsedExpense?.category}
            </p>
          </div>

          <div className="col-span-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Where</p>
            <p className="break-words text-sm text-gray-900 dark:text-white">
              {parsedExpense?.merchant || 'Not specified'}
            </p>
          </div>

          <div className="col-span-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Note</p>
            <p className="break-words text-sm italic text-gray-900 dark:text-white">
              "{parsedExpense?.note || 'No details'}"
            </p>
          </div>
        </div>

        {/* Transcript */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Original voice input:</p>
          <p className="break-words text-sm italic text-gray-700 dark:text-gray-300">
            "{transcript}"
          </p>
        </div>

        {/* Confidence indicator */}
        <div className="flex items-center gap-2">
          <div className={`flex-1 h-2 rounded-full ${
            parsedExpense?.confidence === 'high'
              ? 'bg-green-400'
              : 'bg-yellow-400'
          }`} />
          <p className="text-xs text-gray-600 dark:text-gray-400">
            {parsedExpense?.confidence === 'high' ? 'High confidence' : 'Medium confidence'}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            onClick={() => {
              resetTranscript()
              setShowPreview(false)

              if (onExternalTranscriptConsumed) {
                onExternalTranscriptConsumed()
              }
            }}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            disabled={isSubmitting}
          >
            <RefreshCw size={16} />
            Record Again
          </Button>

          <Button
            onClick={handleSubmit}
            className="flex min-w-0 flex-1 items-center justify-center gap-2 bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600"
            disabled={isSubmitting || !parsedExpense?.amount}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckCircle size={16} />
                Save Expense
              </>
            )}
          </Button>
        </div>

        {/* Hint for editing */}
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
          💡 Amount and category are auto-detected. Save to add to expenses.
        </p>
      </div>
    </Card>
  )
}
