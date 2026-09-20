/**
 * Marketplace API routes (EPIC-138, SLICE-138-3).
 *
 * Business onboarding + service registry + buyer passes:
 *   POST /api/market/passport        — x402-gated (wired in index.ts);
 *                                      sig-auth'd wallet gets a Business
 *                                      Passport minted on Arc
 *   POST /api/market/services        — sig-auth'd passport owner registers
 *                                      a service on-chain + catalog
 *   GET  /api/market/services        — catalog (D18), ?category=&q= filters
 *   GET  /api/market/services/:id    — detail + buyUrl
 *   POST /api/market/buy/:serviceId  — x402-gated; settle → splitter credit
 *                                      + service pass mint (afterSettle hook)
 *   GET  /api/market/passes/:wallet  — buyer's passes + expiry
 *   GET  /api/market/meta/:hash      — locally pinned metadata (D16 fallback)
 *
 * Registered only when marketplace.enabled. All mints via our signer (D13).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isAddress } from "viem";
import { logger } from "@agentbadge/passport";
import { getConfig } from "../../config/env";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import {
  requireWalletSig,
  type AgentAuthVariables,
} from "../middleware/agent-auth";
import {
  getMarketplaceOps,
  getService,
  listServices,
  upsertService,
  getMeta,
  pinMarketplaceMetadata,
  serviceIdFor,
  subIdToBytes32,
  usdToBaseUnits,
  validatePassportMeta,
  validateServiceMeta,
} from "../lib/marketplace";

const DAY_SEC = 86_400;

function buyUrl(serviceId: string): string {
  const base = process.env.BASE_URL ?? "https://agentbadge.xyz";
  return `${base}/api/market/buy/${serviceId}`;
}

function serviceJson(svc: ReturnType<typeof getService> & object) {
  return {
    serviceId: svc.serviceId,
    passportId: svc.passportId,
    owner: svc.owner,
    subId: svc.subId,
    name: svc.name,
    description: svc.description,
    category: svc.category,
    docsUrl: svc.docsUrl,
    endpointUrl: svc.endpointUrl,
    price: { amount: svc.priceUsd, currency: "USDC" },
    durationDays: svc.durationDays,
    durationSec: svc.durationSec ?? svc.durationDays * 86_400,
    metaURI: svc.metaURI,
    buyUrl: buyUrl(svc.serviceId),
    createdAt: svc.createdAt,
  };
}

export const marketplaceApiRoutes = new Hono<{
  Variables: AgentAuthVariables;
}>();

// ─── POST /api/market/passport — business onboarding ───────────
// x402-gated upstream (index.ts); sig verified again here for the mint target.
marketplaceApiRoutes.post(
  "/market/passport",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Mint a Business Passport (x402-gated)",
    description:
      "Paid endpoint: x402 payment to treasury, then mintPassport to the " +
      "X-Wallet signer. Body: {name, endpointUrl, category, description, docsUrl} (D10).",
    responses: {
      200: { description: "Passport minted" },
      400: { description: "Invalid metadata" },
      401: { description: "Missing/invalid wallet signature" },
      402: { description: "Payment required" },
    },
  }),
  async (c) => {
    const wallet = c.req.header("x-wallet");
    if (!wallet || !isAddress(wallet)) {
      return errorResponse(
        c,
        401,
        ErrorCodes.MISSING_FIELDS,
        "X-Wallet header required (passport mint target)",
      );
    }
    // Signature was verified pre-payment by onProtectedRequest; re-check
    // cheaply here since the wallet is the mint target.
    const { verifyWalletSigRequest } = await import(
      "../middleware/agent-auth"
    );
    const sig = await verifyWalletSigRequest({
      wallet,
      signature: c.req.header("x-sig"),
      timestamp: c.req.header("x-timestamp"),
      method: c.req.method,
      path: c.req.path,
    });
    if (sig !== "valid") {
      return errorResponse(
        c,
        401,
        ErrorCodes.INVALID_INPUT,
        "Signature verification failed",
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }
    const v = validatePassportMeta(body);
    if (!v.ok) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, v.error);
    }

    const cfg = getConfig().marketplace!;
    const metaURI = await pinMarketplaceMetadata({
      type: "business-passport",
      ...v.value,
    });
    const ops = getMarketplaceOps();
    try {
      const tx = await ops.mintPassport(
        wallet.toLowerCase(),
        metaURI,
        cfg.passportDurationDays * DAY_SEC,
      );
      const passportId = await ops.passportOf(wallet.toLowerCase());
      return c.json({
        passportId: passportId.toString(),
        owner: wallet.toLowerCase(),
        metaURI,
        mintTx: tx,
        expiresInDays: cfg.passportDurationDays,
      });
    } catch (err) {
      // Payment already settled — log loudly for manual resolution.
      logger.error("marketplace: passport mint failed after payment", {
        wallet,
        err: String(err),
      });
      return errorResponse(
        c,
        500,
        ErrorCodes.INTERNAL_ERROR,
        "Payment settled but passport mint failed — contact support",
      );
    }
  },
);

// ─── POST /api/market/services — register a service ────────────
marketplaceApiRoutes.post(
  "/market/services",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Register a service under your Business Passport",
    description:
      "Sig-auth (X-Wallet/X-Sig/X-Timestamp). Caller must own a valid " +
      "passport. Body: {passportTokenId, subId, name, priceUsd, durationDays|durationSec, " +
      "description?, category?, docsUrl?, endpointUrl?}.",
    responses: {
      200: { description: "Service registered" },
      400: { description: "Invalid metadata" },
      401: { description: "Missing/invalid wallet signature" },
      403: { description: "Not the passport owner / passport invalid" },
    },
  }),
  requireWalletSig(),
  async (c) => {
    const wallet = c.get("agentWallet");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }
    const v = validateServiceMeta(body);
    if (!v.ok) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, v.error);
    }

    const ops = getMarketplaceOps();
    const passportId = BigInt(v.value.passportTokenId);

    // Ownership + validity checks (D9: mint only through our server).
    let owner: string;
    let valid: boolean;
    try {
      [owner, valid] = await Promise.all([
        ops.passportOwner(passportId),
        ops.passportValid(passportId),
      ]);
    } catch (err) {
      return errorResponse(
        c,
        403,
        ErrorCodes.PASSPORT_NOT_FOUND,
        `Passport ${v.value.passportTokenId} not found: ${String(err)}`,
      );
    }
    if (owner.toLowerCase() !== wallet) {
      return errorResponse(
        c,
        403,
        ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
        "Caller does not own this passport",
      );
    }
    if (!valid) {
      return errorResponse(
        c,
        403,
        ErrorCodes.PASSPORT_REVOKED,
        "Passport expired or revoked",
      );
    }

    const metaURI = await pinMarketplaceMetadata({
      type: "service",
      ...v.value,
    });
    const subId32 = subIdToBytes32(v.value.subId);
    const priceBase = usdToBaseUnits(v.value.priceUsd);
    const serviceId = serviceIdFor(passportId, subId32);

    try {
      const tx = await ops.registerService(
        passportId,
        subId32,
        priceBase,
        metaURI,
      );
      const svc = {
        serviceId,
        passportId: passportId.toString(),
        owner: wallet,
        subId: v.value.subId,
        name: v.value.name,
        description: v.value.description ?? "",
        category: v.value.category,
        docsUrl: v.value.docsUrl,
        endpointUrl: v.value.endpointUrl,
        priceUsd: v.value.priceUsd,
        priceBaseUnits: priceBase.toString(),
        durationDays: v.value.durationDays,
        durationSec: v.value.durationSec,
        metaURI,
        createdAt: new Date().toISOString(),
      };
      upsertService(svc);
      return c.json({ ...serviceJson(svc), registerTx: tx });
    } catch (err) {
      logger.error("marketplace: registerService failed", {
        wallet,
        passportId: passportId.toString(),
        err: String(err),
      });
      return errorResponse(
        c,
        500,
        ErrorCodes.INTERNAL_ERROR,
        `Service registration failed: ${String(err)}`,
      );
    }
  },
);

// ─── GET /api/market/services — catalog ────────────────────────
marketplaceApiRoutes.get(
  "/market/services",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Service catalog",
    description:
      "Off-chain catalog index (D18). Filters: ?category=, ?q= (name/description substring).",
    responses: { 200: { description: "Service list" } },
  }),
  (c) => {
    const services = listServices({
      category: c.req.query("category") || undefined,
      q: c.req.query("q") || undefined,
    });
    c.header("Cache-Control", "public, max-age=60");
    return c.json({ v: 1, services: services.map(serviceJson) });
  },
);

// ─── GET /api/market/services/:id — detail + buyUrl ────────────
marketplaceApiRoutes.get(
  "/market/services/:id",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Service detail",
    responses: {
      200: { description: "Service detail" },
      404: { description: "Unknown service" },
    },
  }),
  (c) => {
    const svc = getService(c.req.param("id"));
    if (!svc) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "Unknown serviceId",
      );
    }
    return c.json(serviceJson(svc));
  },
);

// ─── POST /api/market/buy/:serviceId — purchase (x402-gated) ───
// Payment settles to the splitter; afterSettle hook credits + mints.
// The handler runs after settlement and returns the receipt.
marketplaceApiRoutes.post(
  "/market/buy/:serviceId",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Buy a service pass (x402-gated)",
    description:
      "Pays service.price to the MarketplaceSplitter (90/10 split), then " +
      "mints/extends the payer's service pass (D19: renewal = same endpoint).",
    responses: {
      200: { description: "Pass minted to payer wallet" },
      402: { description: "Payment required" },
      404: { description: "Unknown service" },
    },
  }),
  (c) => {
    const serviceId = c.req.param("serviceId").toLowerCase();
    const svc = getService(serviceId);
    if (!svc) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "Unknown serviceId",
      );
    }
    return c.json({
      purchased: true,
      serviceId,
      service: svc.name,
      price: { amount: svc.priceUsd, currency: "USDC" },
      durationDays: svc.durationDays,
      note: "Service pass minted to the payer wallet on Arc Testnet",
    });
  },
);

// ─── GET /api/market/passes/:wallet — buyer's passes ───────────
marketplaceApiRoutes.get(
  "/market/passes/:wallet",
  describeRoute({
    tags: ["Marketplace"],
    summary: "List service passes owned by a wallet",
    responses: {
      200: { description: "Pass list" },
      400: { description: "Invalid wallet" },
    },
  }),
  async (c) => {
    const wallet = c.req.param("wallet");
    if (!isAddress(wallet)) {
      return errorResponse(
        c,
        400,
        ErrorCodes.INVALID_INPUT,
        "Invalid wallet address",
      );
    }
    const ops = getMarketplaceOps();
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const passes: Array<{
      serviceId: string;
      service: string;
      tokenId: string;
      expiresAt: number;
      active: boolean;
    }> = [];
    for (const svc of listServices()) {
      try {
        const tokenId = await ops.servicePassOf(
          wallet.toLowerCase(),
          svc.serviceId as `0x${string}`,
        );
        if (tokenId === 0n) continue;
        const expiresAt = await ops.passExpiresAt(tokenId);
        passes.push({
          serviceId: svc.serviceId,
          service: svc.name,
          tokenId: tokenId.toString(),
          expiresAt: Number(expiresAt),
          active: expiresAt > nowSec,
        });
      } catch (err) {
        logger.warn("marketplace: pass lookup failed", {
          wallet,
          serviceId: svc.serviceId,
          err: String(err),
        });
      }
    }
    return c.json({ wallet: wallet.toLowerCase(), passes });
  },
);

// ─── GET /api/market/meta/:hash — locally pinned metadata ──────
marketplaceApiRoutes.get(
  "/market/meta/:hash",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Fetch locally pinned metadata (D16 fallback)",
    responses: {
      200: { description: "Metadata JSON" },
      404: { description: "Unknown hash" },
    },
  }),
  (c) => {
    const meta = getMeta(c.req.param("hash"));
    if (meta === undefined) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "Unknown metadata hash",
      );
    }
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.json(meta);
  },
);
