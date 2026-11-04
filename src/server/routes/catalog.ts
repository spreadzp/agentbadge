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
import z from "zod";
import type { NextCall } from "../lib/next-call";
import {
  buildPricingJson,
  buildPricingMd,
} from "../lib/service-catalog/pricing-export";
import { defaultSources } from "../lib/service-catalog";
import { BASE_URL } from "../lib/page-meta";

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
      "Flat USDC price list for AI agents — generated from the ServiceSku registry, the same source of truth as /api/v1/services. Each service carries name, endpoint, price_usdc, unit, payment (x402|wallet-sig|free), and description; the free[] array lists no-auth endpoints.",
    responses: {
      200: {
        description: "Pricing JSON (agentbadge.pricing.v1)",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                schema: z.literal("agentbadge.pricing.v1"),
                currency: z.literal("USDC"),
                chain: z.string(),
                canonical: z.string(),
                services: z.array(
                  z.object({
                    sku_id: z.string(),
                    name: z.string(),
                    endpoint: z.string(),
                    price_usdc: z.string().nullable(),
                    unit: z.string(),
                    payment: z.enum(["x402", "wallet-sig", "free"]),
                    description: z.string().optional(),
                    surface: z.string(),
                  }),
                ),
                free: z.array(
                  z.object({
                    endpoint: z.string(),
                    payment: z.literal("free"),
                    limit: z.string(),
                    description: z.string(),
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
    return c.json(buildPricingJson(defaultSources()), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// SLICE-206-9: Markdown mirror of /pricing.json — same sources, same data.
catalogRoutes.get(
  "/pricing.md",
  describeRoute({
    tags: ["Catalog"],
    summary: "Pricing in Markdown (agent-facing mirror of /pricing.json)",
    responses: {
      200: {
        description: "Pricing Markdown",
        content: { "text/markdown": {} },
      },
    },
  }),
  () => {
    const md = buildPricingMd(defaultSources(), BASE_URL);
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

