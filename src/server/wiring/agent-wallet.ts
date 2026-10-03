// EPIC-155 SLICE-155-1: agent wallet registry wiring.
// Gated on AGENT_WALLET_ENABLED — off = nothing mounts (fail closed).
// Circle CLI read mirror is best-effort: binary absent → routes still
// serve, balance/limits degrade to "unavailable" (never blocks boot).

import type { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import { createCircleCliClient } from "@agentbadge/circle-payments";
import { getConfig } from "../../config/env";
import {
  createJsonAgentWalletStore,
  createMemoryAgentWalletStore,
} from "../lib/agent-wallet/registry";
import { createAgentWalletRoutes } from "../routes/agent-wallet-api";

export function wireAgentWallet(app: Hono): void {
  const cfg = getConfig().agentWallet;
  if (!cfg?.enabled) return;

  const store =
    cfg.store === "memory"
      ? createMemoryAgentWalletStore()
      : createJsonAgentWalletStore();

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

  logger.info("agent-wallet: wired", {
    store: store.name,
    cliPath: cfg.cliPath,
    chain: cfg.chain,
  });
}
