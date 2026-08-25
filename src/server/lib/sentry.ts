/**
 * Sentry error tracking integration.
 *
 * SLICE-7-6: Optional error tracking via Sentry.
 * - Initializes only when SENTRY_DSN env var is set.
 * - Captures uncaught exceptions and unhandled rejections.
 * - No-op when SENTRY_DSN is absent (zero overhead).
 *
 * Reference: docs/EPICS/7-code-review-improvements/README.md §Phase 3 SLICE-7-6
 */

import * as Sentry from "@sentry/node";
import { logger } from "@agentgate-hedera/passport";
import { redactSecrets } from "./redact";

let enabled = false;

/**
 * Initialize Sentry if SENTRY_DSN is set.
 * Returns true if initialized, false if skipped.
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("Sentry disabled — SENTRY_DSN not set");
    return false;
  }

  const environment = process.env.HEDERA_NETWORK ?? "testnet";

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request?.data) {
        event.request.data = redactSecrets(event.request.data as Record<string, unknown>);
      }
      if (event.contexts) {
        event.contexts = redactSecrets(event.contexts as Record<string, unknown>) as typeof event.contexts;
      }
      if (event.extra) {
        event.extra = redactSecrets(event.extra as Record<string, unknown>);
      }
      return event;
    },
  });

  enabled = true;

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err });
    Sentry.captureException(err);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { error: reason });
    Sentry.captureException(reason);
  });

  logger.info("Sentry initialized", { environment });
  return true;
}

/**
 * Capture an error to Sentry if enabled.
 * No-op when Sentry is not initialized.
 */
export function captureError(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(error, context);
}

/**
 * Returns whether Sentry is currently enabled.
 */
export function isSentryEnabled(): boolean {
  return enabled;
}
