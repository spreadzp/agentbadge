/**
 * GET /api/v1/services — canonical paid-services catalog (MYPROJ-2588).
 *
 * The endpoint was declared in agent-card, refusal-contract price_truth,
 * llms.txt and the C17 articles but never implemented (404). This suite
 * locks the contract: 200 + shape + price truth — catalog prices come
 * from the same constants the x402 middleware resolves at request time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestApp, setupMockEnv } from "./helpers";
import {
  FULL_SCAN_PRICE,
  USDC,
} from "../../src/agent-readiness/rule-bundles";
import { REFUSAL_MATRIX } from "../../src/server/lib/refusal-contract";
import { BSTOCK_PRICE_USD } from "../../src/config/env/bstock";

interface CatalogEntry {
  id: string;
  path: string;
  method: string;
  price_usd: string | null;
  enabled: boolean;
  free_tier: boolean;
  refusal_codes: string[];
}

describe("GET /api/v1/services", () => {
  beforeEach(() => setupMockEnv());
  afterEach(() => vi.unstubAllEnvs());

  async function get() {
    const app = makeTestApp();
    const res = await app.request("/api/v1/services");
    return { status: res.status, body: await res.json() };
  }

  it("returns 200 with version + refusal-contract pointer + services[]", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.version).toBe("1.0");
    expect(body.currency).toBe(USDC);
    expect(body.refusal_contract).toBe("/api/meta/refusal-contract");
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.length).toBeGreaterThanOrEqual(8);
  });

  it("every service entry carries path, method, unit, refusal_codes", async () => {
    const { body } = await get();
    const codes = REFUSAL_MATRIX.map((m) => m.code);
    for (const s of body.services as CatalogEntry[]) {
      expect(s.id).toBeTruthy();
      expect(s.path).toMatch(/^\//);
      expect(["GET", "POST"]).toContain(s.method);
      expect(s.refusal_codes.sort()).toEqual([...codes].sort());
    }
  });

  it("price truth: scan-packs entry + bundles match FULL_SCAN_PRICE / bundleMetadata", async () => {
    const { body } = await get();
    const scan = body.services.find((s: CatalogEntry) => s.id === "scan-packs");
    expect(scan).toBeDefined();
    expect(scan!.price_usd).toBe(FULL_SCAN_PRICE);
    expect(body.scan_packs.full_scan_usd).toBe(FULL_SCAN_PRICE);
    expect(body.scan_packs.bundles.length).toBeGreaterThanOrEqual(8);
    for (const b of body.scan_packs.bundles) {
      expect(b.price_usd).toMatch(/^\d+(\.\d{1,2})?$/);
      expect(b.rule_count).toBeGreaterThan(0);
    }
  });

  it("price truth: bstock pass matches BSTOCK_PRICE_USD constant", async () => {
    const { body } = await get();
    const b = body.services.find(
      (s: CatalogEntry) => s.id === "bstock-service-pass",
    );
    expect(b).toBeDefined();
    // cfg.bstock.priceUsd when enabled, else the same constant
    expect(b!.price_usd).toBe(BSTOCK_PRICE_USD);
  });

  it("eaas entries exist; prices sourced from cfg.eaas when enabled", async () => {
    const { body } = await get();
    for (const id of [
      "eaas-verdict",
      "eaas-readiness-scan",
      "eaas-jobs-evaluate",
      "eaas-subscribe-basic",
      "eaas-subscribe-pro",
    ]) {
      const e = body.services.find((s: CatalogEntry) => s.id === id);
      expect(e, `missing ${id}`).toBeDefined();
      expect(e!.path).toMatch(/^\/api\/eaas\//);
    }
  });

  it("dynamic marketplace buy entry has null price + pointer to live catalog", async () => {
    const { body } = await get();
    const m = body.services.find(
      (s: CatalogEntry) => s.id === "marketplace-service-buy",
    );
    expect(m).toBeDefined();
    expect(m!.price_usd).toBeNull();
    expect(m!.notes).toContain("/api/market/services");
  });
});
