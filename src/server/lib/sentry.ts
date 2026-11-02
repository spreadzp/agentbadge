/**
 * Error capture hook (formerly SLICE-7-6 Sentry integration).
 *
 * Sentry was removed from production (no paid DSN, no SDK loaded).
 * `captureError` keeps the call-site contract and records the error
 * through the structured logger.
 */

import { logger } from "@agentbadge/passport/logger";

export function captureError(error: Error | unknown, context?: Record<string, unknown>): void {
  logger.error("Captured error", { error, ...context });
}
