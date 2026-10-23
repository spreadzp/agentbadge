/**
 * SLICE-204-5: Risk API — `GET /api/v1/risk/:address?chain=`
 *
 * Public pre-payment check: seller verdict + organic share + reasons.
 * Mirror of the reference `GET /v1/check/:address` — v1 is free (O3).
 *
 * Honest-by-contract (D-204-5): thin/empty index → `no_data` (never
 * silently "pass"); FORENSICS_ENABLED=off → no_data + reason. Response
 * always carries coveredPct + indexedToBlock + lagBlocks (freshness).
 * Privacy (AC): caller address is never stored.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { createPublicClient, http } from "viem";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { assessAddress, NO_DATA_DISABLED } from "../lib/forensics/risk-service";

export const riskRoutes = new Hono();

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const riskLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

/** chain → tip probe. Cached clients per chain; unknown chain → null (honest). */
const tipClients = new Map<string, ReturnType<typeof createPublicClient>>();
const CHAIN_RPC: Record<string, { env: string; def: string }> = {
  "5042": { env: "ARC_MAINNET_RPC_URL", def: "https://rpc.mainnet.arc.io" },
  "5042002": {
    env: "ARC_RPC_URL",
    def: "https://rpc.blockdaemon.testnet.arc.network",
  },
};

function makeTipProbe(chain: string): (() => Promise<bigint | null>) | undefined {
  const cfg = CHAIN_RPC[chain];
  if (!cfg) return undefined;
  return async () => {
    let cl = tipClients.get(chain);
    if (!cl) {
      cl = createPublicClient({
        transport: http(process.env[cfg.env] ?? cfg.def),
      });
      tipClients.set(chain, cl);
    }
    return cl.getBlockNumber();
  };
}

riskRoutes.get(
  "/api/v1/risk/:address",
  describeRoute({
    tags: ["Forensics"],
    summary: "Pre-payment risk check for a seller address",
    description:
      "Payment-graph forensics: verdict (pass|caution|block|no_data), " +
      "organic revenue share, human-readable reasons, index freshness " +
      "(indexedToBlock + lagBlocks). no_data is NOT pass — treat as " +
      "unrated. Free in v1; 60 req/min per IP.",
    responses: {
      200: { description: "Risk verdict (check `verdict` field)" },
      400: { description: "Invalid address format" },
      429: { description: "Rate limited" },
    },
  }),
  async (c) => {
    const rl = await riskLimiter(c, async () => {});
    if (rl) return rl;

    const address = c.req.param("address");
    if (!ADDRESS_RE.test(address)) {
      return c.json({ error: "bad_address", verdict: "no_data" }, 400);
    }
    if (process.env.FORENSICS_ENABLED === "false") {
      return c.json(NO_DATA_DISABLED);
    }
    const chain = c.req.query("chain") ?? "5042";
    const db = getDatabase();
    const verdict = await assessAddress(address.toLowerCase(), {
      stores: db.forensics,
      chain,
      getTip: makeTipProbe(chain),
    });
    return c.json(verdict);
  },
);
