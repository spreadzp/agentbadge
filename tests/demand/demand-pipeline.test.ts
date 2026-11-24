import { describe, expect, it } from "vitest";

import { createMemoryDemandStores } from "../../src/server/lib/demand/db-stores";
import { ingestDemand } from "../../src/server/lib/demand/pipeline";
import {
  clampDeclaredLevel,
  demandDedupeKey,
  demandDedupeWindow,
  DEMAND_DEDUPE_WINDOW_MS,
  normalizeClusterKey,
  normalizeDemandText,
} from "../../src/server/lib/demand/normalize";
import {
  classifyDemandText,
  collectDemandDictionary,
  demandDictDrift,
} from "../../src/server/lib/demand/vocabulary";
import { promotionFor } from "../../src/server/lib/demand/level-rules";
import type {
  ActorResolution,
  DemandSource,
} from "../../src/server/lib/demand/types";

const actor = (
  ref: string | null,
  resolution: ActorResolution = "API_KEY",
) => ({
  resolution,
  actorRef: ref,
});

const H = 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

const ingest = (
  s: ReturnType<typeof createMemoryDemandStores>,
  text: string,
  over: Record<string, unknown> = {},
) =>
  ingestDemand(
    s,
    {
      text,
      source: "DEMAND_API" as DemandSource,
      ...(over as object),
    },
    (over.actor as ReturnType<typeof actor>) ?? actor("ag_1"),
    { now: over.now as number | undefined },
  );

describe("normalizeDemandText", () => {
  it("NFKC + lowercase + collapse whitespace + trim", () => {
    expect(normalizeDemandText("  X402   Escrow\nAPIs  ")).toBe(
      "x402 escrow apis",
    );
    expect(normalizeDemandText("Ｆｕｌｌｗｉｄｔｈ")).toBe("fullwidth");
    expect(normalizeDemandText("   ")).toBe("");
  });
});

describe("demandDedupeKey", () => {
  it("same actor+text+window → same key; window/actor drift → new key", () => {
    const k1 = demandDedupeKey("x402 escrow", "ag_1", T0);
    expect(demandDedupeKey("x402 escrow", "ag_1", T0 + H)).toBe(k1);
    expect(
      demandDedupeKey(
        "x402 escrow",
        "ag_1",
        T0 + DEMAND_DEDUPE_WINDOW_MS,
      ),
    ).not.toBe(k1);
    expect(demandDedupeKey("x402 escrow", "ag_2", T0)).not.toBe(k1);
    expect(demandDedupeKey("other text", "ag_1", T0)).not.toBe(k1);
    expect(demandDedupeWindow(T0)).toBe(demandDedupeWindow(T0 + H));
  });
});

describe("classifyDemandText + dictionary", () => {
  it("first-match rules map terms → category/feature", () => {
    expect(classifyDemandText("need x402 escrow support")).toEqual({
      category: "payments",
      feature: "escrow",
      capabilityKey: "x402-pack.escrow",
    });
    expect(classifyDemandText("agent passport verification")).toEqual({
      category: "identity",
      feature: "passport",
      capabilityKey: null,
    });
    expect(classifyDemandText("xyzzy nothing matches")).toEqual({
      category: null,
      feature: null,
      capabilityKey: null,
    });
  });

  it("dictionary covers the D-228-5 starter vocab (drift-check)", () => {
    const dict = collectDemandDictionary();
    expect(dict.categories).toContain("payments");
    const drift = demandDictDrift();
    // entities the rules don't yet map are surfaced, not silent
    expect(drift.uncoveredEntities).toBeInstanceOf(Array);
    // every starter TOPIC must be covered by some rule term
    expect(drift.uncoveredTopics).toEqual([]);
  });
});

