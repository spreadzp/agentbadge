export const ErrorCodes = {
  // 400 — validation
  INVALID_JSON: "INVALID_JSON",
  MISSING_FIELDS: "MISSING_FIELDS",
  INVALID_DID_FORMAT: "INVALID_DID_FORMAT",
  INVALID_ENDPOINT_URL: "INVALID_ENDPOINT_URL",
  INVALID_PRICE: "INVALID_PRICE",
  INVALID_CAPABILITIES: "INVALID_CAPABILITIES",
  INVALID_PAGINATION: "INVALID_PAGINATION",
  SECRET_REJECTED: "SECRET_REJECTED",
  INVALID_INPUT: "INVALID_INPUT",
  WORK_REQUEST_NOT_FOUND: "WORK_REQUEST_NOT_FOUND",

  // 402 — payment
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  SESSION_BUDGET_EXCEEDED: "SESSION_BUDGET_EXCEEDED",

  // 402 — agent wallet owner controls (EPIC-176; snake_case wire values
  // matching the deny-JSON convention, e.g. "spend_cap")
  APPROVAL_REQUIRED: "approval_required",
  SPEND_SUSPENDED: "spend_suspended",
  VELOCITY_TX: "velocity_tx",
  VELOCITY_AMOUNT: "velocity_amount",
  KIND_NOT_ALLOWED: "kind_not_allowed",
  APPROVAL_QUEUE_FULL: "approval_queue_full",

  // 409 — approval decide conflicts (EPIC-176-9)
  APPROVAL_ALREADY_DECIDED: "approval_already_decided",
  APPROVAL_EXPIRED: "approval_expired",

  // 403 — passport/identity
  PASSPORT_NOT_FOUND: "PASSPORT_NOT_FOUND",
  PASSPORT_REVOKED: "PASSPORT_REVOKED",
  PASSPORT_OWNERSHIP_MISMATCH: "PASSPORT_OWNERSHIP_MISMATCH",
  PASSPORT_TYPE_REQUIRED: "PASSPORT_TYPE_REQUIRED",
  PASSPORT_TYPE_MISMATCH: "PASSPORT_TYPE_MISMATCH",
  WRONG_SIGNER: "WRONG_SIGNER",

  // 404 — not found
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",

  // 409 — conflict
  AGENTCARD_DID_CONFLICT: "AGENTCARD_DID_CONFLICT",
  TASK_ALREADY_CLAIMED: "TASK_ALREADY_CLAIMED",
  ESCROW_SIGNATURE_REQUIRED: "ESCROW_SIGNATURE_REQUIRED",

  // 422 — verification
  VERIFICATION_FAILED: "VERIFICATION_FAILED",

  // 429 — rate limit
  RATE_LIMITED: "RATE_LIMITED",
  REGISTER_RATE_LIMITED: "register_rate_limited",
  SPONSORED_QUOTA_EXCEEDED: "sponsored_quota_exceeded",

  // 401 — agent api keys (EPIC-184; snake_case wire values)
  AGENT_KEY_INVALID: "agent_key_invalid",
  AGENT_KEY_REVOKED: "agent_key_revoked",

  // Refusal contract (EPIC-181; snake_case wire values matching
  // REFUSAL_MATRIX in lib/refusal-contract.ts)
  POLICY_REFUSAL: "policy_refusal",
  INSUFFICIENT_SUBJECT: "insufficient_subject",
  EXECUTION_FAILED: "execution_failed",
  DATA_UNAVAILABLE: "data_unavailable",

  // 500 — server
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_STATE: "INVALID_STATE",
  HCS_SUBMISSION_FAILED: "HCS_SUBMISSION_FAILED",
  MIRROR_NODE_UNAVAILABLE: "MIRROR_NODE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
