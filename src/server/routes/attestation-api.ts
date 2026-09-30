/**
 * SLICE-151-3: Readiness attestation routes.
 *
 *   POST /api/attestations — { url, agentId? } → scan → onchain
 *     attestation (giveFeedback via ARC_EVALUATOR_KEY + memo with
 *     report hash) → { scanResult, feedbackTx, memoTx, explorerLinks }
 *   GET  /api/attestations — recent attestations (JSON)
 *   GET  /attestations     — public page listing entries (the live-link
 *     artifact for the microgrant; venue tab shell lands in 151-9)
 *
 * Mounted only when circlePayments.attestation is enabled
 * (ARC_ATTESTATION_ENABLED) — see registerCoreRoutes gate.
 *
 * Two-wallet rule (D6-151): feedback is written by the evaluator key,
 * never by the agent-owner key. Site attestations attach to the oracle
 * agent (ARC_ORACLE_AGENT_ID) or a client-supplied agentId.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { keccak256, toBytes } from "viem";
import {
  ARC_MAINNET,
  ARC_SELF_SETTLE_SCHEME,
} from "@agentbadge/circle-payments";
import { bstockFreemium } from "../middleware/bstock-freemium";
import { createArcBstockFacilitator } from "../lib/bstock/arc-facilitator";
import { assertSafeTarget } from "../../agent-readiness/scanner/ssrf/ip-guard";
import { scanDomain } from "../../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../agent-readiness/rule-engine/rule-engine";
import { formatScanReport } from "../../agent-readiness/report-formatter";
import { createRateLimiter } from "../middleware/rate-limit";
import {
  sharedVenueStore,
  type AttestationEntry,
  type VenueStore,
} from "../lib/attestation-store";
import type { ArcAttestationWriter } from "../lib/arc-attestation";
import { AttestationsPage } from "../../views/attestations";

export interface AttestationScanResult {
  score: number;
  status: string;
  reportHash: `0x${string}`;
}

export interface AttestationRouteConfig {
  /** CAIP-2 network attestations settle on (e.g. eip155:5042002). */
  network: string;
  explorerUrl: string;
  /** Injectable scanner (tests). Default: real scanDomain + RuleEngine. */
  scan?: (url: string) => Promise<AttestationScanResult>;
  /** Injectable chain writer (tests). */
  writeAttestation?: ArcAttestationWriter["write"];
  store?: VenueStore;
  rateLimit?: { windowMs: number; max: number };
}

let routeConfig: AttestationRouteConfig | undefined;

export function setAttestationRouteConfig(
  cfg: AttestationRouteConfig | undefined,
): void {
  routeConfig = cfg;
}

export const attestationRoutes = new Hono();

const limiter = createRateLimiter({ windowMs: 60_000, max: 10 });

// ─── SLICE-151-7: paid attestation gate (x402 on Arc mainnet) ──────
// ATTESTATION_X402_ENABLED=true → free 1 req/min per wallet/IP, over
// that: 402 + eip3009-client-broadcast on eip155:5042, price
// ATTESTATION_X402_PRICE_USD (default $0.25) → payTo X402_PAY_TO.
// Paid access is per-request (no ServicePass minted). GET routes and
// the /attestations page stay free.
let _attestationGate: ReturnType<typeof bstockFreemium> | undefined;
function attestationPaidGate() {
  return async (c: Parameters<ReturnType<typeof bstockFreemium>>[0], next: Parameters<ReturnType<typeof bstockFreemium>>[1]) => {
    if (process.env.ATTESTATION_X402_ENABLED !== "true") return next();
    if (!_attestationGate) {
      _attestationGate = bstockFreemium({
        priceUsd: process.env.ATTESTATION_X402_PRICE_USD ?? "0.25",
        durationSec: 0,
        payTo:
          process.env.ATTESTATION_X402_PAY_TO ??
          process.env.X402_PAY_TO ??
          "",
        networkId: ARC_MAINNET.caip2,
        usdcAddress: ARC_MAINNET.usdc,
        scheme: ARC_SELF_SETTLE_SCHEME,
        maxTimeoutSeconds: 345600,
        extra: { assetTransferMethod: ARC_SELF_SETTLE_SCHEME },
        freePerMin: 1,
        facilitator: createArcBstockFacilitator({
          sellerAddress:
            process.env.ATTESTATION_X402_PAY_TO ??
            process.env.X402_PAY_TO ??
            "",
          chain: ARC_MAINNET,
          rpcUrl: process.env.ARC_MAINNET_RPC_URL,
        }),
        description: "readiness attestation — per-scan access",
      });
    }
    return _attestationGate(c, next);
  };
}

/** Default scanner — wraps scanDomain + RuleEngine into the compact
 *  result the attestation needs (score, status, report hash). */
async function defaultScan(url: string): Promise<AttestationScanResult> {
  const sourceState = await scanDomain(url, {});
  const result = RuleEngine.run(sourceState, {});
  const report = formatScanReport(url, result, {});
  const reportHash = keccak256(toBytes(JSON.stringify(report)));
  return {
    score: report.score,
    status: report.status ?? (report.score >= 70 ? "ready" : "needs-work"),
    reportHash,
  };
}

