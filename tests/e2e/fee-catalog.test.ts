import { describe, it, expect } from "vitest";
import { getFeeCatalog } from "../../src/server/lib/fee-catalog";

const BASE = "http://localhost:4021";

describe("SLICE-122-2: Fee catalog endpoint GET /api/meta/fees", () => {
  let body: Record<string, unknown>;

  it("GET /api/meta/fees returns 200", async () => {
    const res = await fetch(`${BASE}/api/meta/fees`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it("response has total_count field", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    expect(body).toHaveProperty("total_count");
    expect(typeof body.total_count).toBe("number");
  });

  it("response has currency_note field", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    expect(body).toHaveProperty("currency_note");
    expect(typeof body.currency_note).toBe("string");
  });

  it("response has network field", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    expect(body).toHaveProperty("network");
    expect(typeof body.network).toBe("string");
  });

  it("response has fees array", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    expect(body).toHaveProperty("fees");
    expect(Array.isArray(body.fees)).toBe(true);
  });

  it("total_count equals fees array length", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    expect(body.total_count).toBe((body.fees as unknown[]).length);
  });

  it("at least 5 fee entries", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    expect((body.fees as unknown[]).length).toBeGreaterThanOrEqual(5);
  });

  describe("each fee entry has required fields", () => {
    let fees: Record<string, unknown>[];

    it("setup: fetch fees array", async () => {
      if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
      fees = body.fees as Record<string, unknown>[];
    });

    for (let i = 0; i < 8; i++) {
      it(`fee[${i}] has service, category, price_usd, price_hbar, unit, description, free_tier`, () => {
        if (i >= fees.length) return;
        const fee = fees[i];
        expect(fee).toHaveProperty("service");
        expect(typeof fee.service).toBe("string");
        expect(fee).toHaveProperty("category");
        expect(typeof fee.category).toBe("string");
        expect(fee).toHaveProperty("price_usd");
        expect(fee).toHaveProperty("price_hbar");
        expect(fee).toHaveProperty("unit");
        expect(typeof fee.unit).toBe("string");
        expect(fee).toHaveProperty("description");
        expect(typeof fee.description).toBe("string");
        expect(fee).toHaveProperty("free_tier");
        expect(typeof fee.free_tier).toBe("boolean");
      });
    }
  });

  it("contains passport category fees", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    const fees = body.fees as Record<string, unknown>[];
    const passportFees = fees.filter((f) => f.category === "passport");
    expect(passportFees.length).toBeGreaterThanOrEqual(4);
  });

  it("contains marketplace fee entry", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    const fees = body.fees as Record<string, unknown>[];
    expect(fees.some((f) => f.category === "marketplace")).toBe(true);
  });

  it("contains scan_api fee entry", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    const fees = body.fees as Record<string, unknown>[];
    expect(fees.some((f) => f.category === "scan_api")).toBe(true);
  });

  it("passport fees have HBAR prices", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    const fees = body.fees as Record<string, unknown>[];
    const passportIssuance = fees.filter(
      (f) => f.category === "passport" && (f.service as string).startsWith("passport_issuance_"),
    );
    for (const fee of passportIssuance) {
      expect(fee.price_hbar).not.toBeNull();
      expect(typeof fee.price_hbar).toBe("number");
      expect(fee.price_hbar as number).toBeGreaterThan(0);
    }
  });

  it("scan_api and badge_api are free", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/fees`)).json();
    const fees = body.fees as Record<string, unknown>[];
    const freeServices = fees.filter((f) => f.category === "scan_api" || f.category === "badge_api");
    for (const fee of freeServices) {
      expect(fee.free_tier).toBe(true);
    }
  });

  it("no duplicate service names", () => {
    const catalog = getFeeCatalog();
    const names = catalog.fees.map((f) => f.service);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe("SLICE-122-2: Fee catalog in OpenAPI spec", () => {
  it("GET /api/specs includes /api/meta/fees path", async () => {
    const res = await fetch(`${BASE}/api/specs`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths).toHaveProperty("/api/meta/fees");
  });
});

describe("SLICE-122-2: Fee catalog in llms.txt", () => {
  it("GET /llms.txt mentions /api/meta/fees", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/api/meta/fees");
  });
});
