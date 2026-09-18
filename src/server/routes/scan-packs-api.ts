import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { getConfig } from "../../config/env";
import { bundleMetadata } from "../../agent-readiness/rule-bundles";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";

/**
 * GET /api/scan-packs — public bundle catalog (SLICE-133-14, D4).
 * Marketplace agents discover what's for sale and at what price.
 * Registered only when `scanPacks.enabled`; prices shown only when
 * `scanPacks.pricingEnabled` (free mode → `price: null`).
 */
export const scanPacksApiRoutes = new Hono();

scanPacksApiRoutes.get(
  "/scan-packs",
  describeRoute({
    tags: ["API"],
    summary: "List available scan bundles",
    description:
      "Returns the catalog of purchasable rule bundles with help text, rule counts, and prices. " +
      "Pass bundle ids via the `packs` param on POST /api/scan to scope a scan.",
    responses: {
      200: { description: "Bundle catalog" },
    },
  }),
  (c) => {
    const { pricingEnabled, priceOverrides } = getConfig().scanPacks;
    const catalog = bundleMetadata(AGENT_READINESS_RULESET.rules);

    const packs = catalog.bundles.map((b) => ({
      id: b.id,
      name: b.name,
      description: b.description,
      helpText: b.helpText,
      costClass: b.costClass,
      price: pricingEnabled
        ? { amount: priceOverrides[b.costClass] ?? b.price.amount, currency: b.price.currency }
        : null,
      ruleCount: b.ruleCount,
      fast: b.fast,
    }));

    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      v: 1,
      packs,
      fullScan: {
        price: pricingEnabled ? catalog.fullScan.price : null,
        ruleCount: catalog.fullScan.ruleCount,
      },
    });
  },
);
