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
  normalizeOperator,
  checkTextField,
  isMeaningfulEvidence,
  isEvmAddress,
  normalizeTxHash,
  OPERATOR_MAX_LEN,
  MAX_TEXT_FIELD,
  MAX_ID_FIELD,
  MAX_PAYEE_LEN,
  MAX_CURRENCY_LEN,
  MAX_AMOUNT_LEN,
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
  refundUsage,
  listRefundIntents,
  type CreateRefundIntentInput,
} from "./refund-intents";
export {
  completeRefundIntent,
  type CompleteRefundIntentInput,
} from "./refund-completion";
export {
  stripeRefund,
  type StripeRefundInput,
  type StripeRefundResult,
} from "./stripe-refunds";
export {
  detectExceptions,
  detectFromPaymentExceptions,
  resolveException,
  listExceptions,
  type ResolveExceptionInput,
} from "./exceptions";
