/**
 * EPIC-228 (SLICE-228-2, D-228-1): actor resolution.
 *
 * Reads identity already established by upstream middleware — this
 * module performs NO verification of its own:
 *   - did-auth.ts verified the signature → c.get("verifiedDid")
 *   - agentKeyAuth resolved an active agb_ key → c.get("agentId")
 *   - neither → anonymous (default; never a downgrade signal)
 *
 * Invalid `agb_` keys already 401 inside agentKeyAuth, so reaching
 * here with a Bearer means either a different credential shape
 * (x402/JWT paths) or anonymous. Verified DID outranks an API key —
 * a signed identity is the stronger signal (D-228-1).
 */

import type { Context } from "hono";

export type ActorResolution = "ANON" | "API_KEY" | "DID";

export interface ResolvedActor {
  resolution: ActorResolution;
  /** Stable identity ref: did string / agentId / null. */
  actorRef: string | null;
  /** Present for API_KEY — feeds the legacy `agentId` compat column. */
  agentId?: string;
  /** API_KEY records are pre-verified by the key lookup itself. */
  verified: boolean;
}

export function resolveActor(c: Context): ResolvedActor {
  const did = c.get("verifiedDid") as string | undefined;
  if (did) return { resolution: "DID", actorRef: did, verified: true };

  const agentId = c.get("agentId") as string | undefined;
  if (agentId) {
    return { resolution: "API_KEY", actorRef: agentId, agentId, verified: true };
  }
  return { resolution: "ANON", actorRef: null, verified: false };
}