attestationRoutes.post(
  "/api/attestations",
  describeRoute({
    tags: ["Attestations"],
    summary: "Run scan and write onchain attestation on Arc",
    description:
      "Scans the URL, then writes ERC-8004 giveFeedback (evaluator key) " +
      "and a memo event carrying the report hash. Returns tx hashes + " +
      "explorer links. Writes to the oracle agent unless agentId is given.",
    responses: {
      200: { description: "Attestation written" },
      400: { description: "Missing/invalid url or agentId" },
      402: { description: "Payment required (ATTESTATION_X402_ENABLED)" },
      403: { description: "Private host (SSRF guard)" },
      429: { description: "Rate limited" },
      502: { description: "Scan or chain write failed" },
      503: { description: "ARC_ATTESTATION_ENABLED off" },
    },
  }),
  attestationPaidGate(),
  async (c) => {
    const cfg = routeConfig;
    if (!cfg) return c.json({ error: "attestation feature disabled" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const raw = (body as Record<string, unknown>)?.url;
    if (!raw || typeof raw !== "string") {
      return c.json({ error: "URL is required" }, 400);
    }
    let normalizedUrl = raw.trim();
    if (!normalizedUrl.match(/^https?:\/\//)) {
      normalizedUrl = "https://" + normalizedUrl;
    }
    let hostname: string;
    try {
      hostname = new URL(normalizedUrl).hostname;
    } catch {
      return c.json({ error: `Invalid URL: ${normalizedUrl}` }, 400);
    }
    try {
      assertSafeTarget(hostname);
    } catch {
      return c.json({ error: "Private URLs are not allowed" }, 403);
    }

    const agentIdRaw = (body as Record<string, unknown>)?.agentId;
    let agentId: bigint | undefined;
    if (agentIdRaw !== undefined) {
      try {
        agentId = BigInt(String(agentIdRaw));
      } catch {
        return c.json({ error: "agentId must be a decimal integer" }, 400);
      }
    }

    const rl = await limiter(c, async () => { });
    if (rl instanceof Response) return rl;

    const scan = cfg.scan ?? defaultScan;
    let scanResult: AttestationScanResult;
    try {
      scanResult = await scan(normalizedUrl);
    } catch (e) {
      return c.json(
        { error: `scan failed: ${(e as Error).message}` },
        502,
      );
    }

    const write = cfg.writeAttestation;
    if (!write) {
      return c.json({ error: "attestation writer not configured" }, 503);
    }
    let chainResult: Awaited<ReturnType<ArcAttestationWriter["write"]>>;
    try {
      chainResult = await write({
        agentId,
        url: normalizedUrl,
        domain: hostname,
        score: scanResult.score,
        status: scanResult.status,
        reportHash: scanResult.reportHash,
      });
    } catch (e) {
      return c.json(
        { error: `onchain attestation failed: ${(e as Error).message}` },
        502,
      );
    }

    const store = cfg.store ?? defaultStore;
    const entry: AttestationEntry = {
      id: `${chainResult.memoTx.slice(0, 18)}-${Date.now().toString(36)}`,
      url: normalizedUrl,
      domain: hostname,
      score: scanResult.score,
      status: scanResult.status,
      agentId: chainResult.agentId.toString(),
      feedbackTx: chainResult.feedbackTx,
      memoTx: chainResult.memoTx,
      network: cfg.network,
      createdAt: new Date().toISOString(),
    };
    store.add(entry);

    const explorerLinks = [chainResult.feedbackTx, chainResult.memoTx].map(
      (h) => `${cfg.explorerUrl}/tx/${h}`,
    );
    return c.json({
      scanResult: {
        url: normalizedUrl,
        score: scanResult.score,
        status: scanResult.status,
        reportHash: scanResult.reportHash,
      },
      agentId: chainResult.agentId.toString(),
      feedbackTx: chainResult.feedbackTx,
      memoTx: chainResult.memoTx,
      explorerLinks,
    });
  },
);

const defaultStore = sharedVenueStore();

attestationRoutes.get(
  "/api/attestations",
  describeRoute({
    tags: ["Attestations"],
    summary: "List recent onchain attestations",
    responses: { 200: { description: "Attestation entries" } },
  }),
  (c) => {
    const cfg = routeConfig;
    if (!cfg) return c.json({ error: "attestation feature disabled" }, 503);
    const store = cfg.store ?? defaultStore;
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    return c.json({
      attestations: store.list(limit),
      count: Math.min(store.size(), limit),
      network: cfg.network,
    });
  },
);

attestationRoutes.get("/attestations", (c) => {
  const cfg = routeConfig;
  if (!cfg) return c.json({ error: "attestation feature disabled" }, 503);
  const store = cfg.store ?? defaultStore;
  return c.html(
    AttestationsPage(store.list(50), cfg.explorerUrl).toString(),
  );
});
