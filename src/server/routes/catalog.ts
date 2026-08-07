/**
 * Catalog route — GET /catalog, GET /llms.txt, GET /pricing.json
 *
 * Reference: hackathon-flow.md:120 (§5), hedera-tech-reference.md:738-784 (§7.3)
 * SLICE-44-5: GET /pricing.json — machine-readable pricing for AI agents
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
    const baseTxt = getLlmsTxt();
    const teamSection = `
## Engineering Capabilities

- /agent-guide/team — Team overview
- /agent-guide/team/capabilities — Capabilities (Markdown)
- /agent-guide/team/capabilities.json — Capabilities (JSON)
- /agent-guide/team/services — Services catalog
- /agent-guide/team/availability — Availability
- /agent-guide/team/contact — Contact channels
- /agent-guide/team/match — Matching criteria
`;
    const txt = baseTxt + teamSection;
    return new Response(txt, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
