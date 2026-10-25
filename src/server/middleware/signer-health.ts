/**
 * EPIC-173 (SLICE-173-2): signer health-gate for paid routes.
 *
 * D-173-4 fail-fast: when the money-signer is the unix-socket service
 * (SIGNER_BACKEND=socket), a dead signer must refuse BEFORE the x402
 * payment is taken — 503 signer_unavailable, never charge for work we
 * cannot settle. Free routes (contract list, replay responses) do not
 * take this gate and keep serving.
 *
 * `ping` is absent on the env backend — the gate is then a no-op (the
 * key is in-process; "unreachable" cannot happen mid-request).
 */

import type { Context, Next } from "hono";
import { logger } from "@agentbadge/passport/logger";

export function signerHealthGate(
  ping: (() => Promise<unknown>) | undefined,
) {
  return async (c: Context, next: Next) => {
    if (!ping) return next();
    try {
      await ping();
    } catch (e) {
      logger.warn("signer health-gate refused paid route", {
        path: c.req.path,
        error: e instanceof Error ? e.message : String(e),
      });
      return c.json(
        {
          error: "signer_unavailable",
          hint: "settlement signing service unreachable — retry shortly; no charge was taken",
        },
        503,
      );
    }
    return next();
  };
}
