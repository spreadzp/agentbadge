import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { resolver } from "hono-openapi";
import { getErrorCatalog } from "../lib/error-catalog";
import { getFeeCatalog } from "../lib/fee-catalog";
import { getTrustTiers } from "../lib/trust-tiers";
import { getDeploymentDescriptor } from "../lib/deployment-descriptor";
import { getJwks } from "../lib/jwks";
import { getRefusalContract } from "../lib/refusal-contract";
import { getDatabase } from "../lib/database";
import {
  aiCrawlerStats,
  collectStats,
  type TrafficRow,
} from "../lib/report/traffic-format";
import { srcAttributionStats } from "../lib/report/src-attribution-report";

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
  charge: z
    .enum(["never", "conditional"])
    .optional()
    .describe("EPIC-181 refusal contract: 'never' = the caller is never billed for this outcome"),
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
                deprecated: z
                  .object({
                    replaced_by: z.string(),
                    note: z.string(),
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
    return c.json(
      {
        ...getFeeCatalog(),
        deprecated: {
          replaced_by: "/api/v1/services",
          note: "HBAR-era fee list; use the canonical USDC services catalog.",
        },
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      },
    );
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
      "Returns the trust tier ladder: unverified, observer, did_verified, passport_holder, passport_verified, marketplace_participant, trusted_agent. Each tier lists unlocked capabilities and requirements.",
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
  "/api/meta/refusal-contract",
  describeRoute({
    tags: ["Meta"],
    summary: "Refusal contract — 'no charge on refusal' policy, machine-readable",
    description:
      "Public declaration that refused requests are never billed: policy_refusal (409), insufficient_subject (422), execution_failed (502, auto-refund when a self-settle payment already landed). Also declares the degraded/data_status marker convention and price-truth rule (402 accepts[].amount is canonical).",
    responses: {
      200: {
        description: "Refusal contract manifest",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                version: z.literal("1.0"),
                policy: z.literal("no-charge-on-refusal"),
                refusals: z.array(
                  z.object({
                    code: z.string(),
                    http: z.number().int(),
                    charge: z.enum(["never", "conditional"]),
                    refund: z.enum(["auto"]).optional(),
                    reason: z.string(),
                  }),
                ),
                degraded: z.object({
                  field: z.literal("degraded"),
                  marker: z.literal("data_status"),
                }),
                price_truth: z.string(),
                disclosure: z.string(),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(getRefusalContract(), 200, {
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

metaRoutes.get(
  "/.well-known/jwks.json",
  describeRoute({
    tags: ["Meta"],
    summary: "JSON Web Key Set — public keys for verifying signed credentials",
    description:
      "Returns the public JSON Web Key Set (RFC 7517) for verifying signatures on DID auth challenges, audit trail entries, and other signed credentials issued by AgentBadge.",
    responses: {
      200: {
        description: "JWKS JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                keys: z.array(
                  z.object({
                    kty: z.string(),
                    use: z.string(),
                    alg: z.string(),
                    kid: z.string(),
                    crv: z.string(),
                    x: z.string(),
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
    return c.json(getJwks(), 200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    });
  },
);

const pathCountSchema = z.object({
  path: z.string(),
  count: z.number().int(),
});

const trafficReportSchema = z.object({
  generated_at: z.string(),
  window: z.object({
    from: z.string(),
    until: z.string(),
    hours: z.number().int(),
  }),
  source: z.string(),
  total_requests: z.number().int(),
  status_classes: z.array(
    z.object({ class: z.string(), count: z.number().int() }),
  ),
  clients: z.array(
    z.object({ ua_class: z.string(), count: z.number().int() }),
  ),
  top_paths: z.array(pathCountSchema),
  top_client_paths: z.array(
    z.object({
      client: z.string(),
      path: z.string(),
      count: z.number().int(),
    }),
  ),
  ai_crawlers: z.array(
    z.object({
      crawler: z.string(),
      hits: z.number().int(),
      top_paths: z.array(pathCountSchema),
    }),
  ),
  src_attribution: z.array(
    z.object({
      src: z.string(),
      hits: z.number().int(),
      conversions: z.number().int(),
      top_paths: z.array(pathCountSchema),
    }),
  ),
  errors: z.object({
    total: z.number().int(),
    top: z.array(
      z.object({
        status: z.number().int(),
        method: z.string(),
        path: z.string(),
        count: z.number().int(),
      }),
    ),
  }),
  hourly_utc: z.array(
    z.object({ hour: z.number().int(), count: z.number().int() }),
  ),
});

const topN = (m: Map<string, number>, n: number): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

metaRoutes.get(
  "/api/meta/traffic-report",
  describeRoute({
    tags: ["Meta"],
    summary: "Traffic report — live request telemetry, machine-readable",
    description:
      "Aggregates http_traffic events collected by the edge middleware over the last N hours (?hours=, default 24, max 168): totals, status classes, top clients by UA class, top paths, AI-crawler hits, ?src registry attribution with register conversions, errors and per-UTC-hour distribution. Evidence endpoint for traffic claims.",
    responses: {
      200: {
        description: "Aggregated traffic report JSON",
        content: {
          "application/json": {
            schema: resolver(trafficReportSchema),
          },
        },
      },
      503: {
        description: "Telemetry unavailable (database disabled)",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                error: z.object({
                  code: z.string(),
                  message: z.string(),
                }),
              }),
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const db = getDatabase();
    if (!db.db) {
      return c.json(
        {
          error: {
            code: "telemetry_unavailable",
            message:
              "Traffic telemetry requires the Postgres event store (DATABASE_ENABLED).",
          },
        },
        503,
      );
    }

    const raw = Number(c.req.query("hours") ?? "24");
    const hours = Math.min(Math.max(Math.trunc(raw) || 24, 1), 168);
    const cutoff = Date.now() - hours * 3600_000;

    const PAGE = 5000;
    const rows: TrafficRow[] = [];
    let done = false;
    try {
      for (let offset = 0; !done; offset += PAGE) {
        const page = await db.events.list({
          type: "http_traffic",
          limit: PAGE,
          offset,
        });
        if (page.length === 0) break;
        for (const e of page) {
          if (Date.parse(e.createdAt) < cutoff) {
            done = true;
            break;
          }
          rows.push({ payload: e.payload ?? {}, createdAt: e.createdAt });
        }
        if (page.length < PAGE) break;
      }
    } catch {
      return c.json(
        {
          error: {
            code: "telemetry_unavailable",
            message:
              "Traffic telemetry store is not reachable from this deployment.",
          },
        },
        503,
      );
    }

    const stats = collectStats(rows, hours);

    return c.json(
      {
        generated_at: new Date().toISOString(),
        window: { from: stats.from, until: stats.until, hours: stats.hours },
        source: "http_traffic events (edge middleware)",
        total_requests: stats.total,
        status_classes: topN(stats.byClass, 10).map(([klass, count]) => ({
          class: klass,
          count,
        })),
        clients: topN(stats.byUaClass, 15).map(([ua_class, count]) => ({
          ua_class,
          count,
        })),
        top_paths: topN(stats.byPath, 20).map(([path, count]) => ({
          path,
          count,
        })),
        top_client_paths: topN(stats.byPathUa, 15).map(([key, count]) => {
          const i = key.indexOf(" → ");
          return {
            client: i >= 0 ? key.slice(0, i) : key,
            path: i >= 0 ? key.slice(i + 3) : "?",
            count,
          };
        }),
        ai_crawlers: aiCrawlerStats(rows).map((s) => ({
          crawler: s.crawler,
          hits: s.hits,
          top_paths: s.topPaths.map(([path, count]) => ({ path, count })),
        })),
        src_attribution: srcAttributionStats(rows).map((s) => ({
          src: s.src,
          hits: s.hits,
          conversions: s.conversions,
          top_paths: s.topPaths.map(([path, count]) => ({ path, count })),
        })),
        errors: {
          total: stats.errorTotal,
          top: topN(stats.errors, 20).map(([key, count]) => {
            const m = /^(\d{3}) (\S+) (.*)$/.exec(key);
            return {
              status: Number(m?.[1] ?? 0),
              method: m?.[2] ?? "GET",
              path: m?.[3] ?? key,
              count,
            };
          }),
        },
        hourly_utc: stats.hourly.map((count, hour) => ({ hour, count })),
      },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  },
);
