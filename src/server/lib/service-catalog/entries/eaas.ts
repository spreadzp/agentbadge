/**
 * eaas surface — verdicts (per-call + readiness-scan price override),
 * external job evaluation, and the two subscription tiers.
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

const VERDICT_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    policy: { type: "string", description: "Evaluation policy id" },
    deliverable: {
      type: "object",
      description: "Exactly one of {uri, data}",
      properties: {
        uri: { type: "string", description: "http(s) URL of the deliverable" },
        data: { type: "object", description: "Inline deliverable payload" },
      },
    },
    expectedHash: { type: "string", description: "0x… sha256 commitment" },
    nonce: { type: "string" },
    async: { type: "boolean", description: "202 + statusUrl delivery" },
    webhookUrl: { type: "string" },
  },
  required: ["policy", "deliverable"],
};

export function eaasSkus(src: CatalogSources["eaas"]): ServiceSku[] {
  const common = {
    surface: "eaas" as const,
    auth: "x402" as const,
    enabled: src.enabled,
  };
  return [
    {
      ...common,
      sku_id: "eaas:verdict",
      name: "EaaS signed verdict",
      description:
        "Flat-price EIP-712 signed verdict for a deliverable + policy.",
      price_usd: src.verdict_usd,
      pricing: "per_call",
      endpoint: { method: "POST", path: "/api/eaas/verdicts" },
      input_schema: VERDICT_INPUT_SCHEMA,
    },
    {
      ...common,
      sku_id: "eaas:readiness-scan",
      name: "EaaS verdict — readiness-scan policy",
      description: "Verdict for policy=readiness-scan (higher compute tier).",
      price_usd: src.scan_usd,
      pricing: "per_call",
      endpoint: { method: "POST", path: "/api/eaas/verdicts" },
      input_schema: VERDICT_INPUT_SCHEMA,
    },
    {
      ...common,
      sku_id: "eaas:jobs-evaluate",
      name: "EaaS external job evaluation",
      description: "Paid evaluation of an external job deliverable.",
      price_usd: src.eval_usd,
      pricing: "per_call",
      endpoint: { method: "POST", path: "/api/eaas/jobs/evaluate" },
      input_schema: VERDICT_INPUT_SCHEMA,
    },
    {
      ...common,
      sku_id: "eaas:subscribe-basic",
      name: "EaaS subscription — basic",
      description:
        "30d verdict quota; mints/extends a CLASS_EAAS AccessPassNFT.",
      price_usd: src.tier_basic_usd,
      pricing: "subscription",
      endpoint: { method: "POST", path: "/api/eaas/subscribe" },
      input_schema: {
        type: "object",
        properties: { tier: { type: "string", enum: ["basic"] } },
        required: ["tier"],
      },
    },
    {
      ...common,
      sku_id: "eaas:subscribe-pro",
      name: "EaaS subscription — pro",
      description:
        "30d verdict quota at pro rate; mints/extends a CLASS_EAAS AccessPassNFT.",
      price_usd: src.tier_pro_usd,
      pricing: "subscription",
      endpoint: { method: "POST", path: "/api/eaas/subscribe" },
      input_schema: {
        type: "object",
        properties: { tier: { type: "string", enum: ["pro"] } },
        required: ["tier"],
      },
    },
  ];
}
