/**
 * SLICE-185-2 (EPIC-185): witness layer wiring.
 *
 * Env:
 *   WITNESS_ENABLED    — "1"/"true" enables POST endpoints (me stays
 *                        readable; off → honest 503 witness_disabled).
 *   WITNESS_WINDOW_SEC — attest window after delivery (default 3600).
 *   WITNESS_DAILY_CAP  — attest credits per agent per UTC day (default 20).
 *   WITNESS_SEAT_DAILY_CAP — seat claims per agent per UTC day (default 10).
 *   WITNESS_STORE      — "memory" | "json" (default "json").
 *   WITNESS_ANCHOR_ENABLED — "1"/"true" opts into onchain memo-anchoring
 *                        of attestations (D-185-7). Needs a chain key.
 *   WITNESS_ANCHOR_RETRIES — anchor attempts before "failed" (default 3).
 *
 * Stores: json backends in .data/ (witness.json, witness-jobs.json,
 * witness-anchors.json). Registration store is a separate json instance
 * over the same file — safe because this wiring only READS (meGate
 * lookups); all writes happen in the agent-registration wiring's
 * instance.
 *
 * SLICE-185-4: rep sink is the v1 log sink (188 lands a real one later);
 * the anchorer reuses the evaluator key + venue network send seam —
 * same EOA that anchors EaaS verdicts, memo domain "witness".
 */
import type { Hono } from "hono";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "@agentbadge/passport";
import { createWitnessRoutes } from "../routes/witness-api";
import { createMemoryWitnessStore } from "../lib/witness/store";
import { createJsonWitnessStore } from "../lib/witness/store-json";
import { createJsonAgentRegistrationStore } from "../lib/agent-registration/store";
import { createJsonWitnessJobSource } from "../lib/witness/jobs";
import { createLogRepSink } from "../lib/witness/rep-bridge";
import {
  createJsonWitnessAnchorStore,
  createWitnessAnchorer,
} from "../lib/witness/anchor";
import { mkEoaSend } from "../lib/eaas/anchor";
import { evaluatorKey } from "../lib/eaas/keys";
import { arcChainFor } from "../lib/marketplace/chain";
import { publicClient, resolveVenueNetwork } from "../lib/venue/chain";
import { getConfig } from "../../config/env";

const envFlag = (name: string): boolean =>
  ["1", "true", "yes"].includes((process.env[name] ?? "").toLowerCase());
const envInt = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function wireWitness(app: Hono): void {
  const store =
    process.env.WITNESS_STORE === "memory"
      ? createMemoryWitnessStore()
      : createJsonWitnessStore();
  const jobs = createJsonWitnessJobSource();

  // ─── SLICE-185-4: memo anchor (opt-in, D-185-7) ───────────────
  let anchorer: ReturnType<typeof createWitnessAnchorer> | undefined;
  if (envFlag("WITNESS_ANCHOR_ENABLED")) {
    const key = evaluatorKey();
    const net = resolveVenueNetwork();
    if (key) {
      const account = privateKeyToAccount(key);
      const chain = arcChainFor(
        getConfig().bstock?.arcNetwork ?? net.chain.caip2,
      );
      const read = publicClient(net);
      const wallet = createWalletClient({
        account,
        chain,
        transport: http(net.chain.rpcUrl),
      });
      anchorer = createWitnessAnchorer({
        store: createJsonWitnessAnchorStore(),
        attestations: store,
        walletFor: async (agentId) => (await store.getEnroll(agentId))?.wallet,
        memo: net.memo,
        selfAddress: account.address,
        send: mkEoaSend({ wallet, account, read, chain }),
        retries: envInt("WITNESS_ANCHOR_RETRIES", 3),
        backoffMs: 5_000,
      });
      anchorer.resumePending();
    } else {
      logger.warn(
        "WITNESS_ANCHOR_ENABLED on but no evaluator key — anchors disabled",
      );
    }
  }

  app.route(
    "/",
    createWitnessRoutes({
      enabled: envFlag("WITNESS_ENABLED"),
      store,
      registrationStore: createJsonAgentRegistrationStore(),
      getJob: (jobId) => jobs.getJob(jobId),
      windowSec: envInt("WITNESS_WINDOW_SEC", 3600),
      dailyCap: envInt("WITNESS_DAILY_CAP", 20),
      seatDailyCap: envInt("WITNESS_SEAT_DAILY_CAP", 10),
      repSink: createLogRepSink(),
      ...(anchorer ? { anchorer } : {}),
    }),
  );
}
