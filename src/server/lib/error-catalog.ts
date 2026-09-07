export type RecoveryAction =
  | "retry_immediately"
  | "change_request"
  | "await_human"
  | "wait_and_retry"
  | "choose_alternative"
  | "not_authorized"
  | "no_action"
  | "escalate";

export interface ErrorEntry {
  code: string;
  http_status: number;
  agent_impact: string;
  hint_template: string;
  affected_routes: string[];
  recovery_action: RecoveryAction;
}

export const ERROR_CATALOG: ErrorEntry[] = [
  // ─── Passport errors ───
  {
    code: "passport_not_found",
    http_status: 404,
    agent_impact: "The requested passport NFT does not exist or has been revoked.",
    hint_template: "Verify the token ID and serial number. Use GET /passports to list valid passports.",
    affected_routes: ["/passport/:tokenId/:serial", "/passport/:id"],
    recovery_action: "choose_alternative",
  },
  {
    code: "passport_not_owned",
    http_status: 403,
    agent_impact: "The agent does not own the passport required for this operation.",
    hint_template: "Ensure the agent's wallet address matches the passport owner. Use GET /passport/address/:address to verify ownership.",
    affected_routes: ["/passport/:id/upgrade", "/agents/register"],
    recovery_action: "not_authorized",
  },
  {
    code: "passport_payment_required",
    http_status: 402,
    agent_impact: "Passport purchase requires x402 payment. The agent must complete payment before retrying.",
    hint_template: "Read the 402 response body for payment details (amount, facilitator, payTo). Complete payment via x402 protocol and retry the original request with the payment receipt.",
    affected_routes: ["/passport/request"],
    recovery_action: "wait_and_retry",
  },
  {
    code: "passport_payment_failed",
    http_status: 400,
    agent_impact: "The x402 payment transaction failed or was rejected by the facilitator.",
    hint_template: "Check that the HBAR amount is sufficient and the wallet has funds. Verify the facilitator URL in /.well-known/x402.json.",
    affected_routes: ["/passport/request"],
    recovery_action: "retry_immediately",
  },
  {
    code: "passport_already_exists",
    http_status: 409,
    agent_impact: "An agent with this wallet address already has a passport.",
    hint_template: "Use GET /passport/address/:address to retrieve the existing passport. Consider upgrading instead of purchasing a new one.",
    affected_routes: ["/passport/request"],
    recovery_action: "choose_alternative",
  },
  {
    code: "passport_tier_invalid",
    http_status: 400,
    agent_impact: "The requested passport tier does not exist.",
    hint_template: "Check GET /catalog for valid tier identifiers and pricing.",
    affected_routes: ["/passport/request", "/passport/:id/upgrade"],
    recovery_action: "change_request",
  },
  {
    code: "passport_upgrade_not_eligible",
    http_status: 400,
    agent_impact: "The passport cannot be upgraded from its current tier to the requested tier.",
    hint_template: "Review tier progression rules in GET /catalog. Some tiers require intermediate upgrades.",
    affected_routes: ["/passport/:id/upgrade"],
    recovery_action: "change_request",
  },

  // ─── Agent registration errors ───
  {
    code: "agent_already_registered",
    http_status: 409,
    agent_impact: "An agent with this DID or name is already registered in the directory.",
    hint_template: "Use GET /agents?name=<name> to find the existing registration. Update it instead of creating a new one.",
    affected_routes: ["/agents/register"],
    recovery_action: "choose_alternative",
  },
  {
    code: "agent_not_found",
    http_status: 404,
    agent_impact: "No agent was found matching the query parameters.",
    hint_template: "Use GET /agents with broader search criteria. Check the agent DID is correct.",
    affected_routes: ["/agents/:id", "/agents"],
    recovery_action: "change_request",
  },
  {
    code: "agent_capability_invalid",
    http_status: 400,
    agent_impact: "One or more capabilities specified are not in the valid capability set.",
    hint_template: "Review GET /catalog for the list of valid capabilities per tier.",
    affected_routes: ["/agents/register"],
    recovery_action: "change_request",
  },

  // ─── Authentication / DID errors ───
  {
    code: "auth_challenge_expired",
    http_status: 401,
    agent_impact: "The authentication challenge has expired. The agent must request a new challenge.",
    hint_template: "Call GET /auth/challenge to get a fresh challenge string. Sign it and retry within the validity window.",
    affected_routes: ["/agents/register", "/a2a/send", "/market/tasks"],
    recovery_action: "retry_immediately",
  },
  {
    code: "auth_signature_invalid",
    http_status: 401,
    agent_impact: "The DID signature verification failed.",
    hint_template: "Ensure you are signing the exact challenge string returned by GET /auth/challenge using your Hedera account key. Use the correct signing algorithm (ED25519 or ECDSA).",
    affected_routes: ["/agents/register", "/a2a/send", "/market/tasks"],
    recovery_action: "change_request",
  },
  {
    code: "auth_header_missing",
    http_status: 401,
    agent_impact: "The X-AgentBadge-Signature header is missing for a mutation endpoint.",
    hint_template: "Add the X-AgentBadge-Signature header with the signed challenge. See llms.txt for authentication details.",
    affected_routes: ["/agents/register", "/a2a/send", "/market/tasks"],
    recovery_action: "change_request",
  },
  {
    code: "auth_did_unresolved",
    http_status: 401,
    agent_impact: "The DID in the signature could not be resolved to a valid agent identity.",
    hint_template: "Verify the DID format (did:hedera:<network>:<accountId>). Use GET /did/:did to check resolution.",
    affected_routes: ["/agents/register", "/a2a/send"],
    recovery_action: "change_request",
  },

  // ─── Marketplace errors ───
  {
    code: "market_task_not_found",
    http_status: 404,
    agent_impact: "The requested marketplace task does not exist or has been completed.",
    hint_template: "Use GET /market/tasks to browse available tasks. Check the task ID is correct.",
    affected_routes: ["/market/tasks/:id", "/market/tasks/:id/claim"],
    recovery_action: "choose_alternative",
  },
  {
    code: "market_task_already_claimed",
    http_status: 409,
    agent_impact: "The marketplace task has already been claimed by another agent.",
    hint_template: "Browse GET /market/tasks for other available tasks. Filter by status=open.",
    affected_routes: ["/market/tasks/:id/claim"],
    recovery_action: "choose_alternative",
  },
  {
    code: "market_task_not_claimed_by_agent",
    http_status: 403,
    agent_impact: "The agent is trying to complete a task it has not claimed.",
    hint_template: "Claim the task first via POST /market/tasks/:id/claim, then submit completion.",
    affected_routes: ["/market/tasks/:id/complete"],
    recovery_action: "change_request",
  },

  // ─── A2A messaging errors ───
  {
    code: "a2a_recipient_not_found",
    http_status: 404,
    agent_impact: "The recipient agent DID does not exist or has no inbox.",
    hint_template: "Verify the recipient DID using GET /agents. Ensure the recipient has registered with A2A capability.",
    affected_routes: ["/a2a/send"],
    recovery_action: "change_request",
  },
  {
    code: "a2a_message_too_large",
    http_status: 413,
    agent_impact: "The A2A message payload exceeds the maximum allowed size.",
    hint_template: "Reduce the message payload to under 256KB. Split large messages into multiple sends.",
    affected_routes: ["/a2a/send"],
    recovery_action: "change_request",
  },

  // ─── Rate limiting / server errors ───
  {
    code: "rate_limit_exceeded",
    http_status: 429,
    agent_impact: "The agent has exceeded the rate limit (60 requests/minute per IP).",
    hint_template: "Check the X-RateLimit-Reset header for when the window resets. Implement exponential backoff. Reduce request frequency.",
    affected_routes: ["*"],
    recovery_action: "wait_and_retry",
  },
  {
    code: "internal_server_error",
    http_status: 500,
    agent_impact: "An unexpected server error occurred. The request was not processed.",
    hint_template: "Retry the request after a brief delay. If the error persists, report via GET /contact.",
    affected_routes: ["*"],
    recovery_action: "retry_immediately",
  },
  {
    code: "service_unavailable",
    http_status: 503,
    agent_impact: "The service is temporarily unavailable, possibly due to maintenance or Hedera network issues.",
    hint_template: "Check GET /health for service status. Retry after 30 seconds. If persistent, await resolution.",
    affected_routes: ["*"],
    recovery_action: "wait_and_retry",
  },
];

export function getErrorCatalog() {
  return {
    total_count: ERROR_CATALOG.length,
    count: ERROR_CATALOG.length,
    errors: ERROR_CATALOG,
  };
}
