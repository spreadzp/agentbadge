/**
 * EPIC-226 / SLICE-226-2 — admin FinOps domain types.
 *
 * Domain services live in `read-models.ts` / `admin-actions.ts` /
 * `refund-intents.ts` / `exceptions.ts`. No routes, no UI here —
 * slice 226-3 wires handlers on top of these functions.
 *
 * Invariants (HANDOFF/D-226-*):
 * - every manual action writes an append-only AdminAction before or
 *   with the effect — `operator` is mandatory;
 * - no fabricated on-chain confirmation — RefundIntent completes only
 *   behind a verified real txHash (injected `VerifyRefundTx`);
 * - a payment is counted once at its terminal state;
 * - RECORD_ONLY commerce rows never enter revenue aggregates.
 */

import type {
  AdminActionRow,
  Database,
  PaymentAttemptRow,
  PaymentEventRow,
  PaymentReceiptRow,
  PaymentRow,
  RefundIntentRow,
  ReconciliationExceptionRow,
  UsageRecordRow,
} from "@agentbadge/database";

/** FinOps error codes — stable vocabulary for the route layer. */
export const FINOPS_ERRORS = [
  "OPERATOR_REQUIRED",
  "EVIDENCE_TOO_LARGE",
  "NOT_FOUND",
  "INVALID_STATE",
  "BAD_INPUT",
  "TX_UNVERIFIED",
  "TX_REUSED",
  "PROVIDER_ERROR",
] as const;
export type FinOpsErrorCode = (typeof FINOPS_ERRORS)[number];

export interface FinOpsError {
  code: FinOpsErrorCode;
  message: string;
}

export type FinOpsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FinOpsError };

export const ok = <T>(value: T): FinOpsResult<T> => ({ ok: true, value });
export const fail = (
  code: FinOpsErrorCode,
  message: string,
): FinOpsResult<never> => ({ ok: false, error: { code, message } });

/** Evidence JSON size cap (D-226-3) — serialized, bytes ≈ chars. */
export const EVIDENCE_MAX_BYTES = 4096;

// ---------- injected deps (test seams, no on-chain writes) ----------

/**
 * On-chain refund verification — injected so the domain never
 * fabricates a confirmation and stays chain-free in tests. The real
 * adapter (chain.txEvidence) is wired in the ops/routes layer.
 */
export interface RefundTxCheck {
  /** true when the tx exists, is confirmed, pays `payee` ≥ `amount`. */
  verified: boolean;
  reason?: string;
  network?: string;
  /** Sender of the refund tx (treasury) — cross-checked when returned. */
  payer?: string;
  /** Asset/currency the verifier observed being transferred. */
  asset?: string;
  confirmations?: number;
}

/**
 * What the verifier must prove (H4/226-6): beyond payee+amount the
 * expectation carries the asset, the intent creation time (a payout
 * predating the intent can never satisfy it) and — when configured —
 * the expected sender/chain so the adapter binds the tx to treasury
 * and network, not just to "someone paid this wallet".
 */
export interface RefundTxExpectation {
  payee: string;
  amount: string;
  /** Asset/currency symbol the payout must move (e.g. USDC). */
  currency: string;
  /** tx must be included at/after intent creation. */
  notBeforeMs?: number;
  /** Expected sender when the treasury wallet is configured. */
  from?: string;
  /** Expected chain/network id when the adapter pins one. */
  chainId?: string;
}
export type VerifyRefundTx = (
  txHash: string,
  expected: RefundTxExpectation,
) => Promise<RefundTxCheck>;

/** Stripe client seam — tests pass a stub, prod passes the SDK. */
export interface StripeRefundClient {
  refunds: {
    create(
      input: {
        payment_intent: string;
        amount?: number;
        reason?: string;
        metadata?: Record<string, string>;
      },
      opts?: { idempotencyKey?: string },
    ): Promise<{ id: string; status?: string }>;
  };
}

export interface StripeRefundInput {
  paymentId: string;
  operator: string;
  /** Free-form ops justification — audit evidence + Stripe enum map. */
  reason?: string;
  /** Supporting details — audit evidence only, never sent to Stripe. */
  evidence?: unknown;
}

export interface StripeRefundResult {
  stripeRefundId: string;
  paymentId: string;
  /** true when the payment left revenue as REFUNDED. */
  paymentFlip: boolean;
  /** false when the effect landed but the audit store was down. */
  auditRecorded: boolean;
  /** true when the Stripe refund succeeded but the local flip threw —
   *  the payment must be reconciled manually (audit row marks it). */
  needsReconcile?: boolean;
}

export interface FinOpsDeps {
  db: Database;
}

