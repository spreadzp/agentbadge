// EPIC-155: agent wallet wiring.
// SLICE-155-1: registry + routes. Gated on AGENT_WALLET_ENABLED — off =
// nothing mounts (fail closed). Circle CLI read mirror is best-effort.
// SLICE-155-2: SpendLedger + SpendEnforcer singleton + path gates.
//   wireSpendEnvelopeGates(app) MUST run before the gated routes mount
//   (app.use order in Hono is registration-ordered) — called from
//   index.ts in the early middleware section. It resolves the enforcer
//   lazily per request, so feature-off = pass-through, zero behavior
//   change.

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { createCircleCliClient } from "@agentbadge/circle-payments";
import { getConfig } from "../../config/env";
import {
  createJsonAgentWalletStore,
  createMemoryAgentWalletStore,
} from "../lib/agent-wallet/registry";
import { createSpendLedger } from "../lib/agent-wallet/ledger";
import {
  createSpendEnforcer,
  initSpendEnforcer,
  spendEnvelopeGate,
} from "../lib/agent-wallet/enforcer";
import { createAgentWalletRoutes } from "../routes/agent-wallet-api";
import { createAgentWalletEnvelopeRoutes } from "../routes/agent-wallet-envelope-api";
import { createAgentWalletLimitsRoutes } from "../routes/agent-wallet-limits-api";
import { walletsPage } from "../../views/wallets-page";
import { resolveVenueNetwork } from "../lib/venue/chain";
import { venueMonthlyPriceAtomic } from "../lib/venue/billing";

const ATOMIC = 1e6;
const atomicToUsd = (atomic: string | bigint) => Number(atomic) / ATOMIC;

/**
 * Early-mount path gates — register BEFORE route mounts in index.ts.
 * Every gate: POST-only, resolves wallet (agentWallet ctx → X-Wallet →
 * x402 payer), registry lookup → caps → reserve → settle/release.
 */
export function wireSpendEnvelopeGates(app: Hono): void {
  // 154-2: EaaS verdicts — price depends on request policy.
  app.use(
    "/api/eaas/verdicts",
    spendEnvelopeGate({
      kind: "eaas",
      amountUsdFor: async (c) => {
        const eaas = getConfig().eaas;
        if (!eaas) return 0;
        try {
          const body = (await c.req.json()) as { policy?: string };
          const atomic =
            body?.policy === "readiness-scan" ? eaas.scanUsd : eaas.verdictUsd;
          return atomicToUsd(atomic);
        } catch {
          return 0;
        }
      },
      refIdFor: () => `eaas-verdict:${crypto.randomUUID().slice(0, 12)}`,
    }),
  );

  // 154-3: EaaS external job evaluate — fixed price.
  app.use(
    "/api/eaas/jobs/evaluate",
    spendEnvelopeGate({
      kind: "eaas",
      amountUsdFor: () => {
        const eaas = getConfig().eaas;
        return eaas ? atomicToUsd(eaas.evalUsd) : 0;
      },
    }),
  );

  // 153-5: venue subscription — fixed monthly price. Path-suffix gate
  // over the wildcard (Hono `*` doesn't match mid-path segments in use).
  app.use(
    "/api/venue/instances/*",
    spendEnvelopeGate({
      kind: "subscription",
      amountUsdFor: (c) =>
        c.req.path.endsWith("/subscribe")
          ? atomicToUsd(venueMonthlyPriceAtomic())
          : 0,
      refIdFor: (c) => `sub:${c.req.param("id") ?? c.req.path}`,
    }),
  );
}

export function wireAgentWallet(app: Hono): void {
  const cfg = getConfig().agentWallet;
  if (!cfg?.enabled) {
    initSpendEnforcer(null);
    return;
  }

  const store =
    cfg.store === "memory"
      ? createMemoryAgentWalletStore()
      : createJsonAgentWalletStore();
  const ledger = createSpendLedger(cfg.ledgerStore);

  initSpendEnforcer(
    createSpendEnforcer({
      ledger,
      registry: store,
      requireRegistered: cfg.requireRegistered,
      ...(cfg.defaultCaps ? { defaultCaps: cfg.defaultCaps } : {}),
    }),
  );

  const cli = createCircleCliClient({
    cliPath: cfg.cliPath,
    timeoutMs: cfg.cliTimeoutMs,
  });

  app.route(
    "/",
    createAgentWalletRoutes({
      store,
      cli,
      chain: cfg.chain,
      rateRpm: 60,
    }),
  );
  app.route("/", createAgentWalletEnvelopeRoutes({ store, ledger }));
  app.route(
    "/",
    createAgentWalletLimitsRoutes({
      store,
      ledger,
      cli,
      chain: cfg.chain,
    }),
  );

  // SLICE-155-3: /wallets console — envelope caps/usage + Circle
  // policy mirror + verbatim command handoff (no OTP fields).
  app.get("/wallets", (c) => {
    const net = resolveVenueNetwork();
    const chainHex = `0x${net.chain.chainId.toString(16)}`;
    return c.html(walletsPage(chainHex, cfg.chain));
  });

  logger.info("agent-wallet: wired", {
    store: store.name,
    ledger: ledger.name,
    cliPath: cfg.cliPath,
    chain: cfg.chain,
    requireRegistered: cfg.requireRegistered,
    defaultCaps: cfg.defaultCaps,
  });
}
