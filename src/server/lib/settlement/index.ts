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
  submitForReview,
  transitionMilestone,
} from "./services/milestone-service.js";
export { markLegPaid } from "./services/payout-service.js";
export {
  getIntentView,
  listIntents,
} from "./services/payout-queries.js";
export type { MarkPaidResult } from "./services/payout-service.js";
export {
  getDispute,
  listDisputes,
  raiseDispute,
} from "./services/dispute-service.js";
export { resolveDispute } from "./services/dispute-resolve.js";

import type { Database } from "@agentbadge/database";

import { createSettlementEmitter } from "./events.js";
import type { SettlementCtx } from "./services/ctx.js";

/** Composition seam — routes/tests build one ctx per Database. */
export function createSettlementCtx(db: Database): SettlementCtx {
  return { db, emit: createSettlementEmitter(db.commerce.events) };
}
