/**
 * Catalog route — GET /catalog, GET /llms.txt
 *
 * Reference: hackathon-flow.md:120 (§5), hedera-tech-reference.md:738-784 (§7.3)
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { getCatalog, getLlmsTxt } from "@agentgate-hedera/hedera-core";
import { catalogTierSchema } from "../openapi";
import z from "zod";

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
    return c.json({ tiers });
  },
);

catalogRoutes.get(
  "/llms.txt",
  describeRoute({
    tags: ["Catalog"],
    summary: "LLM-friendly catalog (Markdown)",
    responses: {
      200: {
        description: "LLM catalog in Markdown format",
        content: { "text/markdown": {} },
      },
    },
  }),
  (c) => {
    const txt = getLlmsTxt();
    return new Response(txt, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
