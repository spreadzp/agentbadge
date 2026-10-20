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

  // 402/503 — bounty funding (EPIC-197-11)
  SPEND_CAP: "spend_cap",
  BOUNTY_DISABLED: "bounty_disabled",
  PASSPORT_CHAIN_DISABLED: "passport_chain_disabled",

  // 409 — bounty lifecycle (EPIC-197)
  BOUNTY_ALREADY_CLAIMED: "bounty_already_claimed",
  BOUNTY_COOLDOWN: "bounty_cooldown",
  BOUNTY_CAP_REACHED: "bounty_cap_reached",
  BOUNTY_NOT_HOLDER: "bounty_not_holder",
  BOUNTY_LEASE_EXPIRED: "bounty_lease_expired",
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

  // 4xx — witness layer (EPIC-185; snake_case wire values,
  // charge:never in the catalog — endpoints are free)
  WITNESS_DISABLED: "witness_disabled",
  WITNESS_NOT_ENROLLED: "witness_not_enrolled",
  WITNESS_ALREADY_ENROLLED: "witness_already_enrolled",
  WITNESS_INVALID_DOMAINS: "witness_invalid_domains",
  WITNESS_INVALID_AGENT_ID: "witness_invalid_agent_id",
  WITNESS_INVALID_WALLET: "witness_invalid_wallet",
  WITNESS_SUSPENDED: "witness_suspended",
  WITNESS_JOB_NOT_FOUND: "witness_job_not_found",
  WITNESS_NOT_DELIVERED: "witness_not_delivered",
  WITNESS_OPT_OUT: "witness_opt_out",
  WITNESS_CONFLICT: "witness_conflict",
  WITNESS_NO_SEATS: "witness_no_seats",
  WITNESS_WINDOW_CLOSED: "witness_window_closed",
  WITNESS_BAD_SIGNATURE: "witness_bad_signature",
  WITNESS_DUPLICATE: "witness_duplicate",
  WITNESS_DAILY_CAP: "witness_daily_cap",

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
