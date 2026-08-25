/**
 * Key-endpoint gate middleware (EPIC-83 SLICE-83-2).
 *
 * Returns 410 Gone for key-accepting endpoints unless ALLOW_KEY_ENDPOINTS=true.
 * This prevents raw private keys from crossing the network in default deployments.
 */

import type { Context, Next } from "hono";

// Endpoints that accept raw private keys in request bodies
const KEY_ENDPOINT_PATTERNS: RegExp[] = [
  /\/market\/sign$/,
  /\/market\/tasks\/signed$/,
  /\/market\/tasks\/[^/]+\/claim-with-key$/,
  /\/market\/tasks\/[^/]+\/deliver-with-key$/,
  /\/market\/tasks\/[^/]+\/complete-with-key$/,
  /\/a2a\/send-with-key$/,
];

function isKeyEndpoint(path: string): boolean {
  return KEY_ENDPOINT_PATTERNS.some((p) => p.test(path));
}

export function keyEndpointGate() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    if (process.env.ALLOW_KEY_ENDPOINTS === "true") {
      return next();
    }

    const path = c.req.path;
    if (isKeyEndpoint(path)) {
      return c.json(
        {
          error: "gone",
          message:
            "This key-accepting endpoint is disabled. Use the signature-based alternative. " +
            "Set ALLOW_KEY_ENDPOINTS=true to re-enable for demo purposes.",
          migration: "See llms.txt §keyless-endpoints for migration guide.",
        },
        410,
      );
    }

    return next();
  };
}
