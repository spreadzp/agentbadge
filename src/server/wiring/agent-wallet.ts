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
import {
  createCircleCliClient,
  ARC_MAINNET,
  ARC_TESTNET,
} from "@agentbadge/circle-payments";
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
import { createAgentWalletBalanceRoutes } from "../routes/agent-wallet-balance-api";
import { createSpendAuditRoutes } from "../routes/agent-wallet-audit-api";
import { readWalletBalance } from "../lib/agent-wallet/balance";
import { startLowBalanceSweeper } from "../lib/agent-wallet/funding";
import {
  createJsonSpendAlertStore,
  detectStaleReserves,
  emitSpendAlert,
  getSpendAlertStore,
  initSpendAlerts,
} from "../lib/agent-wallet/audit";
import { walletsPage } from "../../views/wallets-page";
import { resolveVenueNetwork } from "../lib/venue/chain";
import { venueMonthlyPriceAtomic } from "../lib/venue/billing";

const ATOMIC = 1e6;
const atomicToUsd = (atomic: string | bigint) => Number(atomic) / ATOMIC;

/**
 * Early-mount path gates — register BEFORE route mounts in index.ts.
 * POST-only, resolves wallet → caps → reserve → settle/release.
 * SLICE-155-4 note: routes behind `requirePayment` (EaaS verdicts/
 * evaluate, billing) are covered by the package-level onBeforeSettle
 * hook (verified payer, pre-settle reserve) — do NOT gate them here
 * or reservations would double-count. Only custom-seam endpoints
 * (venue subscribe via deps.subscriptionSettle) need a path gate.
 */
export function wireSpendEnvelopeGates(app: Hono): void {
  // 153-5: venue subscription — fixed monthly price over a custom
  // x402 settle seam (not requirePayment → hooks don't fire).
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

  // SLICE-155-5: balance mirror (CLI→RPC fallback + gateway) +
  // funding handoff (transfer QR, verbatim gateway deposit).
  const arcChain =
    cfg.chain.toUpperCase() === "ARC" ? ARC_MAINNET : ARC_TESTNET;
  const gatewayApiUrl = getConfig().circlePayments?.gatewayApiUrl;
  app.route(
    "/",
    createAgentWalletBalanceRoutes({
      store,
      chain: cfg.chain,
      chainId: arcChain.chainId,
      readBalance: (address) =>
        readWalletBalance(address, {
          cli,
          chain: cfg.chain,
          rpcUrl: arcChain.rpcUrl,
          usdcAddress: arcChain.usdc,
          gatewayApiUrl,
          domain: arcChain.domain,
        }),
    }),
  );

  // SLICE-155-6: spend audit — alert store + emit singleton +
  // feed/stats routes + stale-reserve sweep.
  initSpendAlerts({
    store: createJsonSpendAlertStore(),
    ...(cfg.alertWebhookUrl ? { webhookUrl: cfg.alertWebhookUrl } : {}),
  });
  app.route(
    "/",
    createSpendAuditRoutes({ store, ledger, alerts: getSpendAlertStore }),
  );
  const staleMs = cfg.staleReserveMin * 60_000;
  setInterval(
    () =>
      detectStaleReserves({
        ledger,
        wallets: store.list(),
        staleMs,
      }),
    60_000,
  ).unref();

  // Low-balance signal — daily sweep, alert event + optional webhook.
  startLowBalanceSweeper({
    wallets: () => store.list().filter((w) => w.active),
    readBalance: (address) =>
      readWalletBalance(address, {
        cli,
        chain: cfg.chain,
        rpcUrl: arcChain.rpcUrl,
        usdcAddress: arcChain.usdc,
      }),
    thresholdUsd: cfg.lowUsd,
    onAlert: (ev) => {
      const rec = store.get(ev.address);
      emitSpendAlert("wallet.low_balance", ev.address, {
        usdc: ev.usdc,
        thresholdUsd: ev.thresholdUsd,
        source: ev.source,
      }, rec?.venueId);
    },
    ...(cfg.lowWebhookUrl ? { webhookUrl: cfg.lowWebhookUrl } : {}),
  });

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
