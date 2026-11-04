/**
 * SLICE-206-2: contract guards — required idempotency_key, dedupe replay,
 * bounded evidence/summary, legacy deprecation headers.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  evidenceRefsSchema,
  idempotencyKeySchema,
  idempotentWrite,
  legacyWriteDeprecation,
  readIdempotencyKey,
  resetIdempotencyStore,
  summarySchema,
} from "../src/server/lib/contract-guards";

beforeEach(() => resetIdempotencyStore());

describe("zod fragments (limits from 206-1 CONTRACT_LIMITS)", () => {
  it("idempotencyKey: 8-128 chars", () => {
    expect(idempotencyKeySchema.safeParse("short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("x".repeat(129)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse("test-idem-key").success).toBe(true);
    expect(idempotencyKeySchema.safeParse("x".repeat(128)).success).toBe(true);
  });

  it("evidenceRefs ≤50 × ≤1000; summary ≤4000", () => {
    expect(
      evidenceRefsSchema.safeParse(Array(51).fill("ref")).success,
    ).toBe(false);
    expect(
      evidenceRefsSchema.safeParse(["x".repeat(1001)]).success,
    ).toBe(false);
    expect(
      evidenceRefsSchema.safeParse(Array(50).fill("ref")).success,
    ).toBe(true);
    expect(summarySchema.safeParse("x".repeat(4001)).success).toBe(false);
    expect(summarySchema.safeParse("x".repeat(4000)).success).toBe(true);
  });
});

describe("readIdempotencyKey (required on new writes)", () => {
  const app = new Hono().post("/w", (c) => {
    const key = readIdempotencyKey(c);
    if (key instanceof Response) return key;
    return c.json({ ok: true, key });
  });

  it("missing header → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const res = await app.request("/w", { method: "POST" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("too-short header → 400; valid → key passes through", async () => {
    const short = await app.request("/w", {
      method: "POST",
      headers: { "idempotency-key": "abc" },
    });
    expect(short.status).toBe(400);
    const ok = await app.request("/w", {
      method: "POST",
      headers: { "idempotency-key": "test-idem-key" },
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { key: string }).key).toBe("test-idem-key");
  });
});

describe("idempotentWrite dedupe", () => {
  it("same (scope,key) → identical body + duplicate:true, no re-run", async () => {
    let calls = 0;
    const produce = () => {
      calls++;
      return { status: 200, body: { task: "t1", accepted: true } };
    };
    const first = await idempotentWrite("POST /tasks", "test-idem-001", produce);
    const replay = await idempotentWrite("POST /tasks", "test-idem-001", produce);
    expect(calls).toBe(1); // zero side-effects on replay
    expect(first.duplicate).toBe(false);
    expect(replay.duplicate).toBe(true);
    expect(replay.body).toEqual({ task: "t1", accepted: true, duplicate: true });
    expect(replay.status).toBe(200);
  });

  it("different scope or key → independent executions", async () => {
    let calls = 0;
    const produce = () => {
      calls++;
      return { status: 200, body: { n: calls } };
    };
    await idempotentWrite("POST /a", "test-idem-a", produce);
    const otherScope = await idempotentWrite("POST /b", "test-idem-a", produce);
    const otherKey = await idempotentWrite("POST /a", "test-idem-b", produce);
    expect(otherScope.duplicate).toBe(false);
    expect(otherKey.duplicate).toBe(false);
    expect(calls).toBe(3);
  });
});

describe("legacyWriteDeprecation (D-206-8)", () => {
  const app = new Hono();
  app.use("/market/*", legacyWriteDeprecation());
  app.post("/market/tasks", (c) => c.json({ ok: true }));
  app.get("/market/tasks", (c) => c.json({ ok: true }));
  app.post("/market/already", (c) => {
    c.header("Deprecation", "true");
    return c.json({ ok: true });
  });

  it("POST → Deprecation + Sunset + Link successor", async () => {
    const res = await app.request("/market/tasks", { method: "POST" });
    expect(res.headers.get("deprecation")).toBe("true");
    expect(res.headers.get("sunset")).toContain("2026");
    expect(res.headers.get("link")).toContain("agentbadge-machine.json");
  });

  it("GET → no deprecation headers", async () => {
    const res = await app.request("/market/tasks");
    expect(res.headers.get("deprecation")).toBeNull();
    expect(res.headers.get("sunset")).toBeNull();
  });

  it("existing Deprecation → Warning: 299, not clobbered", async () => {
    const res = await app.request("/market/already", { method: "POST" });
    expect(res.headers.get("deprecation")).toBe("true");
    const warn = res.headers.get("warning") ?? "";
    expect(warn).toContain("299");
    expect(res.headers.get("link")).toBeNull();
  });
});
