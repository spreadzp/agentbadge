import { describe, it, expect } from "vitest";
import {
  SEMANTIC_CHECKERS,
  findPricingDeclarations,
} from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { AB150 } from "../../../src/agent-readiness/rules/AB150";
import { AB151 } from "../../../src/agent-readiness/rules/AB151";
import { AB152 } from "../../../src/agent-readiness/rules/AB152";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

// ─── Helpers ───────────────────────────────────────────────────────────────

const mockSnap = (url: string, body?: string | null, status = 200): ResponseSnapshot => ({
  url,
  status,
  bodyHash: "abc123",
  bodySize: body?.length ?? 0,
  contentType: body ? "application/json" : "text/plain",
  resolvedIp: "93.184.216.34",
  fetchedAt: "2025-01-01T00:00:00Z",
  fetchTimeMs: 100,
  redirectChain: [],
  body,
  headers: {},
});

// ─── Fixtures ──────────────────────────────────────────────────────────────

// (a) Machine-readable pricing in guide + matching x-pricing in openapi (VERIFIED)
const guideWithPricing = mockSnap(
  "https://example.com/.well-known/agent-guide.json",
  JSON.stringify({
    name: "Example API",
    pricing: { price_per_call: "$0.01", rate_limit: "100/min" },
    rate_limits: { requests_per_minute: "100" },
  }),
);

const openapiWithPricing = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({
    openapi: "3.1.0",
    paths: {},
    x_pricing: { price_per_call: "$0.01", rate_limit: "100/min" },
    x_rate_limit: { requests_per_minute: "100" },
  }),
);

const pricingJsonMatch = mockSnap(
  "https://example.com/pricing.json",
  JSON.stringify({ price_per_call: "$0.01", rate_limit: "100/min" }),
);

const llmsWith429 = mockSnap(
  "https://example.com/llms.txt",
  "## Example API\n\n## Pricing\nprice_per_call: $0.01\n\n## Rate Limits\nrate_limit: 100/min\n\nOn 429: Retry-After header indicates wait time.",
);

// (b) Prose-only pricing in llms (INFERRED)
const llmsProseOnly = mockSnap(
  "https://example.com/llms.txt",
  "## Example API\n\nOur pricing is affordable at $0.01 per call.\nWe have rate limits of 100 requests per minute.\nIf you exceed limits, you get a 429 error.",
);

const guideProseOnly = mockSnap(
  "https://example.com/guide",
  "Pricing: $0.01 per call. Rate limit: 100/min. On 429, wait and retry.",
);

// (c) Guide says $0.01 / openapi x-pricing says $0.02 (CONFLICT)
const guidePricing001 = mockSnap(
  "https://example.com/.well-known/agent-guide.json",
  JSON.stringify({ pricing: { price_per_call: "$0.01" } }),
);

const openapiPricing002 = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({ openapi: "3.1.0", paths: {}, x_pricing: { price_per_call: "$0.02" } }),
);

// (d) Nothing — no pricing anywhere
const guideNoPricing = mockSnap(
  "https://example.com/.well-known/agent-guide.json",
  JSON.stringify({ name: "Example API" }),
);

const openapiNoPricing = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({ openapi: "3.1.0", paths: {} }),
);

