import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { auditStore } from "../../../src/server/lib/keeperhub-audit-store";
import { resetConfigCache } from "../../../src/config/env";
import { resetDatabaseForTests } from "../../../src/server/lib/database";

const originalEnv = { ...process.env };

describe("SLICE-126-10: keeperhub-audit-store", () => {
  beforeEach(async () => {
    process.env = { ...originalEnv };
    // Isolate from .env DATABASE_ENABLED (vitest.setup loads .env) —
    // audit writes must hit the in-memory fallback, not the real DB.
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    resetDatabaseForTests();
    await auditStore.clear();
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("add → unshift (newest first)", async () => {
    await auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    await auditStore.add({ source: "b", siteUrl: "https://b.com", status: "recorded" });
    const list = await auditStore.list();
    expect(list).toHaveLength(2);
    expect(list[0].source).toBe("b");
    expect(list[1].source).toBe("a");
  });

  it("list default limit 50", async () => {
    for (let i = 0; i < 60; i++) {
      await auditStore.add({ source: `s${i}`, siteUrl: `https://${i}.com`, status: "recorded" });
    }
    expect(await auditStore.list()).toHaveLength(50);
    expect(auditStore.size()).toBe(60);
  });

  it("list with siteUrl filter", async () => {
    await auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    await auditStore.add({ source: "b", siteUrl: "https://b.com", status: "recorded" });
    await auditStore.add({ source: "c", siteUrl: "https://a.com", status: "recorded" });
    const filtered = await auditStore.list({ siteUrl: "https://a.com" });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.siteUrl === "https://a.com")).toBe(true);
  });

  it("MAX_EVENTS cap trims tail", async () => {
    for (let i = 0; i < 550; i++) {
      await auditStore.add({ source: `s${i}`, siteUrl: `https://${i}.com`, status: "recorded" });
    }
    expect(auditStore.size()).toBe(500);
    // Newest 500 should be s549..s50
    const list = await auditStore.list({ limit: 500 });
    expect(list[0].source).toBe("s549");
    expect(list[499].source).toBe("s50");
  });

  it("clear empties store", async () => {
    await auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    await auditStore.clear();
    expect(auditStore.size()).toBe(0);
    expect(await auditStore.list()).toHaveLength(0);
  });

  it("emitter emits 'audit' on add", async () => {
    let emitted = false;
    auditStore.once("audit", () => { emitted = true; });
    await auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    expect(emitted).toBe(true);
  });

  it("dedupe: same executionId+source replaces (position updates to front)", async () => {
    await auditStore.add({ source: "scan", siteUrl: "https://a.com", status: "recorded", executionId: "exec_1" });
    await auditStore.add({ source: "other", siteUrl: "https://b.com", status: "recorded" });
    // Now update exec_1
    await auditStore.add({ source: "scan", siteUrl: "https://a.com", status: "failed", executionId: "exec_1", error: "timeout" });
    const list = await auditStore.list();
    expect(list).toHaveLength(2);
    expect(list[0].executionId).toBe("exec_1");
    expect(list[0].status).toBe("failed");
    expect(list[0].error).toBe("timeout");
  });

  it("SLICE-126-17: cap eviction removes oldest, not newest", async () => {
    for (let i = 0; i < 500; i++) {
      await auditStore.add({ source: `s${i}`, siteUrl: `https://${i}.com`, status: "recorded" });
    }
    expect(auditStore.size()).toBe(500);
    await auditStore.add({ source: "new", siteUrl: "https://new.com", status: "recorded" });
    expect(auditStore.size()).toBe(500);
    const list = await auditStore.list({ limit: 500 });
    expect(list[0].source).toBe("new");
    expect(list[499].source).toBe("s1");
  });

  it("SLICE-126-17: dedupe replace updates position to front", async () => {
    await auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded", executionId: "e1" });
    await auditStore.add({ source: "b", siteUrl: "https://b.com", status: "recorded" });
    await auditStore.add({ source: "c", siteUrl: "https://c.com", status: "recorded" });
    expect((await auditStore.list())[2].source).toBe("a");
    await auditStore.add({ source: "a", siteUrl: "https://a.com", status: "failed", executionId: "e1" });
    const list = await auditStore.list();
    expect(list).toHaveLength(3);
    expect(list[0].source).toBe("a");
    expect(list[0].status).toBe("failed");
  });

  it("SLICE-126-17: emitter on/off pairing under rapid add", async () => {
    let count = 0;
    const handler = () => { count++; };
    auditStore.on("audit", handler);
    for (let i = 0; i < 10; i++) {
      await auditStore.add({ source: `s${i}`, siteUrl: `https://${i}.com`, status: "recorded" });
    }
    auditStore.off("audit", handler);
    await auditStore.add({ source: "after", siteUrl: "https://after.com", status: "recorded" });
    expect(count).toBe(10);
  });
});
