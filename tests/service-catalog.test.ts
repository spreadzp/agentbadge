/**
 * SLICE-179-1: SKU registry unit tests.
 * AC: allSkus covers all paid surfaces; prices flow from injected
 * sources (mock flips SKU without touching registry); sku_id stable
 * golden; zero IO (sync tests).
 */
import { describe, it, expect } from "vitest";
import {
  allSkus,
  skuById,
  skusBySurface,
  inputSchemaOf,
  type CatalogSources,
  type ServiceSku,
} from "../src/server/lib/service-catalog";

function mockSources(overrides: Partial<CatalogSources> = {}): CatalogSources {
  return {
    scan: {
      enabled: true,
      bundles: [
        {
          id: "discovery-crawling",
          name: "discovery-crawling",
          description: "3 rules",
          price_usd: "0.25",
          rule_count: 3,
        },
      ],
      full_scan_usd: "4.50",
    },
    passport: {
      tiers: [
        { tier: "bronze", price_hbar: "10" },
        { tier: "gold", price_hbar: "200" },
      ],
    },
    marketplace: { enabled: true, passport_price_usd: "10" },
    keeperhub: { enabled: true, premium_price_usd: "0.01" },
    eaas: {
      enabled: true,
      verdict_usd: "0.01",
      scan_usd: "0.05",
      eval_usd: "0.10",
      tier_basic_usd: "5",
      tier_pro_usd: "25",
    },
    bstock: { enabled: true, pass_price_usd: "5", pass_days: 30 },
    venue: { enabled: true, monthly_usd: "10" },
    ...overrides,
  };
}

describe("service-catalog registry", () => {
  it("allSkus covers every surface", () => {
    const surfaces = new Set(allSkus(mockSources()).map((s) => s.surface));
    for (const s of [
      "scan",
      "passport",
      "marketplace",
      "keeperhub",
      "eaas",
      "bstock",
      "venue",
    ])
      expect(surfaces.has(s as ServiceSku["surface"]), s).toBe(true);
  });

  it("sku_id unique + surface:slug format", () => {
    const ids = allSkus(mockSources()).map((s) => s.sku_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+:[a-z0-9-]+$/);
  });

  it("every priced SKU has an endpoint; input_schema has required", () => {
    for (const s of allSkus(mockSources())) {
      if (s.price_usd !== null || s.price_native) {
        expect(s.endpoint.path).toMatch(/^\//);
      }
      if (s.input_schema) {
        expect(s.input_schema).toHaveProperty("type", "object");
        expect(s.input_schema).toHaveProperty("required");
      }
    }
  });

  it("price flows from source — mock change flips SKU (no registry edit)", () => {
    const a = skuById("scan:discovery-crawling", mockSources());
    expect(a!.price_usd).toBe("0.25");
    const b = skuById(
      "scan:discovery-crawling",
      mockSources({
        scan: {
          ...mockSources().scan,
          bundles: [
            { ...mockSources().scan.bundles[0], price_usd: "0.99" },
          ],
        },
      }),
    );
    expect(b!.price_usd).toBe("0.99");
  });

  it("skusBySurface + skuById lookups", () => {
    const src = mockSources();
    expect(skusBySurface("eaas", src).length).toBe(5);
    expect(skuById("eaas:verdict", src)!.price_usd).toBe("0.01");
    expect(skuById("nope:nothing", src)).toBeUndefined();
  });

  it("inputSchemaOf returns the sku schema", () => {
    const sku = skuById("scan:full", mockSources())!;
    expect(inputSchemaOf(sku)).toEqual(sku.input_schema);
    expect((inputSchemaOf(sku)!.required as string[])).toContain("url");
  });

  it("golden: stable sku_id list", () => {
    const ids = allSkus(mockSources()).map((s) => s.sku_id);
    expect(ids).toEqual([
      "scan:discovery-crawling",
      "scan:full",
      "passport:bronze",
      "passport:gold",
      "marketplace:passport-mint",
      "marketplace:service-buy",
      "keeperhub:scan-premium",
      "eaas:verdict",
      "eaas:readiness-scan",
      "eaas:jobs-evaluate",
      "eaas:subscribe-basic",
      "eaas:subscribe-pro",
      "bstock:service-pass",
      "venue:instance-subscription",
    ]);
  });

  it("bstock carries free_tier, venue is wallet-sig", () => {
    const src = mockSources();
    const b = skuById("bstock:service-pass", src)!;
    expect(b.free_tier!.limit).toContain("req/min");
    const v = skuById("venue:instance-subscription", src)!;
    expect(v.auth).toBe("wallet-sig");
  });
});
