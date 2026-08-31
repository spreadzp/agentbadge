/**
 * Request logging middleware.
 *
 * SLICE-7-5: Logs all HTTP requests with method, path, status, duration.
 * Generates X-Request-Id for correlation. Redacts sensitive headers.
 *
 * Reference: docs/EPICS/7-code-review-improvements/README.md §Phase 2 SLICE-7-5
 */

import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";
import { logger } from "@agentbadge/passport";
import { httpRequestTotal, httpDurationMs } from "../metrics/metrics";
import { redactSecrets } from "../lib/redact";

const SENSITIVE_HEADERS = ["authorization", "x-payment", "cookie", "x-api-key"];

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function requestLoggerMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const requestId = randomUUID();
    c.header("X-Request-Id", requestId);

    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const durationMs = Date.now() - start;
    const status = c.res.status;

    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const context = redactSecrets({
      requestId,
      method,
      path,
      status,
      durationMs,
      headers: redactHeaders(headers),
    });

    if (status >= 400) {
      logger.warn("request", context);
    } else {
      logger.info("request", context);
    }

    httpRequestTotal.labels(method, path, String(status)).inc();
    httpDurationMs.labels(path).observe(durationMs);
  };
}
