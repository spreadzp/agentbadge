import { describe, it, expect } from "vitest";
import { getTrustTiers } from "../../src/server/lib/trust-tiers";

const BASE = "http://localhost:4021";

describe("SLICE-122-3: Trust tiers endpoint GET /api/meta/trust-tiers", () => {
  let body: Record<string, unknown>;

  it("GET /api/meta/trust-tiers returns 200", async () => {
    const res = await fetch(`${BASE}/api/meta/trust-tiers`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it("response has total_count field", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    expect(body).toHaveProperty("total_count");
    expect(typeof body.total_count).toBe("number");
  });

  it("response has tiers array", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    expect(body).toHaveProperty("tiers");
    expect(Array.isArray(body.tiers)).toBe(true);
  });

  it("total_count equals tiers array length", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    expect(body.total_count).toBe((body.tiers as unknown[]).length);
  });

  it("at least 4 tiers defined", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    expect((body.tiers as unknown[]).length).toBeGreaterThanOrEqual(4);
  });

  it("contains unverified tier (level 0)", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    const tiers = body.tiers as Record<string, unknown>[];
    expect(tiers.some((t) => t.name === "unverified" && t.level === 0)).toBe(true);
  });

  it("contains trusted_agent tier (highest level)", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    const tiers = body.tiers as Record<string, unknown>[];
    expect(tiers.some((t) => t.name === "trusted_agent")).toBe(true);
  });

  describe("each tier has required fields", () => {
    let tiers: Record<string, unknown>[];

    it("setup: fetch tiers array", async () => {
      if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
      tiers = body.tiers as Record<string, unknown>[];
    });

    for (let i = 0; i < 6; i++) {
      it(`tier[${i}] has name, level, description, unlocks, requirements`, () => {
        if (i >= tiers.length) return;
        const tier = tiers[i];
        expect(tier).toHaveProperty("name");
        expect(typeof tier.name).toBe("string");
        expect(tier).toHaveProperty("level");
        expect(typeof tier.level).toBe("number");
        expect(tier).toHaveProperty("description");
        expect(typeof tier.description).toBe("string");
        expect(tier).toHaveProperty("unlocks");
        expect(Array.isArray(tier.unlocks)).toBe(true);
        expect(tier).toHaveProperty("requirements");
        expect(Array.isArray(tier.requirements)).toBe(true);
      });
    }
  });

  it("each tier has non-empty unlocks array", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/trust-tiers`)).json();
    const tiers = body.tiers as Record<string, unknown>[];
    for (const tier of tiers) {
      expect((tier.unlocks as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("levels are sequential (0, 1, 2, ...)", () => {
    const catalog = getTrustTiers();
    const levels = catalog.tiers.map((t) => t.level);
    for (let i = 0; i < levels.length; i++) {
      expect(levels[i]).toBe(i);
    }
  });

  it("no duplicate tier names", () => {
    const catalog = getTrustTiers();
    const names = catalog.tiers.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("unverified tier has empty requirements", () => {
    const catalog = getTrustTiers();
    const unverified = catalog.tiers.find((t) => t.name === "unverified");
    expect(unverified).toBeDefined();
    expect(unverified!.requirements.length).toBe(0);
  });
});

describe("SLICE-122-3: Trust tiers in OpenAPI spec", () => {
  it("GET /api/specs includes /api/meta/trust-tiers path", async () => {
    const res = await fetch(`${BASE}/api/specs`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths).toHaveProperty("/api/meta/trust-tiers");
  });
});

describe("SLICE-122-3: Trust tiers in llms.txt", () => {
  it("GET /llms.txt mentions /api/meta/trust-tiers", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/api/meta/trust-tiers");
  });
});
