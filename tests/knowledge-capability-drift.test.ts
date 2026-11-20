import { describe, expect, it } from "vitest";

import {
  capabilityDrift,
  collectSeedCapabilities,
  createMemoryKnowledgeStores,
  seedCapabilities,
  upsertKnowledgeCapability,
} from "../src/server/lib/knowledge";

/**
 * SLICE-229-4 DoD — capability registry drift check:
 * - collectSeedCapabilities is deterministic and non-empty (code
 *   sources: scanner rules, x402 packs, MCP tools, manifests).
 * - seed is idempotent (second run adds nothing).
 * - drift report catches SEEDED rows the code no longer emits
 *   (rename/removal), while MANUAL db-only rows are tolerated.
 * - CI failure rule: code-only (in code, missing from registry)
 *   fails; seeded db-only also fails (registry claims a capability
 *   the code dropped); manual db-only is fine.
 */

describe("capability seed + drift (SLICE-229-4)", () => {
  it("collect covers all four code sources, deterministic", () => {
    const a = collectSeedCapabilities().map((c) => c.name).sort();
    const b = collectSeedCapabilities().map((c) => c.name).sort();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(50);
    const prefixes = new Set(a.map((n) => n.split(".")[0]));
    expect(prefixes).toEqual(
      new Set(["check", "x402-pack", "mcp", "manifest"]),
    );
    expect(a).toContain("check.AB-001");
    expect(a).toContain("x402-pack.discovery");
    expect(a).toContain("mcp.get_about");
    expect(a).toContain("manifest.llms.txt");
  });

  it("seed is idempotent — second run adds nothing", async () => {
    const store = createMemoryKnowledgeStores();
    const first = await seedCapabilities(store);
    expect(first.added).toBe(first.total);
    expect(first.existing).toBe(0);
    const second = await seedCapabilities(store);
    expect(second.added).toBe(0);
    expect(second.existing).toBe(second.total);
    expect(second.dbOnlySeeded).toEqual([]);
    const rows = await store.listCapabilities({ limit: 10_000 });
    expect(rows).toHaveLength(first.total);
    expect(rows.every((r) => r.verified && r.source === "SEEDED")).toBe(true);
  });

  it("drift: code-only fails the check; MANUAL db-only tolerated", async () => {
    const store = createMemoryKnowledgeStores();
    await seedCapabilities(store);
    // A capability the code doesn't produce — MANUAL → tolerated.
    await upsertKnowledgeCapability(store, {
      name: "custom.operator-thing",
      kind: "MANUAL",
      source: "MANUAL",
    });
    // A stale SEEDED row simulating a removed/renamed code capability.
    await upsertKnowledgeCapability(store, {
      name: "check.AB-999",
      kind: "SCANNER_CHECK",
      source: "SEEDED",
    });
    const drift = await capabilityDrift(store);
    expect(drift.codeOnly).toEqual([]); // registry is complete post-seed
    expect(drift.dbOnlySeeded).toEqual(["check.AB-999"]);
    expect(drift.dbOnlyManual).toEqual(["custom.operator-thing"]);
  });

  it("link/unlink m:n dedupe through lib wrappers", async () => {
    const store = createMemoryKnowledgeStores();
    const up = await upsertKnowledgeCapability(store, {
      name: "mcp.test_tool", kind: "MCP_TOOL", source: "MANUAL",
    });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    expect(up.capability.verified).toBe(false); // MANUAL default
    const { createKnowledgeItem, linkItemCapability, unlinkItemCapability } =
      await import("../src/server/lib/knowledge");
    const item = await createKnowledgeItem(
      store, { kind: "CAPABILITY_DOC", title: "t", body: "b" }, "ops",
    );
    if (!item.ok) throw new Error("create failed");
    const l1 = await linkItemCapability(store, item.item.id, up.capability.id);
    const l2 = await linkItemCapability(store, item.item.id, up.capability.id);
    expect(l1).toMatchObject({ ok: true, created: true });
    expect(l2).toMatchObject({ ok: true, created: false });
    expect(
      await store.itemsForCapability("mcp.test_tool"),
    ).toEqual([item.item.id]);
    const u = await unlinkItemCapability(store, item.item.id, up.capability.id);
    expect(u).toMatchObject({ ok: true, removed: true });
    const ghost = await linkItemCapability(store, "ki_x", up.capability.id);
    expect(ghost).toMatchObject({ ok: false, error: "item_not_found" });
    const badCap = await linkItemCapability(store, item.item.id, "kc_x");
    expect(badCap).toMatchObject({ ok: false, error: "capability_not_found" });
  });
});
