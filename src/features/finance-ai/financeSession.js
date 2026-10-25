const regularAccount = (user) => Boolean(user?.uid && !user.isAnonymous)

export function financeSessionIdentity({ user, isAuthReady }) {
  if (!isAuthReady) return { mode: "loading", key: "auth-loading" }
  return regularAccount(user)
    ? { mode: "personal", key: `account:${user.uid}` }
    : { mode: "demo", key: `demo:${user?.uid || "signed-out"}` }
}

// Bind the existing subscription to the expected account before it captures
// Firebase's current user, and suppress queued callbacks after auth changes.
export function createAccountRecordSubscription({ getCurrentUser, subscribeRecords }) {
  return (onRecords, onError, { user }) => {
    const matches = () => regularAccount(user) && regularAccount(getCurrentUser()) && getCurrentUser().uid === user.uid
    if (!matches()) {
      onError?.(new Error("Your account changed. Please wait for your records to reconnect."))
      return () => {}
    }
    let active = true
    const unsubscribe = subscribeRecords((records, metadata) => {
      if (active && matches()) onRecords(records, { ...metadata, ownerUid: user.uid })
    }, (error) => { if (active && matches()) onError?.(error) })
    return () => { active = false; unsubscribe?.() }
  }
}

export function financePrivacyMessage(policy, consent) {
  if (policy?.error) return "Cloud AI could not be checked. Local financial analysis is still available."
  if (!consent) return "Cloud sharing is off. You can explore your records with local financial analysis."
  if (policy?.mode === "development" && policy.cloudConfigured) return "Cloud sharing is enabled for this fictional test account."
  if (policy?.mode === "paid" && policy.cloudConfigured) return "Cloud sharing is enabled. Financial explanations use the account's approved data policy."
  return "Cloud financial explanations are restricted for this account. Local analysis remains available; private financial records are not sent to Gemini."
}

export function financeErrorMessage(error, developer = false) {
  if (developer) return error.message || "FinSight AI could not answer. Please retry."
  if (["configuration", "privacy"].includes(error.origin)) return "Cloud AI is not available for this account under the current privacy settings. You can use local financial analysis."
  return error.message || "FinSight AI could not connect. Please retry."
}