// ---------- read-model views ----------

export interface PaymentListFilter {
  provider?: string;
  status?: string;
  statuses?: readonly string[];
  purpose?: string;
  productId?: string;
  customerId?: string;
  agentId?: string;
  /** createdAtMs window. */
  sinceMs?: number;
  untilMs?: number;
  /** 1-based page; `perPage` caps at MAX_PER_PAGE. */
  page?: number;
  perPage?: number;
}

export const FINOPS_DEFAULT_PER_PAGE = 50;
export const FINOPS_MAX_PER_PAGE = 200;

export interface PaymentListItem {
  id: string;
  reference: string;
  status: string;
  amount: string;
  currency: string;
  purpose: string;
  /** Actor label — registry name when present, else raw wallet/id. */
  customerId: string | null;
  agentId: string | null;
  productId: string | null;
  /** Provider of the confirmed attempt, else latest attempt's. */
  provider: string | null;
  network: string | null;
  transactionHash: string | null;
  createdAtMs: number;
}

export interface PaymentListResult {
  items: PaymentListItem[];
  page: number;
  perPage: number;
  /** true when a next page exists (cheap hasMore — no COUNT scan). */
  hasMore: boolean;
}

export interface PaymentDetail {
  payment: PaymentRow;
  /** Attempts newest first — the roll-up never merges amounts. */
  attempts: PaymentAttemptRow[];
  receipts: PaymentReceiptRow[];
  events: PaymentEventRow[];
  refunds: RefundIntentRow[];
  adminActions: AdminActionRow[];
  /** Provider of the confirmed attempt, else latest attempt's. */
  provider: string | null;
  network: string | null;
}

/**
 * Payment → business-operation trace (spec: "trace every payment to
 * its originating business operation").
 */
export interface PaymentTrace {
  payment: PaymentRow;
  product: { id: string; code: string; name: string } | null;
  attempts: PaymentAttemptRow[];
  receipts: PaymentReceiptRow[];
  events: PaymentEventRow[];
  usageRecords: UsageRecordRow[];
  /** Linked commerce task/agreement when paymentId is referenced. */
  related: {
    taskId: string | null;
    agreementId: string | null;
    orderId: string | null;
  };
}

// ---------- reports ----------

export interface ReportPeriod {
  /** Inclusive lower bound on the terminal transition (updatedAtMs). */
  sinceMs?: number;
  /** Inclusive upper bound on the terminal transition. */
  untilMs?: number;
}

export interface FinReport {
  period: { sinceMs: number | null; untilMs: number | null };
  /** Σ amount over payments terminal-CONFIRMED|REFUNDED in period. */
  grossVolume: string;
  /** Σ completed refund intents + stripe-refunded payments (once). */
  refundsTotal: string;
  fees: {
    /** Estimated — Stripe 2.9% + $0.30 per confirmed Stripe payment. */
    stripeEstimated: string;
    /** Estimated — FINOPS_X402_FEE_BPS over confirmed x402 volume. */
    facilitatorEstimated: string;
    total: string;
    basis: "estimated";
  };
  /** grossVolume − refundsTotal − fees.total. */
  netRevenue: string;
  /** Gross by provider of the payment's CONFIRMED attempt. */
  byProvider: Record<string, string>;
  /** Gross by productId ("none" bucket when unset). */
  byProduct: Record<string, string>;
  /** USDC gross by attempt network for on-chain providers. */
  byNetwork: Record<string, string>;
  counts: { payments: number; refundedPayments: number };
  /**
   * RECORD_ONLY commerce mirrors — informational only, strictly
   * outside revenue (D-226-5 / spec "revenue ≠ recorded").
   */
  recordedOnly: {
    count: number;
    volume: string;
    currency: string;
    /** N4-4: mirror rows whose amount was not a canonical decimal —
     *  counted, excluded from volume, never fatal. */
    invalidAmounts?: number;
  };
}

// ---------- exceptions ----------

/** Candidate detection record fed to `detectExceptions`. */
export interface ExceptionCandidate {
  /** Deterministic id — dedupes re-scans; generated when omitted. */
  id?: string;
  type: string; // ReconciliationExceptionType
  /** paymentId | txHash — what the exception is about. */
  subjectRef: string;
  details?: Record<string, unknown>;
}

export interface DetectResult {
  created: ReconciliationExceptionRow[];
  /** Deterministic-id collisions — already known, skipped. */
  skipped: string[];
  /** N7-6: per-row store errors — rows already written stay in
   *  `created` and the audit row still reports them; a mid-batch
   *  throw no longer strands created rows with no audit trail. */
  errors?: string[];
}
