/**
 * GET /api/v1/services — canonical paid-services catalog
 * (EPIC-179 SLICE-179-2). Served from the SKU registry
 * (lib/service-catalog); filters ?surface= and ?q=. Free, no auth,
 * 5min cache. Supersedes /pricing.json and /api/meta/fees (deprecated
 * pointers added there).
 */
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { getConfig } from "../../config/env";
import {
  allSkus,
  defaultSources,
  type ServiceSku,
} from "../lib/service-catalog";

export const servicesCatalogRoutes = new Hono();

const surfaceEnum = z.enum([
  "scan",
  "passport",
  "marketplace",
  "keeperhub",
  "eaas",
  "bstock",
  "venue",
]);

const skuSchema = z.object({
  sku_id: z.string(),
  surface: surfaceEnum,
  name: z.string(),
  description: z.string(),
  price_usd: z.string().nullable(),
  pricing: z.enum(["per_call", "per_bundle", "subscription", "dynamic", "free"]),
  price_native: z
    .object({ amount: z.string(), currency: z.string() })
    .optional(),
  endpoint: z.object({
    method: z.enum(["GET", "POST"]),
    path: z.string(),
  }),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  output_example: z.record(z.string(), z.unknown()).optional(),
  auth: z.enum(["x402", "x402+pass", "wallet-sig", "none"]),
  free_tier: z
    .object({ limit: z.string(), note: z.string() })
    .optional(),
  enabled: z.boolean().optional(),
});

const freeEntrySchema = z.object({
  endpoint: z.string(),
  limit: z.string(),
  note: z.string(),
});

const responseSchema = z.object({
  total: z.number().int(),
  generated_at: z.string(),
  network: z.string(),
  services: z.array(skuSchema),
  free: z.array(freeEntrySchema),
  links: z.object({
    openapi: z.string(),
    llms: z.string(),
    agent_card: z.string(),
    refusal_contract: z.string(),
  }),
});

function baseUrl(): string {
  return process.env.BASE_URL ?? "https://agentbadge.xyz";
}

function networkId(): string {
  const chainId = getConfig().circlePayments?.arcChainId ?? 5042002;
  return `eip155:${chainId}`;
}

/** Minimal free[] section — SLICE-179-4 fills this out. */
function freeSection(): { endpoint: string; limit: string; note: string }[] {
  return [
    {
      endpoint: "/api/health",
      limit: "unauthenticated",
      note: "Liveness/readiness probe",
    },
  ];
}

servicesCatalogRoutes.get(
  "/api/v1/services",
  describeRoute({
    tags: ["Catalog"],
    summary: "Canonical paid-services catalog (ServiceSku registry)",
    description:
      "Machine-readable registry of every paid surface: sku_id (surface:slug), " +
      "canonical USD price, pricing model, endpoint, input_schema, auth, " +
      "free-tier terms. Sources: the same config the x402 middleware resolves " +
      "at request time — 402 accept.amount values are canonical, verify them " +
      "against this catalog. Filters: ?surface=scan|passport|…, ?q=substring. " +
      "Supersedes /pricing.json and /api/meta/fees (deprecated).",
    responses: {
      200: {
        description: "Services catalog",
        content: {
          "application/json": { schema: resolver(responseSchema) },
        },
      },
    },
  }),
  (c) => {
    const surfaceParam = c.req.query("surface");
    const q = c.req.query("q")?.trim().toLowerCase();

    let services: ServiceSku[] = allSkus(defaultSources());
    if (surfaceParam) {
      const surface = surfaceEnum.safeParse(surfaceParam);
      if (!surface.success) {
        return c.json(
          {
            error: "invalid surface",
            valid: surfaceEnum.options,
          },
          400,
        );
      }
      services = services.filter((s) => s.surface === surface.data);
    }
    if (q) {
      services = services.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      );
    }

    const base = baseUrl();
    return c.json(
      {
        total: services.length,
        generated_at: new Date().toISOString(),
        network: networkId(),
        services,
        free: freeSection(),
        links: {
          openapi: `${base}/api/specs`,
          llms: `${base}/llms.txt`,
          agent_card: `${base}/.well-known/agent-card.json`,
          refusal_contract: `${base}/api/meta/refusal-contract`,
        },
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  },
);