const llmsNoPricing = mockSnap(
  "https://example.com/llms.txt",
  "## Example API\n\nA great API for developers.\n",
);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-95-5: Commerce & Limits Rules (AB-150..AB-152)", () => {

  // ─── AB-150: Pricing discoverability ──────────────────────────────────────
  describe("AB-150: Pricing discoverability (pricing_discoverability)", () => {
    it("rule definition is correct", () => {
      expect(AB150.rule_id).toBe("AB-150");
      expect(AB150.check.type).toBe("semantic_validation");
      expect(AB150.check.semantic).toBe("pricing_discoverability");
      expect(AB150.check.sources).toEqual(["guide", "openapi", "llms", "pricing"]);
      expect(AB150.category).toBe("pricing");
      expect(AB150.severity).toBe("high");
      expect(AB150.counted_in_score).toBe(true);
    });

    it("machine-readable pricing in guide → found", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: guideWithPricing,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("guide");
    });

    it("machine-readable pricing in openapi x-pricing → found", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: guideNoPricing,
        openapi: openapiWithPricing,
        llms: llmsNoPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("openapi");
    });

    it("machine-readable pricing in well-known pricing.json → found", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
        pricing: pricingJsonMatch,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("pricing.json");
    });

    it("prose-only pricing in llms → partial", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        llms: llmsProseOnly,
        pricing: null,
      });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("prose");
    });

    it("prose-only pricing in guide → partial", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: guideProseOnly,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no pricing anywhere → absent", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources at all → no_source", () => {
      const result = SEMANTIC_CHECKERS["pricing_discoverability"]({
        guide: null,
        openapi: null,
        llms: null,
        pricing: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-151: Rate limits machine-readable ─────────────────────────────────
  describe("AB-151: Rate limits machine-readable (rate_limits_machine_readable)", () => {
    it("rule definition is correct", () => {
      expect(AB151.rule_id).toBe("AB-151");
      expect(AB151.check.type).toBe("semantic_validation");
      expect(AB151.check.semantic).toBe("rate_limits_machine_readable");
      expect(AB151.check.sources).toEqual(["guide", "openapi", "llms"]);
      expect(AB151.category).toBe("rate_limits");
      expect(AB151.severity).toBe("high");
    });

    it("machine-readable rate limits + 429 doc → found", () => {
      const result = SEMANTIC_CHECKERS["rate_limits_machine_readable"]({
        guide: guideWithPricing,
        openapi: openapiNoPricing,
        llms: llmsWith429,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("429");
    });

    it("machine-readable rate limits via openapi x-rate-limit + 429 doc → found", () => {
      const result = SEMANTIC_CHECKERS["rate_limits_machine_readable"]({
        guide: guideNoPricing,
        openapi: openapiWithPricing,
        llms: llmsWith429,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("429");
    });

    it("machine-readable rate limits but no 429 doc → partial", () => {
      const result = SEMANTIC_CHECKERS["rate_limits_machine_readable"]({
        guide: guideWithPricing,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
      });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("no 429");
    });

    it("prose-only rate limits → partial", () => {
      const result = SEMANTIC_CHECKERS["rate_limits_machine_readable"]({
        guide: guideProseOnly,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
      });
      expect(result.outcome).toBe("partial");
      expect(result.detail).toContain("prose");
    });

    it("no rate limits anywhere → absent", () => {
      const result = SEMANTIC_CHECKERS["rate_limits_machine_readable"]({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        llms: llmsNoPricing,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["rate_limits_machine_readable"]({
        guide: null,
        openapi: null,
        llms: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-152: Pricing/limits cross-source consistency ──────────────────────
  describe("AB-152: Pricing/limits cross-source consistency (pricing_limits_consistency)", () => {
    it("rule definition is correct", () => {
      expect(AB152.rule_id).toBe("AB-152");
      expect(AB152.check.type).toBe("semantic_validation");
      expect(AB152.check.semantic).toBe("pricing_limits_consistency");
      expect(AB152.check.sources).toEqual(["guide", "openapi", "pricing"]);
      expect(AB152.category).toBe("verification");
      expect(AB152.severity).toBe("medium");
    });

    it("matching pricing across guide + openapi → found (VERIFIED)", () => {
      const result = SEMANTIC_CHECKERS["pricing_limits_consistency"]({
        guide: guideWithPricing,
        openapi: openapiWithPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("consistent");
    });

    it("matching pricing across guide + pricing.json → found (VERIFIED)", () => {
      const result = SEMANTIC_CHECKERS["pricing_limits_consistency"]({
        guide: guideWithPricing,
        openapi: openapiNoPricing,
        pricing: pricingJsonMatch,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("consistent");
    });

    it("single source → found (no conflict possible)", () => {
      const result = SEMANTIC_CHECKERS["pricing_limits_consistency"]({
        guide: guideWithPricing,
        openapi: openapiNoPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("Single source");
    });

    it("conflicting pricing: guide $0.01 vs openapi $0.02 → absent (CONFLICT)", () => {
      const result = SEMANTIC_CHECKERS["pricing_limits_consistency"]({
        guide: guidePricing001,
        openapi: openapiPricing002,
        pricing: null,
      });
      expect(result.outcome).toBe("absent");
      expect(result.detail).toContain("CONFLICT");
      expect(result.detail).toContain("$0.01");
      expect(result.detail).toContain("$0.02");
    });

    it("no machine-readable pricing → absent", () => {
      const result = SEMANTIC_CHECKERS["pricing_limits_consistency"]({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        pricing: null,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["pricing_limits_consistency"]({
        guide: null,
        openapi: null,
        pricing: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── Claims are semantic statements ───────────────────────────────────────
  describe("Claims are semantic (not rule names)", () => {
    it("AB-150 name is a semantic claim", () => {
      expect(AB150.name).not.toBe("AB-150");
      expect(AB150.name.length).toBeGreaterThan(3);
    });

    it("AB-151 name is a semantic claim", () => {
      expect(AB151.name).not.toBe("AB-151");
      expect(AB151.name.length).toBeGreaterThan(3);
    });

    it("AB-152 name is a semantic claim", () => {
      expect(AB152.name).not.toBe("AB-152");
      expect(AB152.name.length).toBeGreaterThan(3);
    });
  });

  // ─── Determinism ──────────────────────────────────────────────────────────
  describe("Pure checkers: deterministic", () => {
    it("pricing_discoverability is deterministic", () => {
      const sources = { guide: guideWithPricing, openapi: openapiWithPricing, llms: llmsNoPricing, pricing: pricingJsonMatch };
      const r1 = SEMANTIC_CHECKERS["pricing_discoverability"](sources);
      const r2 = SEMANTIC_CHECKERS["pricing_discoverability"](sources);
      expect(r1).toEqual(r2);
    });

    it("rate_limits_machine_readable is deterministic", () => {
      const sources = { guide: guideWithPricing, openapi: openapiWithPricing, llms: llmsWith429 };
      const r1 = SEMANTIC_CHECKERS["rate_limits_machine_readable"](sources);
      const r2 = SEMANTIC_CHECKERS["rate_limits_machine_readable"](sources);
      expect(r1).toEqual(r2);
    });

    it("pricing_limits_consistency is deterministic", () => {
      const sources = { guide: guidePricing001, openapi: openapiPricing002, pricing: null };
      const r1 = SEMANTIC_CHECKERS["pricing_limits_consistency"](sources);
      const r2 = SEMANTIC_CHECKERS["pricing_limits_consistency"](sources);
      expect(r1).toEqual(r2);
    });
  });

  // ─── findPricingDeclarations helper ───────────────────────────────────────
  describe("findPricingDeclarations helper", () => {
    it("extracts declarations from guide + openapi", () => {
      const decls = findPricingDeclarations({
        guide: guideWithPricing,
        openapi: openapiWithPricing,
        pricing: null,
      });
      expect(decls.length).toBe(2);
      expect(decls[0].source).toBe("guide");
      expect(decls[0].pricePerCall).toBe("$0.01");
      expect(decls[1].source).toBe("openapi");
      expect(decls[1].pricePerCall).toBe("$0.01");
    });

    it("returns empty array when no sources have pricing", () => {
      const decls = findPricingDeclarations({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        pricing: null,
      });
      expect(decls.length).toBe(0);
    });

    it("includes pricing.json when present", () => {
      const decls = findPricingDeclarations({
        guide: guideNoPricing,
        openapi: openapiNoPricing,
        pricing: pricingJsonMatch,
      });
      expect(decls.length).toBe(1);
      expect(decls[0].source).toBe("pricing.json");
      expect(decls[0].pricePerCall).toBe("$0.01");
    });
  });
});
