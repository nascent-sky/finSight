import test from "node:test"
import assert from "node:assert/strict"
import { retrieveFinancialRecords } from "./financialRetrieval.js"
import { planFinancialQuestion } from "../../src/features/finance-ai/questionPlanner.js"

const root = "projects/test-project/databases/(default)/documents/users/alice/transactions/"
const document = (id = "record") => ({ name: root + id, fields: { amount: { doubleValue: 100 }, type: { stringValue: "expense" }, datetime: { stringValue: "2026-10-01T00:00:00.000Z" }, category: { stringValue: "Food & Dining" }, paymentMethod: { stringValue: "upi" }, person: { stringValue: "PRIVATE-PERSON" }, note: { stringValue: "PRIVATE-NOTE" } } })
const options = (fetcher) => ({ uid: "alice", token: "synthetic-token", projectId: "test-project", range: { start: "2026-10-01", end: "2026-11-01" }, signal: new AbortController().signal, fetcher })

test("read-only Firestore REST retrieval uses verified user scope, projected fields and the user's ID token", async () => {
  let sent
  const result = await retrieveFinancialRecords(options(async (url, request) => {
    assert.equal(url, "https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents/users/alice:runQuery")
    assert.equal(request.headers.Authorization, "Bearer synthetic-token")
    sent = JSON.parse(request.body).structuredQuery
    return Response.json([{ document: document() }])
  }))
  assert.deepEqual(sent.from, [{ collectionId: "transactions" }])
  assert.equal(sent.limit, 5001)
  assert.ok(!JSON.stringify(sent.select).includes("note"))
  assert.ok(!JSON.stringify(sent.select).includes("person"))
  assert.ok(!JSON.stringify(result).includes("PRIVATE"))
  assert.equal(result[0].amount, 100)
  assert.equal(sent.where.compositeFilter.filters[0].fieldFilter.value.stringValue, "2026-09-29T12:00:00.000Z")
})

test("disjoint comparisons retrieve only their two requested periods, not the intervening months", async () => {
  const plan = planFinancialQuestion("Compare October 2026 spending with January 2026", [], { now: new Date("2026-10-24T12:00:00Z"), timezone: "Asia/Kolkata" })
  assert.equal(plan.retrieval.ranges.length, 2)
  const starts = []
  await retrieveFinancialRecords({ ...options(async (_, request) => {
    const query = JSON.parse(request.body).structuredQuery
    starts.push(query.where.compositeFilter.filters[0].fieldFilter.value.stringValue)
    return Response.json([])
  }), range: plan.retrieval })
  assert.deepEqual(starts, ["2025-12-30T12:00:00.000Z", "2026-09-29T12:00:00.000Z"])
})

test("another user's response path or a path-injecting UID is rejected", async () => {
  await assert.rejects(() => retrieveFinancialRecords(options(async () => Response.json([{ document: { ...document(), name: root.replace("alice", "bob") + "record" } }]))), /unexpected account path/)
  await assert.rejects(() => retrieveFinancialRecords({ ...options(() => { throw new Error("unexpected") }), uid: "alice/../../bob" }), { status: 401 })
})

test("overflow never creates partial financial totals", async () => {
  await assert.rejects(() => retrieveFinancialRecords(options(async () => Response.json(Array.from({ length: 5001 }, (_, index) => ({ document: document(String(index)) }))))), { status: 413 })
  await assert.rejects(() => retrieveFinancialRecords(options(async () => new Response("x", { headers: { "content-length": "5000000" } }))), { status: 413 })
})

test("Firestore authorization errors, API failures and malformed responses are clear and sanitized", async () => {
  for (const [response, status] of [[new Response("PRIVATE", { status: 403 }), 403], [new Response("PRIVATE", { status: 500 }), 503], [new Response("not-json"), 502], [Response.json([{ error: { message: "PRIVATE" } }]), 502]]) {
    await assert.rejects(() => retrieveFinancialRecords(options(async () => response)), (error) => error.status === status && !error.message.includes("PRIVATE"))
  }
})
