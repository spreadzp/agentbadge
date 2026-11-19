/**
 * EPIC-227 — lib/settlement barrel: domain types, state machines,
 * invariants, services, events, verify seam. Route layer wires
 * `createSettlementCtx(db)` over the singleton Database.
 */

export * from "./types.js";
export {
  GENESIS_HASH,
  canonicalJson,
  hashEvent,
  isLegalTransition,
  isTerminal,
} from "./state-machines.js";
export * as invariants from "./invariants.js";
export { isParticipant } from "./invariants.js";
export {
  SettlementEventEmitter,
  createSettlementEmitter,
} from "./events.js";
export type { SettlementEmitInput } from "./events.js";
export type {
  PayoutTxCheck,
  PayoutTxExpectation,
  VerifyPayoutTx,
} from "./verify-payout-tx.js";
export { verifyLegTx } from "./verify-payout-tx.js";
export type { SettlementCtx } from "./services/ctx.js";
export {
  createPlan,
  getAgreementView,
  getPlanByAgreement,
} from "./services/plan-service.js";
export {
  approveMilestone,
  reopenMilestone,
  submitForReview,
  transitionMilestone,
} from "./services/milestone-service.js";
export {
  forceApproveMilestone,
  type ApproveEffect,
} from "./services/milestone-approve.js";
export { revertApproval } from "./services/milestone-revert.js";
export { markLegPaid } from "./services/payout-service.js";
export {
  getIntentView,
  listIntents,
} from "./services/payout-queries.js";
export type { MarkPaidResult } from "./services/payout-service.js";
export { raiseDispute } from "./services/dispute-service.js";
export {
  getDispute,
  listDisputes,
} from "./services/dispute-scope.js";
export { resolveDispute } from "./services/dispute-resolve.js";
export { getSettlementReceipt } from "./services/receipt.js";
export {
  drainSettlementAnchors,
  requestReceiptAnchor,
} from "./services/anchor.js";
export type {
  AnchorDrainDeps,
  AnchorRequestDeps,
} from "./services/anchor.js";
export {
  buildReceiptPublic,
  buildSettlementReceipt,
  createSettlementReceiptSigner,
  SETTLEMENT_RECEIPT_SCHEMA_ID,
  settlementReceiptToJson,
  verifySettlementReceiptSignature,
} from "./receipt.js";
export type {
  SettlementReceipt,
  SettlementReceiptPublic,
  SettlementReceiptSigner,
  SettlementReceiptSigningBody,
} from "./receipt.js";
export {
  SETTLEMENT_RECEIPT_JSON_SCHEMA,
  SettlementReceiptSchemaV1,
} from "./receipt-schema.js";

import type { Database } from "@agentbadge/database";

import { createSettlementEmitter } from "./events.js";
import type { SettlementCtx } from "./services/ctx.js";

// R4-M7: the emitter serializes appends through an instance-level
// promise queue — a ctx-per-request means per-request emitters whose
// concurrent flushes can read the same prevHash and fork a stream's
// hash chain. Cache one ctx per Database so every caller shares the
// same serialized queue.
const ctxCache = new WeakMap<Database, SettlementCtx>();

/** Composition seam — routes/tests share one ctx per Database. */
export function createSettlementCtx(db: Database): SettlementCtx {
  const cached = ctxCache.get(db);
  if (cached) return cached;
  const ctx: SettlementCtx = {
    db,
    emit: createSettlementEmitter(db.commerce.events),
  };
  ctxCache.set(db, ctx);
  return ctx;
}
