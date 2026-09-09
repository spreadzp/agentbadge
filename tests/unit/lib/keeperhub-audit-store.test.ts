import { describe, it, expect, beforeEach } from "vitest";
import { auditStore } from "../../../src/server/lib/keeperhub-audit-store";

describe("SLICE-126-10: keeperhub-audit-store", () => {
  beforeEach(() => {
    auditStore.clear();
  });

  it("add → unshift (newest first)", () => {
    auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    auditStore.add({ source: "b", siteUrl: "https://b.com", status: "recorded" });
    const list = auditStore.list();
    expect(list).toHaveLength(2);
    expect(list[0].source).toBe("b");
    expect(list[1].source).toBe("a");
  });

  it("list default limit 50", () => {
    for (let i = 0; i < 60; i++) {
      auditStore.add({ source: `s${i}`, siteUrl: `https://${i}.com`, status: "recorded" });
    }
    expect(auditStore.list()).toHaveLength(50);
    expect(auditStore.size()).toBe(60);
  });

  it("list with siteUrl filter", () => {
    auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    auditStore.add({ source: "b", siteUrl: "https://b.com", status: "recorded" });
    auditStore.add({ source: "c", siteUrl: "https://a.com", status: "recorded" });
    const filtered = auditStore.list({ siteUrl: "https://a.com" });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.siteUrl === "https://a.com")).toBe(true);
  });

  it("MAX_EVENTS cap trims tail", () => {
    for (let i = 0; i < 550; i++) {
      auditStore.add({ source: `s${i}`, siteUrl: `https://${i}.com`, status: "recorded" });
    }
    expect(auditStore.size()).toBe(500);
    // Newest 500 should be s549..s50
    const list = auditStore.list({ limit: 500 });
    expect(list[0].source).toBe("s549");
    expect(list[499].source).toBe("s50");
  });

  it("clear empties store", () => {
    auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    auditStore.clear();
    expect(auditStore.size()).toBe(0);
    expect(auditStore.list()).toHaveLength(0);
  });

  it("emitter emits 'audit' on add", () => {
    let emitted = false;
    auditStore.once("audit", () => { emitted = true; });
    auditStore.add({ source: "a", siteUrl: "https://a.com", status: "recorded" });
    expect(emitted).toBe(true);
  });

  it("dedupe: same executionId+source replaces (position updates to front)", () => {
    auditStore.add({ source: "scan", siteUrl: "https://a.com", status: "recorded", executionId: "exec_1" });
    auditStore.add({ source: "other", siteUrl: "https://b.com", status: "recorded" });
    // Now update exec_1
    auditStore.add({ source: "scan", siteUrl: "https://a.com", status: "failed", executionId: "exec_1", error: "timeout" });
    const list = auditStore.list();
    expect(list).toHaveLength(2);
    expect(list[0].executionId).toBe("exec_1");
    expect(list[0].status).toBe("failed");
    expect(list[0].error).toBe("timeout");
  });
});
