import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { resolver } from "hono-openapi";
import { getErrorCatalog } from "../lib/error-catalog";
import { getFeeCatalog } from "../lib/fee-catalog";
import { getTrustTiers } from "../lib/trust-tiers";
import { getDeploymentDescriptor } from "../lib/deployment-descriptor";

export const metaRoutes = new Hono();

const errorEntrySchema = z.object({
  code: z.string().describe("Stable error code identifier"),
  http_status: z.number().int().describe("HTTP status code returned with this error"),
  agent_impact: z.string().describe("Human-readable description of what this error means for an AI agent"),
  hint_template: z.string().describe("Suggested fix or recovery action for the agent"),
  affected_routes: z.array(z.string()).describe("Route patterns where this error can occur"),
  recovery_action: z.enum([
    "retry_immediately",
    "change_request",
    "await_human",
    "wait_and_retry",
    "choose_alternative",
    "not_authorized",
    "no_action",
    "escalate",
  ]).describe("Recommended recovery action for an AI agent"),
});

metaRoutes.get(
  "/api/meta/errors",
  describeRoute({
    tags: ["Meta"],
    summary: "Error catalog — machine-readable error codes for AI agents",
    description:
      "Returns a catalog of all error codes used by the AgentBadge API, with recovery actions and hints. AI agents can use this to programmatically handle errors.",
    responses: {
      200: {
        description: "Error catalog",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                total_count: z.number().int(),
                count: z.number().int(),
                errors: z.array(errorEntrySchema),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getErrorCatalog(), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

const feeEntrySchema = z.object({
  service: z.string().describe("Service identifier"),
  category: z.enum(["passport", "marketplace", "scan_api", "badge_api", "x402"]).describe("Fee category"),
  price_usd: z.number().nullable().describe("Price in USD (null if not applicable)"),
  price_hbar: z.number().nullable().describe("Price in HBAR (null if not applicable)"),
  unit: z.string().describe("Pricing unit (one-time, per-scan, per-request, percentage, per-upgrade)"),
  description: z.string().describe("Human-readable description of the service and fee"),
  free_tier: z.boolean().describe("Whether this service has a free tier"),
  notes: z.string().optional().describe("Additional notes about pricing"),
});

metaRoutes.get(
  "/api/meta/fees",
  describeRoute({
    tags: ["Meta"],
    summary: "Fee catalog — machine-readable pricing for all AgentBadge services",
    description:
      "Returns pricing information for all AgentBadge services: passport issuance (4 tiers), upgrades, marketplace fees, scan API, and badge API. Prices in HBAR and USD where applicable.",
    responses: {
      200: {
        description: "Fee catalog",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                total_count: z.number().int(),
                currency_note: z.string(),
                network: z.string(),
                fees: z.array(feeEntrySchema),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getFeeCatalog(), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

const trustTierSchema = z.object({
  name: z.string().describe("Tier identifier"),
  level: z.number().int().describe("Trust level (0=lowest, 5=highest)"),
  description: z.string().describe("Human-readable description of what this tier means"),
  unlocks: z.array(z.string()).describe("Capabilities and endpoints unlocked at this tier"),
  requirements: z.array(z.string()).describe("Requirements to reach this tier"),
});

metaRoutes.get(
  "/api/meta/trust-tiers",
  describeRoute({
    tags: ["Meta"],
    summary: "Trust tiers — identity/trust ladder for AI agents",
    description:
      "Returns the trust tier ladder: unverified, did_verified, passport_holder, passport_verified, marketplace_participant, trusted_agent. Each tier lists unlocked capabilities and requirements.",
    responses: {
      200: {
        description: "Trust tier catalog",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                total_count: z.number().int(),
                tiers: z.array(trustTierSchema),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getTrustTiers(), 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

metaRoutes.get(
  "/.well-known/agentbadge.json",
  describeRoute({
    tags: ["Meta"],
    summary: "Deployment descriptor — network config, token IDs, API version",
    description:
      "Returns a machine-readable deployment descriptor with Hedera network configuration, passport token ID, directory/audit topic IDs, API version, payment protocol, and links to fee/error/trust-tier catalogs.",
    responses: {
      200: {
        description: "Deployment descriptor JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                schema_version: z.string(),
                deployment_id: z.string(),
                network: z.string(),
                passport_token_id: z.string(),
                directory_topic_id: z.string(),
                audit_topic_id: z.string(),
                api_version: z.string(),
                payment_protocol: z.string(),
                facilitator: z.string(),
                fee_catalog_url: z.string(),
                error_catalog_url: z.string(),
                trust_tiers_url: z.string(),
                generated_at: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getDeploymentDescriptor(), 200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    });
  },
);
