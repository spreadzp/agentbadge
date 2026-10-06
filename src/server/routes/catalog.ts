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
