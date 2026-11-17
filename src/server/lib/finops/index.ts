/**
 * EPIC-226 / SLICE-226-2 — admin FinOps domain services.
 * Routes/HTMX land in 226-3; this barrel is the domain surface.
 */

export * from "./types";
export {
  requireOperator,
  checkEvidence,
  guardAction,
  isDecimalString,
  decimalToMicro,
  microToDecimal,
  sumDecimals,
  decimalGt,
  decimalLte,
  decimalSub,
  feeOf,
} from "./guards";
export {
  actorLabels,
  listPayments,
  getPaymentDetail,
  tracePayment,
} from "./read-models";
export { finReport } from "./reports";
export {
  recordAdminAction,
  reviewPayment,
  retryVerification,
  markExternalReviewed,
  listAdminActions,
  type RecordAdminActionInput,
  type RetryVerifyResult,
} from "./admin-actions";
export {
  createRefundIntent,
  completeRefundIntent,
  stripeRefund,
  listRefundIntents,
  type CreateRefundIntentInput,
  type CompleteRefundIntentInput,
  type StripeRefundInput,
  type StripeRefundResult,
} from "./refund-intents";
export {
  detectExceptions,
  detectFromPaymentExceptions,
  resolveException,
  listExceptions,
  type ResolveExceptionInput,
} from "./exceptions";
