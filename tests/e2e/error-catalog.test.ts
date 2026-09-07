import { describe, it, expect } from "vitest";
import { ERROR_CATALOG } from "../../src/server/lib/error-catalog";

const BASE = "http://localhost:4021";

describe("SLICE-122-1: Error catalog endpoint GET /api/meta/errors", () => {
  let body: Record<string, unknown>;

  it("GET /api/meta/errors returns 200", async () => {
    const res = await fetch(`${BASE}/api/meta/errors`);
    expect(res.status).toBe(200);
    body = await res.json();
  });

  it("response has total_count field", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    expect(body).toHaveProperty("total_count");
    expect(typeof body.total_count).toBe("number");
  });

  it("response has count field", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    expect(body).toHaveProperty("count");
    expect(typeof body.count).toBe("number");
  });

  it("response has errors array", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    expect(body).toHaveProperty("errors");
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it("total_count equals errors array length", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    expect(body.total_count).toBe((body.errors as unknown[]).length);
  });

  it("at least 20 error codes documented", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    expect((body.errors as unknown[]).length).toBeGreaterThanOrEqual(20);
  });

  describe("each error has required fields", () => {
    let errors: Record<string, unknown>[];

    it("setup: fetch errors array", async () => {
      if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
      errors = body.errors as Record<string, unknown>[];
    });

    for (let i = 0; i < 25; i++) {
      it(`error[${i}] has code, http_status, agent_impact, hint_template, recovery_action`, () => {
        if (i >= errors.length) return;
        const err = errors[i];
        expect(err).toHaveProperty("code");
        expect(typeof err.code).toBe("string");
        expect(err).toHaveProperty("http_status");
        expect(typeof err.http_status).toBe("number");
        expect(err).toHaveProperty("agent_impact");
        expect(typeof err.agent_impact).toBe("string");
        expect(err).toHaveProperty("hint_template");
        expect(typeof err.hint_template).toBe("string");
        expect(err).toHaveProperty("recovery_action");
        expect(typeof err.recovery_action).toBe("string");
      });
    }
  });

  it("each error has affected_routes array", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    const errors = body.errors as Record<string, unknown>[];
    for (const err of errors) {
      expect(err).toHaveProperty("affected_routes");
      expect(Array.isArray(err.affected_routes)).toBe(true);
    }
  });

  it("recovery_action values are valid enum", async () => {
    if (!body) body = await (await fetch(`${BASE}/api/meta/errors`)).json();
    const validActions = [
      "retry_immediately",
      "change_request",
      "await_human",
      "wait_and_retry",
      "choose_alternative",
      "not_authorized",
      "no_action",
      "escalate",
    ];
    const errors = body.errors as Record<string, unknown>[];
    for (const err of errors) {
      expect(validActions).toContain(err.recovery_action);
    }
  });

  it("no duplicate error codes", () => {
    const codes = ERROR_CATALOG.map((e) => e.code);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("error codes cover passport, marketplace, auth, payment categories", () => {
    const codes = ERROR_CATALOG.map((e) => e.code);
    expect(codes.some((c) => c.startsWith("passport_"))).toBe(true);
    expect(codes.some((c) => c.startsWith("market_"))).toBe(true);
    expect(codes.some((c) => c.startsWith("auth_"))).toBe(true);
    expect(codes.some((c) => c.startsWith("a2a_"))).toBe(true);
  });
});

describe("SLICE-122-1: Error catalog in OpenAPI spec", () => {
  it("GET /api/specs includes /api/meta/errors path", async () => {
    const res = await fetch(`${BASE}/api/specs`);
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths).toHaveProperty("/api/meta/errors");
  });
});

describe("SLICE-122-1: Error catalog in llms.txt", () => {
  it("GET /llms.txt mentions /api/meta/errors", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/api/meta/errors");
  });
});
