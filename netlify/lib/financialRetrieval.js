const MAX_RECORDS = 5000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024
const fields = ["amount", "datetime", "type", "category", "paymentMethod", "isSample", "isSampleData", "source"]
const fail = (message, status = 502) => { throw Object.assign(new Error(message), { status }) }

async function limitedJson(response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) fail("That period contains too much data. Please choose a smaller range.", 413)
  const reader = response.body?.getReader()
  if (!reader) fail("The records service returned an empty response.")
  let bytes = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); fail("That period contains too much data. Please choose a smaller range.", 413) }
      chunks.push(Buffer.from(value))
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { fail("The records service returned invalid data.") }
  } finally { reader.releaseLock() }
}

export async function retrieveFinancialRecords({ uid, token, projectId, range, signal, fetcher = fetch }) {
  if (!uid || /[/\\]/.test(uid) || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) fail("The financial account configuration is invalid.", 401)
  const root = `projects/${projectId}/databases/(default)/documents/users/${uid}`
  const requestRoot = `projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`
  const retrieved = []
  // Canonical datetimes are ISO strings. Padding admits every IANA timezone and
  // DST boundary; the engine then applies exact local dates to returned records.
  for (const scope of range.ranges || [range]) {
    const start = new Date(Date.parse(`${scope.start}T00:00:00Z`) - 36 * 3600_000).toISOString()
    const end = new Date(Date.parse(`${scope.end}T00:00:00Z`) + 36 * 3600_000).toISOString()
    const response = await fetcher(`https://firestore.googleapis.com/v1/${requestRoot}:runQuery`, {
      method: "POST", signal,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: "transactions" }],
        select: { fields: fields.map((fieldPath) => ({ fieldPath })) },
        where: { compositeFilter: { op: "AND", filters: [
          { fieldFilter: { field: { fieldPath: "datetime" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: start } } },
          { fieldFilter: { field: { fieldPath: "datetime" }, op: "LESS_THAN", value: { stringValue: end } } },
        ] } },
        orderBy: [{ field: { fieldPath: "datetime" }, direction: "ASCENDING" }], limit: MAX_RECORDS - retrieved.length + 1,
      } }),
    })
    if (response.status === 401 || response.status === 403) fail("Your financial records could not be authorized. Sign in again or check the existing Firestore rules.", 403)
    if (!response.ok) fail("Your financial records could not be retrieved. Please retry.", 503)
    const rows = await limitedJson(response)
    if (!Array.isArray(rows) || rows.some((row) => row.error)) fail("The records service could not complete the query.")
    const documents = rows.filter((row) => row.document).map((row) => row.document)
    if (documents.length + retrieved.length > MAX_RECORDS) fail(`That period exceeds the ${MAX_RECORDS.toLocaleString("en-IN")} record limit. Please choose a smaller range; no partial total was calculated.`, 413)
    retrieved.push(...documents.map((document) => {
      const prefix = `${root}/transactions/`
      if (typeof document.name !== "string" || !document.name.startsWith(prefix) || !document.name.slice(prefix.length) || document.name.slice(prefix.length).includes("/")) fail("The records service returned an unexpected account path.")
      const value = (name) => {
        const field = document.fields?.[name]
        return field?.stringValue ?? field?.timestampValue ?? field?.doubleValue ?? field?.integerValue ?? field?.booleanValue
      }
      return { id: document.name.slice(prefix.length), ...Object.fromEntries(fields.map((field) => [field, value(field)])) }
    }))
  }
  return retrieved
}
