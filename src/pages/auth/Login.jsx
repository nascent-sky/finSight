import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { onAuthStateChanged, signInWithPopup } from "firebase/auth"
import { doc, setDoc } from "firebase/firestore"
import { FcGoogle } from "react-icons/fc"

import Card from "../../components/ui/Card"
import Button from "../../components/ui/Button"
import Modal from "../../components/ui/Modal"
import { auth, db, provider } from "../../firebase"
import {
  discardGuestExpenses,
  getGuestExpenses,
  hasGuestExpenses,
  initializeGuestMode,
  mergeGuestExpensesIntoAccount,
} from "../../services/dataService"
import {
  discardGuestTransactions,
  getGuestTransactions,
  hasGuestTransactions,
  mergeGuestTransactionsIntoAccount,
} from "../../services/transactionService"

const getSafeReturnPath = (search) => {
  const returnTo = new URLSearchParams(search).get("returnTo")

  return returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/"
}

const Login = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const skipRedirectRef = useRef(false)
  const returnTo = useMemo(() => getSafeReturnPath(location.search), [location.search])

  const [authError, setAuthError] = useState("")
  const [guestExpenseCount, setGuestExpenseCount] = useState(0)
  const [guestTransactionCount, setGuestTransactionCount] = useState(0)
  const [isMergePromptOpen, setIsMergePromptOpen] = useState(false)
  const [isResolvingMerge, setIsResolvingMerge] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) return

      setAuthError("")
      setIsSubmitting(false)

      if (!skipRedirectRef.current && !isMergePromptOpen && !isResolvingMerge) {
        navigate(returnTo)
      }
    })

    return () => unsubscribe()
  }, [isMergePromptOpen, isResolvingMerge, navigate, returnTo])

  const saveUserProfile = async (user) => {
    await setDoc(
      doc(db, "users", user.uid),
      {
        name: user.displayName,
        email: user.email,
        photo: user.photoURL,
        createdAt: new Date().toISOString(),
      },
      { merge: true },
    )
  }

  const finishLogin = () => {
    skipRedirectRef.current = false
    setIsMergePromptOpen(false)
    setIsResolvingMerge(false)
    navigate(returnTo)
  }

  const finalizeAuthenticatedLogin = async (authenticatedUser) => {
    const user = auth.currentUser ?? authenticatedUser
    if (!user) {
      throw new Error("Authenticated user is unavailable.")
    }

    setAuthError("")

    try {
      await saveUserProfile(user)
    } catch (error) {
      console.error("Failed to save signed-in user profile", error)
    }

    const guestExpenses = getGuestExpenses()
    const guestTransactions = getGuestTransactions()
    if (
      guestExpenses.length > 0 ||
      hasGuestExpenses() ||
      guestTransactions.length > 0 ||
      hasGuestTransactions()
    ) {
      setGuestExpenseCount(guestExpenses.length)
      setGuestTransactionCount(guestTransactions.length)
      setIsMergePromptOpen(true)
      return
    }

    finishLogin()
  }

  const confirmGuestDiscard = () => {
    const totalGuestItems = guestExpenseCount + guestTransactionCount
    const label = totalGuestItems === 1 ? "this 1 guest item" : `these ${totalGuestItems} guest items`

    return window.confirm(
      `Discard ${label}? This will permanently delete the offline data stored on this device.`,
    )
  }

  const handleGoogleLogin = async () => {
    setAuthError("")
    setIsSubmitting(true)
    skipRedirectRef.current = true

    try {
      const result = await signInWithPopup(auth, provider)
      await finalizeAuthenticatedLogin(result.user)
    } catch (error) {
      console.error("Google Login Error:", error)
      const authenticatedUser = auth.currentUser

      if (authenticatedUser) {
        await finalizeAuthenticatedLogin(authenticatedUser)
        return
      }

      skipRedirectRef.current = false
      setAuthError("Google sign-in failed. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleContinueAsGuest = () => {
    initializeGuestMode()
    navigate(returnTo)
  }

  const handleMergeDecision = async (shouldMerge) => {
    setAuthError("")

    if (!shouldMerge && !confirmGuestDiscard()) {
      return
    }

    setIsResolvingMerge(true)

    try {
      if (shouldMerge) {
        await mergeGuestExpensesIntoAccount()
        await mergeGuestTransactionsIntoAccount()
      } else {
        discardGuestExpenses()
        discardGuestTransactions()
      }

      finishLogin()
    } catch (error) {
      console.error("Failed to resolve guest expense merge", error)
      setGuestExpenseCount(getGuestExpenses().length)
      setGuestTransactionCount(getGuestTransactions().length)
      setAuthError(
        error?.message || "We could not finish moving your guest data. Please try again.",
      )
      setIsResolvingMerge(false)
    }
  }

  return (
    <>
      <div className="theme-shell flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Sign in to sync your financial data across devices, or keep going offline.
            </p>
          </div>

          {authError ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {authError}
            </div>
          ) : null}

          <div className="space-y-3">
            <Button
              onClick={handleGoogleLogin}
              className="flex w-full items-center justify-center gap-3"
              disabled={isSubmitting}
            >
              <FcGoogle size={20} />
              {isSubmitting ? "Signing in..." : "Continue with Google"}
            </Button>

            <Button
              onClick={handleContinueAsGuest}
              variant="secondary"
              className="w-full"
            >
              Continue as Guest
            </Button>
          </div>

          <p className="mt-6 text-center text-sm text-gray-500">
            Your guest expenses and transactions stay on this device until you choose to
            merge them.
          </p>
        </Card>
      </div>

      <Modal
        isOpen={isMergePromptOpen}
        onClose={() => {}}
        isDismissable={false}
        title="Merge offline data?"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Merge your offline expenses and transactions into your account?
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {guestExpenseCount > 0
              ? `${guestExpenseCount} legacy guest expense${guestExpenseCount === 1 ? "" : "s"}. `
              : ""}
            {guestTransactionCount > 0
              ? `${guestTransactionCount} new guest transaction${guestTransactionCount === 1 ? "" : "s"}. `
              : ""}
            Successful items will be removed from this device after they are saved.
          </p>
          {authError ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {authError}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => handleMergeDecision(false)}
              className="flex-1"
              disabled={isResolvingMerge}
            >
              {isResolvingMerge ? "Working..." : "Discard guest data"}
            </Button>
            <Button
              onClick={() => handleMergeDecision(true)}
              className="flex-1"
              disabled={isResolvingMerge}
            >
              {isResolvingMerge ? "Merging..." : "Merge data"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

export default Login
