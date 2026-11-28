/* Post-marketplace route registrations — extracted from index.ts
 * (token-limit split). Mounted AFTER wireScanPacksX402 +
 * wireMarketplace — totalScanRoutes is gated by the scan-packs x402
 * middleware, so it must not move earlier. Re-exported via index.ts —
 * the public surface is unchanged. */

import type { Hono } from "hono";
import { getConfig } from "../../config/env";
import { logger } from "@agentbadge/passport/logger";

import { totalScanRoutes } from "./scan/total-scan-api";
import { benchmarkRoutes } from "./benchmark/benchmark-api";
import { benchmarkPageRoutes } from "./benchmark/benchmark-pages";
import { teamPageRoutes } from "./pages/team-pages";
import { workRequestRoutes } from "./api/work-requests";
import { workRequestUiRoutes } from "./work/work-request-ui";
import { demandRoutes } from "./api/demand";
import { demandGuideRoutes } from "./agent-guide/demand";
import { changelogRoutes } from "./pages/changelog";
import { agencyJsonRoutes } from "./services/agency-json";
import { profileRoutes } from "./profile/profile";
import { profileViewerRoutes } from "./profile/profile-viewer";
import { attestcoinRoutes, setAttestcoinRouteConfig } from "./attestation/attestcoin";
import { attestationRoutes, setAttestationRouteConfig } from "./attestation/attestation-api";
import { createArcAttestationWriter } from "../lib/arc-attestation";
import {
  ARC_CONTRACTS,
  ARC_MAINNET,
  ARC_MAINNET_CONTRACTS,
  ARC_TESTNET,
} from "@agentbadge/circle-payments";
import { venueApiRoutes } from "./venue/venue-api";
import { venuePageRoutes } from "./venue/venue-pages";
import { seedVenueOffers } from "../lib/venue/store";

export function registerPostMarketplaceRoutes(app: Hono): void {
  app.route("/api", totalScanRoutes);
  app.route("/", benchmarkRoutes);
  app.route("/", benchmarkPageRoutes);
  app.route("/", teamPageRoutes);
  app.route("/", workRequestRoutes);
  app.route("/", workRequestUiRoutes);
  app.route("/", demandRoutes);
  app.route("/", demandGuideRoutes);
  app.route("/", changelogRoutes);
  app.route("/", agencyJsonRoutes);
  app.route("/", profileRoutes);
  app.route("/", profileViewerRoutes);

  // Attestcoin routes (EPIC-127) — only when ATTESTCOIN_ENABLED=true
  const attestcoinConfig = getConfig().attestcoin;
  if (attestcoinConfig.enabled) {
    setAttestcoinRouteConfig({
      enabled: true,
      creditcoinRpcUrl: attestcoinConfig.creditcoinRpcUrl,
      taskStateAddr: attestcoinConfig.taskStateAddr,
    });
    app.route("/", attestcoinRoutes);
    logger.info("Attestcoin routes registered");
  }

  // SLICE-151-3: readiness attestation routes — only when
  // ARC_ATTESTATION_ENABLED=true (gate off → route absent, zero change).
  const cp = getConfig().circlePayments;
  if (cp?.attestation) {
    // SLICE-151-6: ARC_MAINNET_ENABLED flips attestations to mainnet —
    // chain id, rpc, ERC-8004 registries and memo contract switch together.
    const net = cp.arcMainnet ? ARC_MAINNET : ARC_TESTNET;
    const contracts = cp.arcMainnet ? ARC_MAINNET_CONTRACTS : ARC_CONTRACTS;
    setAttestationRouteConfig({
      network: net.caip2,
      explorerUrl:
        net.explorerUrl ??
        (cp.arcMainnet ? "https://explorer.arc.io" : "https://explorer.testnet.arc.io"),
      store: undefined, // default in-memory ring buffer
      writeAttestation: cp.arcEvaluatorKey
        ? createArcAttestationWriter({
          chainId: net.chainId,
          rpcUrl: cp.arcMainnet ? cp.arcMainnetRpcUrl : cp.arcRpcUrl,
          evaluatorKey: cp.arcEvaluatorKey as `0x${string}`,
          oracleAgentId: cp.oracleAgentId ? BigInt(cp.oracleAgentId) : undefined,
          usdc: net.usdc,
          identityRegistry: contracts.identityRegistry,
          reputationRegistry: contracts.reputationRegistry,
          memoContract: contracts.memo,
        }).write
        : undefined,
    });
    app.route("/", attestationRoutes);
    logger.info("Attestation routes registered");
  }

  // SLICE-151-9: venue hub + API — only when ARC_VENUE_ENABLED=true.
  // Gate off → /market stays the ops.ts 301, /api/venue/* absent, zero change.
  if (process.env.ARC_VENUE_ENABLED === "true") {
    seedVenueOffers(); // SLICE-152-1: bstock dogfood offer, idempotent
    app.route("/", venueApiRoutes);
    app.route("/", venuePageRoutes);
    logger.info("Venue routes registered", {
      network: process.env.ARC_NETWORK ?? "testnet",
    });
  }
}
