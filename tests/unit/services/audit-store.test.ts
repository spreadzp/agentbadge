import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../../src/config/env";
import { resetDatabaseForTests } from "../../../src/server/lib/database";
import { AuditStore } from "../../../src/server/services/audit-store";
import { setupMockEnv } from "../../e2e/helpers";

/**
 * SLICE-145-4: AuditStore — async add() durable write-through to Event
 * (type="audit", source="keeperhub") + EventEmitter for SSE + async list()
 * DB-first with in-memory fallback.
 */
describe("AuditStore (DATABASE_ENABLED unset → in-memory)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("add → row in events store (type=audit, source=keeperhub)", async () => {
    const store = new AuditStore();
    const ev = await store.add({
      source: "test",
      siteUrl: "https://a.com",
      status: "recorded",
      score: 85,
    });
    expect(ev.id).toBeTruthy();

    const { getDatabase } = await import(
      "../../../src/server/lib/database"
    );
    const rows = await getDatabase().events.list({ type: "audit" });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("keeperhub");
    const payload = rows[0].payload as { siteUrl: string; score: number };
    expect(payload.siteUrl).toBe("https://a.com");
    expect(payload.score).toBe(85);
  });

  it("add → emits 'audit' after write (SSE consumers)", async () => {
    const store = new AuditStore();
    const seen: unknown[] = [];
    store.on("audit", (e) => seen.push(e));
    await store.add({
      source: "live",
      siteUrl: "https://live.com",
      status: "recorded",
    });
    expect(seen).toHaveLength(1);
  });

  it("list reads back newest-first with siteUrl filter", async () => {
    const store = new AuditStore();
    await store.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    await store.add({ source: "b", siteUrl: "https://b.com", status: "recorded" });
    const all = await store.list();
    expect(all.map((e) => e.source)).toEqual(["b", "a"]);
    const filtered = await store.list({ siteUrl: "https://a.com" });
    expect(filtered).toHaveLength(1);
  });

  it("dedupe by executionId + source preserved on DB path", async () => {
    const store = new AuditStore();
    await store.add({
      source: "scan",
      siteUrl: "https://a.com",
      status: "recorded",
      executionId: "exec_1",
    });
    await store.add({ source: "other", siteUrl: "https://b.com", status: "recorded" });
    await store.add({
      source: "scan",
      siteUrl: "https://a.com",
      status: "failed",
      executionId: "exec_1",
      error: "timeout",
    });
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list[0].executionId).toBe("exec_1");
    expect(list[0].status).toBe("failed");
  });

  it("works with zero env (pure in-memory, no config)", async () => {
    delete process.env.MOCK_HEDERA;
    delete process.env.HEDERA_OPERATOR_ID;
    resetConfigCache();
    resetDatabaseForTests();

    const store = new AuditStore();
    await store.add({ source: "x", siteUrl: "https://x.com", status: "recorded" });
    expect(await store.list()).toHaveLength(1);
  });
});

describe("AuditStore PG mode (opt-in: DATABASE_URL_LIVE)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("add → restart → list returns event from PG", async () => {
    if (!process.env.DATABASE_URL_LIVE) return; // opt-in: local docker PG
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = process.env.DATABASE_URL_LIVE;
    resetConfigCache();
    resetDatabaseForTests();

    const tag = `pg-${Date.now()}.dev`;
    const store1 = new AuditStore();
    const ev = await store1.add({
      source: "pg-test",
      siteUrl: `https://${tag}`,
      status: "recorded",
      score: 42,
    });

    // Simulate restart: fresh store + fresh db singleton
    resetDatabaseForTests();
    const store2 = new AuditStore();
    const list = await store2.list({ siteUrl: `https://${tag}` });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(ev.id);
    expect(list[0].score).toBe(42);

    // cleanup
    const { getDatabase } = await import(
      "../../../src/server/lib/database"
    );
    const rows = await getDatabase().events.list({ type: "audit", limit: 500 });
    for (const r of rows.filter((r) => (r.payload as { siteUrl?: string }).siteUrl === `https://${tag}`)) {
      await getDatabase().events.delete(r.id);
    }
  });
});
