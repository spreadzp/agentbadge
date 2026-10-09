/**
 * EPIC-191: fxdelta wiring — /mcp/fxdelta middleware chain, Telegram
 * bot hooks, and Arc anchoring (191-9). Extracted from
 * mcp-namespaces.ts to stay under the file cap.
 */

import type { Hono } from "hono";
import { keccak256, encodePacked, stringToHex } from "viem";

import { bstockFreemium } from "../middleware/bstock-freemium";
import { getConfig } from "../../config/env";
import {
  bstockAuth,
  bstockRateLimit,
  bstockSseCap,
  BstockSseCap,
} from "../middleware/bstock-gate";
import {
  getFxDeltaRuntime,
  setFxDeltaAnchorQueue,
} from "../lib/fx-delta";
import { getFxDeltaFacilitator } from "../lib/fx-delta/facilitator-env";
import {
  CELO_X402_ASSETS,
  CELO_X402_NETWORK,
  CELO_X402_SCHEME,
} from "../lib/fx-delta/celo-assets";
import { getFxDeltaTelegramBot } from "../../telegram/state";
import { getArcEventLogWriter } from "../lib/fx-delta/arc-writer";
import { AnchorQueue, createAlertAnchor } from "../lib/fx-delta/anchor";
import { createNamespaceRoutes } from "../routes/mcp-namespace";

export function wireFxDeltaNamespace(app: Hono): void {
  if (process.env.FXDELTA_ENABLED !== "true" || !getFxDeltaRuntime()) {
    return;
  }
  const rt = getFxDeltaRuntime()!;
  const tokens = new Map<string, string>();
  for (const pair of (
    process.env.FXDELTA_AGENT_TOKENS ??
    process.env.MCP_AGENT_TOKENS ??
    ""
  ).split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) tokens.set(pair.slice(i + 1).trim(), pair.slice(0, i).trim());
  }
  const fac = getFxDeltaFacilitator();
  app.use(
    "/mcp/fxdelta/*",
    bstockAuth(tokens),
    ...(fac
      ? [
        bstockFreemium({
          serviceId: keccak256(
            encodePacked(
              ["bytes32"],
              [stringToHex("fxdelta-celo-premium", { size: 32 })],
            ),
          ),
          priceUsd: process.env.FXDELTA_PRICE_USD ?? "0.005",
          durationSec: 300,
          payTo: process.env.FXDELTA_PAY_TO ?? "",
          networkId: CELO_X402_NETWORK,
          usdcAddress: CELO_X402_ASSETS.USDC.address,
          scheme: CELO_X402_SCHEME,
          freePerMin: 1,
          keyedPerMin: getConfig().agentRegistration?.keyRpm ?? 10,
          facilitator: fac,
        }),
      ]
      : []),
    bstockRateLimit(Number(process.env.FXDELTA_RATE_LIMIT_PER_MIN ?? 60)),
    bstockSseCap(
      new BstockSseCap(Number(process.env.FXDELTA_MAX_SSE ?? 20)),
    ),
  );
  app.route("/mcp/fxdelta", createNamespaceRoutes("fxdelta"));

  // Telegram bot — webhook + on-demand commands (DM model).
  const fxBot = getFxDeltaTelegramBot(rt.engine);
  if (fxBot) {
    app.route("/", fxBot.routes);
    setInterval(() => void fxBot.digestTick(), 3_600_000).unref();
    if (process.env.FXDELTA_TG_PUSH_ENABLED === "true") {
      setInterval(() => void fxBot.alertTick(), 60_000).unref();
    }
  }

  // SLICE-191-9: Arc anchoring — alert transitions → AgentEventLog.
  // Async + retry: a dead Arc RPC never blocks the feed.
  const arcWriter = getArcEventLogWriter();
  if (arcWriter) {
    const queue = new AnchorQueue({
      writer: arcWriter.writer,
      retryMs: Number(process.env.FXDELTA_ANCHOR_RETRY_MS ?? 30_000),
    });
    setFxDeltaAnchorQueue(queue);
    const watcher = createAlertAnchor(rt.engine, queue);
    queue.start();
    setInterval(() => watcher.tick(), 5_000).unref();
  }
}
