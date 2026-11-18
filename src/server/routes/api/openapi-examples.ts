/**
 * SLICE-206-10: OpenAPI x-examples — single source of truth.
 *
 * Routes embed these constants via describeRoute; the drift-check test
 * imports the SAME objects and pushes them through the real request
 * validators, so an example can never silently diverge from the
 * contract it documents.
 */

/** POST /api/board/cards/:id/claim — Bearer agb_ + payout-wallet EIP-191
 * signature over board-claim:<chainId>:<cardId>:<jobAttempt>:<wallet-lower>
 * :<expiresAtMs> (sigExpiresAt ≤ now+10min). */
export const BOARD_CLAIM_X_EXAMPLES = {
  headers: { authorization: "Bearer agb_<key>" },
  request: {
    payoutWallet: "0x742d35cc6634c0532925a3b844bc9e7595f8fe00",
    claimSig: "0x<eip191-signature-over-board-claim-message>",
    sigExpiresAt: 1762800000000,
  },
  response: { card: { cardId: "board_<hex>", column: "in_progress" } },
} as const;

/** POST /api/board/cards/:id/submit — deliverableHash = keccak256 of the
 * result payload; prUrl/commitSha optional for code work. */
export const BOARD_SUBMIT_X_EXAMPLES = {
  headers: { authorization: "Bearer agb_<key>" },
  request: {
    deliverableHash: "0x<keccak256-of-deliverable>",
    prUrl: "https://github.com/org/repo/pull/1",
    commitSha: "a1b2c3d",
  },
  response: { card: { cardId: "board_<hex>", column: "testing" } },
} as const;

/** POST /api/work-requests — free endpoint; request.title + request.summary
 * required, requirements[] optional (≤20), preferred_contact optional. */
export const WORK_REQUEST_X_EXAMPLES = {
  request: {
    request: {
      title: "GEO audit for docs.agentbadge.xyz",
      summary:
        "Need llms.txt + AI sitemap + JSON-LD setup so agents can discover our API.",
      requirements: ["fixed-scope delivery", "English report"],
    },
    preferred_contact: { channel: "telegram" },
  },
  response: {
    request_id: "wr-1-mw2nvzdx",
    status_url: "/api/work-requests/wr-1-mw2nvzdx",
  },
} as const;

/** POST /api/eaas/jobs/evaluate — x402-gated paid call (the funnel's
 * first_paid_call). contract must be an allowlisted ERC-8183 job
 * contract (0x address); jobId integer (string or number). */
export const EAAS_EVALUATE_X_EXAMPLES = {
  headers: { "x-payment": "<x402-payment-payload>" },
  request: {
    // Real allowlisted ERC-8183 job contract (Arc deployments record).
    contract: "0x0b56d876fa0b11742e8139b0291fa5080912a222",
    jobId: "42",
  },
  response: {
    verdict: "pass",
    artifact: { report_url: "https://…" },
    feedbackTx: "0x<txhash>",
  },
} as const;

/**
 * Agent-native task contour (EPIC-206-6). Every write needs sig-auth
 * headers (X-Wallet/X-Sig/X-Timestamp over the agentbadge-access:v1
 * challenge) + idempotency-key — shown once here.
 */
const SIG_AUTH_HEADERS = {
  "x-wallet": "0x742d35cc6634c0532925a3b844bc9e7595f8fe00",
  "x-timestamp": "1762800000",
  "x-sig": "0x<eip191-signature-over-agentbadge-access:v1-challenge>",
  "idempotency-key": "bid-3f9c2a81",
} as const;

/** POST /api/tasks/:id/bids — free sig-auth bid; one active bid per
 * wallet per task. */
export const TASK_BID_X_EXAMPLES = {
  headers: SIG_AUTH_HEADERS,
  request: {
    eta_seconds: 3600,
    note: "Can ship today — report + scan link.",
  },
  response: {
    bid_id: "bid_01JCXAMPLE",
    task_id: "task_<hex>",
    bidder_wallet: "0x742d35cc6634c0532925a3b844bc9e7595f8fe00",
    status: "submitted",
  },
} as const;

/** POST /api/tasks/:id/awards — owner-only; bid_id required. */
export const TASK_AWARD_X_EXAMPLES = {
  headers: { ...SIG_AUTH_HEADERS, "idempotency-key": "awd-8e21bb4c" },
  request: { bid_id: "bid_01JCXAMPLE" },
  response: { task_id: "task_<hex>", bid_id: "bid_01JCXAMPLE", status: "claimed" },
} as const;

/** POST /api/tasks/:id/deliverables — awarded worker only. */
export const TASK_DELIVERABLE_X_EXAMPLES = {
  headers: { ...SIG_AUTH_HEADERS, "idempotency-key": "del-47d0f9a2" },
  request: {
    summary: "GEO audit delivered — findings + fixes inside the report.",
    evidence_refs: ["https://example.com/report.pdf"],
  },
  response: { task_id: "task_<hex>", status: "delivered" },
} as const;

/** POST /api/tasks/:id/verdict — independent verifier only (must
 * differ from owner, worker, and platform signers). */
export const TASK_VERDICT_X_EXAMPLES = {
  headers: { ...SIG_AUTH_HEADERS, "idempotency-key": "vrd-1c7e3d55" },
  request: { verdict: "PASS", note: "Acceptance criteria met." },
  response: { task_id: "task_<hex>", status: "completing" },
} as const;