describe("normalizeClusterKey", () => {
  it("dict/text namespaces; unfeatured falls back to text", () => {
    expect(normalizeClusterKey("payments", "escrow", "x402 escrow")).toBe(
      "dict:payments|escrow",
    );
    expect(normalizeClusterKey("payments", null, "x402 refunds")).toBe(
      "dict:payments|text:x402 refunds",
    );
    expect(normalizeClusterKey(null, null, "mystery thing")).toBe(
      "text:mystery thing",
    );
  });
});

describe("level rules (O1)", () => {
  it("thresholds: 2→NEED, 5→INTENT, 10→PURCHASE_INTENT, never VERIFIED", () => {
    expect(promotionFor(1)).toBeNull();
    expect(promotionFor(2)).toBe("NEED");
    expect(promotionFor(5)).toBe("INTENT");
    expect(promotionFor(10)).toBe("PURCHASE_INTENT");
    expect(clampDeclaredLevel("VERIFIED_DEMAND")).toBe("PURCHASE_INTENT");
    expect(clampDeclaredLevel("INTENT")).toBe("INTENT");
  });
});

describe("ingestDemand (memory store)", () => {
  it("ingests → signal + cluster upsert + events as one unit", async () => {
    const s = createMemoryDemandStores();
    const r = await ingest(s, "x402 escrow support", { now: T0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.duplicate).toBe(false);
    expect(r.signal.source).toBe("DEMAND_API");
    expect(r.signal.normalizedText).toBe("x402 escrow support");
    expect(r.signal.category).toBe("payments");
    expect(r.signal.feature).toBe("escrow");
    expect(r.signal.clusterId).toBe(r.cluster.id);
    expect(r.cluster.clusterKey).toBe("dict:payments|escrow");
    expect(r.cluster.count).toBe(1);
    expect(r.cluster.uniqueActors).toBe(1);
    const ev = await s.listEvents("signal", r.signal.id);
    expect(ev.map((e) => e.visibility).sort()).toEqual([
      "INTERNAL",
      "PUBLIC",
    ]);
    const internal = ev.find((e) => e.visibility === "INTERNAL")!;
    const payload = internal.payload as Record<string, unknown>;
    expect(payload.clusterKey).toBe("dict:payments|escrow");
    expect(payload.actorRef).toBeUndefined(); // actor nested, not flat
    const pub = ev.find((e) => e.visibility === "PUBLIC")!;
    expect(
      JSON.stringify(pub.payload).includes("ag_1"),
    ).toBe(false); // actorRef never leaks to PUBLIC
  });

  it("burst dedup: same actor+text in window → relatedCount, no new canonical", async () => {
    const s = createMemoryDemandStores();
    const a = await ingest(s, "x402 escrow support", { now: T0 });
    const b = await ingest(s, "x402 escrow support", { now: T0 + H });
    expect(b.ok && a.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.canonicalOf).toBe(a.signal.id);
    expect(b.signal.relatedSignalId).toBe(a.signal.id);
    const canonical = await s.getSignal(a.signal.id);
    expect(canonical!.relatedCount).toBe(2);
    // cluster counts canonical only — count stays 1
    const cluster = await s.getCluster(a.cluster.id);
    expect(cluster!.count).toBe(1);
    // across the window → a NEW canonical signal
    const c = await ingest(s, "x402 escrow support", {
      now: T0 + DEMAND_DEDUPE_WINDOW_MS,
    });
    expect(c.ok && !c.signal.relatedSignalId).toBe(true);
    if (!c.ok) return;
    const cluster2 = await s.getCluster(a.cluster.id);
    expect(cluster2!.count).toBe(2);
  });

  it("ANON actors bucket per session — unidentified callers never merge", async () => {
    const s = createMemoryDemandStores();
    const anonA = actor(null, "ANON");
    const anonB = actor(null, "ANON");
    const a = await ingestDemand(
      s,
      { text: "x402 escrow", source: "DEMAND_API", sessionId: "sess_a" },
      anonA,
      { now: T0 },
    );
    const b = await ingestDemand(
      s,
      { text: "x402 escrow", source: "DEMAND_API", sessionId: "sess_b" },
      anonB,
      { now: T0 },
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // different sessions → different actorRefs → two canonicals
    expect(b.signal.relatedSignalId).toBeNull();
    const cluster = await s.getCluster(a.cluster.id);
    expect(cluster!.uniqueActors).toBe(2);
    // same actor twice → still one unique actor (no inflation)
    const a2 = await ingestDemand(
      s,
      { text: "x402 refunds", source: "DEMAND_API", sessionId: "sess_a" },
      anonA,
      { now: T0 },
    );
    expect(a2.ok).toBe(true);
    const c2 = await s.getClusterByKey("dict:payments|refunds");
    expect(c2!.uniqueActors).toBe(1);
  });

  it("level clamp: VERIFIED_DEMAND claim records as PURCHASE_INTENT", async () => {
    const s = createMemoryDemandStores();
    const r = await ingest(s, "want to buy escrow", {
      declaredLevel: "VERIFIED_DEMAND",
      now: T0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.declaredLevel).toBe("PURCHASE_INTENT");
    expect(r.signal.level).toBe("PURCHASE_INTENT");
    expect(r.cluster.level).toBe("PURCHASE_INTENT");
    // and rules can never take it to VERIFIED
    expect(r.promotedTo).not.toBe("VERIFIED_DEMAND");
  });

  it("uniqueActors floors promote the cluster — repeats of one actor do not", async () => {
    const s = createMemoryDemandStores();
    const mk = (i: number) =>
      ingest(s, "x402 escrow", {
        actor: actor(`ag_${i}`),
        now: T0 + i * DEMAND_DEDUPE_WINDOW_MS, // each a new canonical
      });
    const r1 = await mk(1);
    expect(r1.ok && r1.cluster.level).toBeTruthy();
    if (!r1.ok) return;
    expect(r1.cluster.level).toBe("INTEREST"); // 1 actor, INTEREST default
    const r2 = await mk(2);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.promotedTo).toBe("NEED"); // 2 unique actors
    expect(r2.cluster.level).toBe("NEED");
    // same actor again — no level move (§13.2)
    const r2b = await ingest(s, "x402 escrow", {
      actor: actor("ag_1"),
      now: T0 + 5 * DEMAND_DEDUPE_WINDOW_MS,
    });
    expect(r2b.ok && r2b.cluster.level === "NEED").toBe(true);
    for (const i of [3, 4, 5]) await mk(i);
    const r5 = await s.getClusterByKey("dict:payments|escrow");
    expect(r5!.uniqueActors).toBe(5);
    expect(r5!.level).toBe("INTENT");
  });

  it("idempotencyKey replay → duplicate, no second events", async () => {
    const s = createMemoryDemandStores();
    const a = await ingestDemand(
      s,
      { text: "x402 escrow", source: "DEMAND_API" },
      actor("ag_1"),
      { idempotencyKey: "idem_1", now: T0 },
    );
    const b = await ingestDemand(
      s,
      { text: "x402 escrow", source: "DEMAND_API" },
      actor("ag_1"),
      { idempotencyKey: "idem_1", now: T0 },
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.duplicate).toBe(true);
    expect(b.signal.id).toBe(a.signal.id);
    const ev = await s.listEvents("signal", a.signal.id);
    expect(ev).toHaveLength(2); // PUBLIC+INTERNAL once, not twice
    const cluster = await s.getCluster(a.cluster.id);
    expect(cluster!.count).toBe(1);
  });

  it("caller-provided classification wins; rejects empty/oversized", async () => {
    const s = createMemoryDemandStores();
    const r = await ingest(s, "x402 escrow", {
      category: "custom_cat",
      feature: "custom_feat",
      now: T0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.category).toBe("custom_cat");
    expect(r.cluster.clusterKey).toBe("dict:custom_cat|custom_feat");
    expect(await ingest(s, "   ")).toMatchObject({
      ok: false,
      field: "text",
    });
    expect(await ingest(s, "x".repeat(1001))).toMatchObject({
      ok: false,
      field: "text",
    });
  });
});
