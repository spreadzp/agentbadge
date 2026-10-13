/**
 * SLICE-185-2: generic rate-limit / server-error catalog entries.
 * Extracted from error-catalog.ts for the 300-line lint cap.
 */
import type { ErrorEntry } from "./error-catalog";

export const GENERIC_ERROR_ENTRIES: ErrorEntry[] = [
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
