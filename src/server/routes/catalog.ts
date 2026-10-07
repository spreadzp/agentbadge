/**
 * Catalog route — GET /catalog, GET /pricing.json
 * (llms.txt/llms-full.txt moved to routes/discovery.ts — SLICE-178-1)
 *
 * Reference: hackathon-flow.md:120 (§5), hedera-tech-reference.md:738-784 (§7.3)
 * SLICE-44-5: GET /pricing.json — machine-readable pricing for AI agents
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { getCatalog } from "@agentbadge/hedera-core";
import { catalogTierSchema } from "../openapi";
import { getServicesCatalog } from "../lib/services-catalog";
import z from "zod";
import type { NextCall } from "../lib/next-call";

export const catalogRoutes = new Hono();

catalogRoutes.get(
  "/catalog",
  describeRoute({
    tags: ["Catalog"],
    summary: "Get tier pricing and capabilities",
    responses: {
      200: {
        description: "Catalog retrieved",
        content: {
          "application/json": {
            schema: resolver(z.object({ tiers: z.array(catalogTierSchema) })),
          },
        },
      },
    },
  }),
  (c) => {
    const tiers = getCatalog();
    const next_call: NextCall = {
      method: "POST",
      path: "/passport/request",
      body: { tier: "standard" },
      authorization: "x402 payment required",
      why: "Purchase a passport NFT to get an on-chain identity for your agent.",
    };
    return c.json({ tiers, next_call });
  },
);

catalogRoutes.get(
  "/pricing.json",
  describeRoute({
    tags: ["Catalog"],
    summary: "Machine-readable pricing (AB-010)",
    description:
      "Returns pricing tiers in a flat JSON structure optimized for AI agent consumption. Each tier includes name, price (HBAR), and capabilities array.",
    responses: {
      200: {
        description: "Pricing JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                currency: z.literal("HBAR"),
                tiers: z.array(
                  z.object({
                    name: z.string(),
                    price: z.number(),
                    capabilities: z.array(z.string()),
                  }),
                ),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const tiers = getCatalog();
    return c.json(
      { currency: "HBAR", tiers },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);

/**
 * GET /api/v1/services — canonical paid-services catalog.
 * Referenced by agent-card, refusal-contract price_truth, llms.txt,
 * and blog/agent-guide articles. Prices come from the same config
 * sources the x402 middleware resolves at request time.
 */
catalogRoutes.get(
  "/api/v1/services",
  describeRoute({
    tags: ["Catalog"],
    summary: "Canonical paid-services catalog (USDC)",
    description:
      "Machine-readable registry of paid surfaces: endpoint, method, canonical USDC price, unit, refusal codes, free-tier flag. " +
      "402 accept.amount values are canonical — clients verify them against this catalog (price_truth).",
    responses: {
      200: {
        description: "Services catalog",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                version: z.string(),
                currency: z.string(),
                price_truth: z.string(),
                refusal_contract: z.string(),
                generated_at: z.string(),
                services: z.array(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    path: z.string(),
                    method: z.string(),
                    price_usd: z.string().nullable(),
                    unit: z.string(),
                    settlement: z.string(),
                    enabled: z.boolean(),
                    free_tier: z.boolean(),
                    refusal_codes: z.array(z.string()),
                    notes: z.string().optional(),
                  }),
                ),
                scan_packs: z
                  .object({
                    endpoint: z.string(),
                    full_scan_usd: z.string(),
                    bundles: z.array(
                      z.object({
                        id: z.string(),
                        price_usd: z.string(),
                        rule_count: z.number(),
                      }),
                    ),
                  })
                  .optional(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getServicesCatalog(), 200, {
      "Cache-Control": "public, max-age=300",
    });
  },
);
