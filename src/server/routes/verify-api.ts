/**
 * SLICE-180-1 (EPIC-180): Level-1 public verdict verification —
 * "don't trust us, check it yourself".
 *
 *   GET /api/verify/:verdictId
 *
 * Public, rate-limited facade assembling the stored verdict, machine
 * reason codes, the per-verdict memo anchor state, and the hash-chain
 * status with a head_ref pointer for offline recomputation. Unknown id →
 * honest 404 verdict_not_found — never a 200-fake. Level-2 (the
 * standalone @agentbadge/verify-verdict package, 180-3) re-checks all of
 * this on-chain without trusting this response.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Hex } from "viem";
import { lookupVerdict } from "../lib/verify/lookup";
import { assertProofKind, proofKindsSummary } from "../lib/verify/proof-kinds";
import {
  bad,
  consumerKey,
  createRateLimiter,
  HEX32_RE,
} from "../lib/eaas/request";
import type { VerifyLookupDeps } from "../lib/verify/lookup";

export interface VerifyRoutesDeps extends VerifyLookupDeps {
  /** Per-consumer requests/min cap. */
  rateRpm: number;
}

export function createVerifyRoutes(deps: VerifyRoutesDeps): Hono {
  const routes = new Hono();
  const limiter = createRateLimiter(deps.rateRpm);

  routes.get(
    "/api/verify/:verdictId",
    describeRoute({
      description:
        "Public verdict verification (Level 1): stored VerdictArtifact " +
        "+ reason_codes + memo anchor {txHash,memoId,status} + hash-chain " +
        "{status:server-reported|pending|disabled,head_ref}. Honest " +
        "statuses — unanchored is 'pending', never 'valid'. " +
        "'server-reported' is server-side state, not an on-chain read; " +
        "verify independently via @agentbadge/verify-verdict.",
      responses: {
        200: {
          description:
            "{verdictId,verdict,reason_codes,anchor,chain,verified_at}",
        },
        400: { description: "Invalid verdictId or unknown ?kind=" },
        404: { description: "verdict_not_found" },
        429: { description: "Rate limit exceeded" },
      },
    }),
    (c) => {
      if (!limiter.allow(`verify:${consumerKey(c)}`)) {
        return c.json({ error: "rate limit exceeded" }, 429);
      }
      // SLICE-180-4: optional ?kind= narrows the response to one proof
      // layer — unknown kind → typed unknown_proof_kind (400).
      const kind = c.req.query("kind");
      if (kind !== undefined) {
        try {
          assertProofKind(kind);
        } catch (e) {
          const err = e as { code?: string; kind?: string; known?: string[] };
          return c.json(
            {
              error: "unknown_proof_kind",
              kind: err.kind ?? kind,
              known: err.known ?? [],
            },
            400,
          );
        }
      }
      const id = c.req.param("verdictId");
      if (!HEX32_RE.test(id)) return bad(c, "invalid verdictId");
      const result = lookupVerdict(id as Hex, deps);
      if (!result) return c.json({ error: "verdict_not_found" }, 404);
      const body = { ...result, proof_kinds: proofKindsSummary() };
      if (kind === undefined) return c.json(body);
      // Focused view: only the requested layer's data.
      const proof =
        kind === "verdict"
          ? { verdict: result.verdict, reason_codes: result.reason_codes, anchor: result.anchor }
          : kind === "anchor-head"
            ? { chain: result.chain }
            // 180-6 M-3/N-1: declared-but-unimplemented kinds answer a
            // consistent shape — explicit ok:false, never a 200 that
            // reads as a passed proof.
            : { ok: false, implemented: false, reason: "not_implemented" };
      return c.json({ verdictId: id, kind, proof, verified_at: result.verified_at });
    },
  );

  return routes;
}
