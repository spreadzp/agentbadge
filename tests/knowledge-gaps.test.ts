import { describe, expect, it } from "vitest";

import {
  addEvidence,
  composeAnswer,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  knowledgeGapRecorder,
  listGaps,
  normalizeQuery,
  recordGap,
  recordInteractionGap,
  resolveGap,
  triageGap,
  wontfixGap,
  onKnowledgeEvent,
  setKnowledgeEventsGateForTests,
} from "../src/server/lib/knowledge";
import { approveTransition } from "./helpers/knowledge";

/**
 * SLICE-229-8 DoD — persisted knowledge gaps:
 * - dedup by normalizedQuery (case/whitespace variants → one gap)
 * - count++ on repeat, sampleQueries cap 10, lastSeenAt moves
 * - lifecycle OPEN→TRIAGED→RESOLVED|WONTFIX only; RESOLVED needs
 *   an existing linked item
 * - emit knowledge.gap.detected only on FIRST sighting
 * - recordInteractionGap seam works without 228 code present
 * - composer refusal wires through knowledgeGapRecorder
 */

const OP = "ops_test";

describe("knowledge gaps (SLICE-229-8)", () => {
  it("normalizeQuery collapses case/whitespace", () => {
    expect(normalizeQuery("  Escrow   HOW  does ")).toBe("escrow how does");
  });

  it("dedup: variants → one gap, count++, samples capped at 10", async () => {
    const store = createMemoryKnowledgeStores();
    const r1 = await recordGap(store, {
      query: "How does escrow work?", source: "COMPOSER_REFUSAL",
    });
    const r2 = await recordGap(store, {
      query: "  how DOES escrow   work? ", source: "COMPOSER_REFUSAL",
    });
    expect(r1.ok && r1.created).toBe(true);
    expect(r2.ok && !r2.created).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r2.gap!.id).toBe(r1.gap!.id);
      expect(r2.gap!.count).toBe(2);
      expect(r2.gap!.sampleQueries).toHaveLength(2);
    }
    // 12 more verbatim variants (varying whitespace) of the SAME
    // normalized query → count rises, sampleQueries caps at 10.
    if (!r1.ok) throw new Error("gap1 failed");
    for (let i = 0; i < 12; i += 1) {
      await recordGap(store, {
        query: `How${" ".repeat(i + 1)}does escrow work?`,
        source: "MANUAL",
      });
    }
    const gaps = await listGaps(store, {});
    // Arc R1 H3: punctuation is normalized away — "?" variants dedupe too.
    const main = gaps.find(
      (g) => g.normalizedQuery === "how does escrow work",
    );
    expect(main).toBeDefined();
    expect(main!.sampleQueries.length).toBeLessThanOrEqual(10);
    expect(main!.count).toBe(14);
  });

  it("lifecycle: OPEN→TRIAGED→RESOLVED|WONTFIX only; linked item required", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "FAQ", slug: "gap-answer", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    // Arc R1 M7: RESOLVED requires a PUBLISHED linked item — walk the
    // item up (evidence → submit → verify-by-other → publish).
    const ev = await addEvidence(store, c.version.id, {
      type: "INTERNAL_DOC", uri: "internal://runbook/gap", addedBy: OP,
    });
    if (!ev.ok) throw new Error("evidence failed");
    const steps: Array<[string, string]> = [
      ["PENDING", OP], ["VERIFIED", "ops_review"], ["PUBLISHED", OP],
    ];
    for (const [to, actor] of steps) {
      await approveTransition(store, c.item.id, to, actor);
    }
    const g = await recordGap(store, { query: "gap x", source: "MANUAL" });
    if (!g.ok) throw new Error("gap failed");

    // Illegal jumps.
    expect((await resolveGap(store, g.gap!.id, c.item.id)).ok).toBe(false);
    expect((await wontfixGap(store, g.gap!.id)).ok).toBe(false);
    // Valid path.
    const t = await triageGap(store, g.gap!.id);
    expect(t.ok && t.gap.status).toBe("TRIAGED");
    // RESOLVED without item → reject; missing item → reject.
    expect((await resolveGap(store, g.gap!.id, "")).ok).toBe(false);
    expect((await resolveGap(store, g.gap!.id, "ki_none")).ok).toBe(false);
    const res = await resolveGap(store, g.gap!.id, c.item.id);
    expect(res.ok && res.gap.status).toBe("RESOLVED");
    expect(res.ok && res.gap.linkedItemId).toBe(c.item.id);
    // Terminal — no more transitions.
    expect((await triageGap(store, g.gap!.id)).ok).toBe(false);

    const g2 = await recordGap(store, { query: "gap y", source: "MANUAL" });
    if (!g2.ok) throw new Error("gap2 failed");
    await triageGap(store, g2.gap!.id);
    const w = await wontfixGap(store, g2.gap!.id);
    expect(w.ok && w.gap.status).toBe("WONTFIX");
  });

  it("emits knowledge.gap_detected only on first sighting", async () => {
    const store = createMemoryKnowledgeStores();
    const seen: string[] = [];
    setKnowledgeEventsGateForTests(() => true);
    const off = onKnowledgeEvent((e) => {
      if (e.kind === "knowledge.gap_detected") {
        seen.push(String(e.payload.gapId));
      }
    });
    try {
      await recordGap(store, { query: "fresh gap", source: "MANUAL" });
      await recordGap(store, { query: "fresh gap", source: "MANUAL" });
      await recordGap(store, { query: "FRESH   GAP", source: "MANUAL" });
      expect(seen).toHaveLength(1);
    } finally {
      off();
      setKnowledgeEventsGateForTests(null);
    }
  });

  it("recordInteractionGap — 228 seam works standalone", async () => {
    const store = createMemoryKnowledgeStores();
    const r = await recordInteractionGap(store, {
      requestId: "ireq_abc123",
      query: "what chains supported",
      intent: "question",
    });
    expect(r.ok && r.created).toBe(true);
    if (r.ok) {
      expect(r.gap!.source).toBe("INTERACTION_SIGNAL");
      expect(r.gap!.sourceRef).toBe("ireq_abc123");
      expect(r.gap!.intent).toBe("question");
    }
  });

  it("composer refusal flows through knowledgeGapRecorder", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", slug: "unrel", title: "unrelated", body: "x" },
      OP,
    );
    if (!c.ok) throw new Error("create failed");
    await addEvidence(store, c.version.id, {
      type: "INTERNAL_DOC", uri: "internal://runbook/unrel", addedBy: OP,
    });
    const steps2: Array<[string, string]> = [
      ["PENDING", OP], ["VERIFIED", "ops_review"], ["PUBLISHED", OP],
    ];
    for (const [to, actor] of steps2) {
      await approveTransition(store, c.item.id, to, actor);
    }
    const a = await composeAnswer(store, "totally missing topic", {
      gapRecorder: knowledgeGapRecorder(store),
    });
    expect(a.status).toBe("REFUSED");
    const gaps = await listGaps(store, {});
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.source).toBe("COMPOSER_REFUSAL");
    expect(gaps[0]?.normalizedQuery).toBe("totally missing topic");
  });
});
