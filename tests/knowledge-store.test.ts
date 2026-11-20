import { describe, expect, it } from "vitest";

import {
  createMemoryKnowledgeStores,
  pickKnowledgeStores,
  KNOWLEDGE_EVIDENCE_CAP,
  KNOWLEDGE_GAP_SAMPLES_CAP,
  type KnowledgeStore,
} from "../src/server/lib/knowledge";

/**
 * SLICE-229-1 contract test — the MemoryKnowledgeStore backend
 * exercises the same KnowledgeStore semantics the Postgres adapter
 * implements (packages/database/tests/knowledge-repository.test.ts
 * is the PG-side mirror): same-tx composites, append-only versions,
 * honest transition/refusal signals, search seam, gap upsert.
 *
 * D-143: DATABASE_ENABLED=off must serve through this fallback.
 */

let n = 0;
const id = (p: string) => `${p}_t_${++n}`;

async function mkItem(
  s: KnowledgeStore,
  slug: string,
  title = "t",
  body = "b",
) {
  const iid = id("ki");
  return s.createItemWithVersion(
    { id: iid, slug, kind: "GUIDE", createdBy: "ops" },
    { id: id("kv"), itemId: iid, seq: 1, title, body, createdBy: "ops" },
    { id: id("kse"), itemId: iid, from: null, to: "DRAFT", actor: "ops" },
  );
}

describe("MemoryKnowledgeStore (SLICE-229-1 contract)", () => {
  it("createItemWithVersion: item+version+create-event+pointer", async () => {
    const s = createMemoryKnowledgeStores();
    const { item, version } = await mkItem(s, "x402-states", "states", "b");
    expect(item.status).toBe("DRAFT");
    expect(item.latestVersionId).toBe(version.id);
    expect(item.publishedVersionId).toBeNull();
    expect(await s.getItemBySlug("x402-states")).not.toBeNull();
    const events = await s.listStatusEvents(item.id);
    expect(events).toHaveLength(1);
    expect(events[0].from).toBeNull();
  });

  it("addVersion is append-only + bumps latestVersionId", async () => {
    const s = createMemoryKnowledgeStores();
    const { item } = await mkItem(s, "v-test");
    const v2 = await s.addVersion({
      id: id("kv"), itemId: item.id, seq: 2, title: "t2", body: "b2",
      createdBy: "ops",
    });
    expect((await s.getItem(item.id))?.latestVersionId).toBe(v2.id);
    expect((await s.listVersions(item.id)).map((v) => v.seq)).toEqual([2, 1]);
    expect((await s.getVersionBySeq(item.id, 1))?.title).toBe("t");
    // (itemId, seq) dup → throw (append-only integrity).
    await expect(
      s.addVersion({
        id: id("kv"), itemId: item.id, seq: 2, title: "x", body: "x",
        createdBy: "ops",
      }),
    ).rejects.toThrow();
  });

  it("transitionItem: honest refusal writes nothing; publish pointer flips", async () => {
    const s = createMemoryKnowledgeStores();
    const { item } = await mkItem(s, "tx-test");
    const missing = await s.transitionItem(id("ghost"), {
      from: "DRAFT", to: "PENDING", actor: "ops",
    });
    expect(missing).toMatchObject({ transitioned: false, reason: "missing" });
    const refused = await s.transitionItem(item.id, {
      from: "PUBLISHED", to: "WITHDRAWN", actor: "ops",
    });
    expect(refused).toMatchObject({
      transitioned: false, reason: "status_mismatch",
    });
    expect((await s.listStatusEvents(item.id))).toHaveLength(1); // unchanged

    for (const [from, to] of [
      ["DRAFT", "PENDING"], ["PENDING", "VERIFIED"],
    ] as const) {
      const r = await s.transitionItem(item.id, { from, to, actor: "ops" });
      expect(r.transitioned).toBe(true);
    }
    const pub = await s.transitionItem(item.id, {
      from: "VERIFIED", to: "PUBLISHED", actor: "ops", publish: true,
    });
    expect(pub.transitioned).toBe(true);
    expect(pub.item?.publishedVersionId).toBe(item.latestVersionId);
    const w = await s.transitionItem(item.id, {
      from: "PUBLISHED", to: "WITHDRAWN", actor: "ops", unpublish: true,
    });
    expect(w.item?.publishedVersionId).toBeNull();
  });

  it("searchItems: published-only, same output shape as FTS", async () => {
    const s = createMemoryKnowledgeStores();
    const { item } = await mkItem(
      s, "escrow-guide", "Escrow settlement", "funds sit in escrow until release",
    );
    // DRAFT invisible to the seam even before status filter logic.
    expect(await s.searchItems({ query: "escrow" })).toHaveLength(0);
    await s.transitionItem(item.id, { from: "DRAFT", to: "PENDING", actor: "o" });
    await s.transitionItem(item.id, { from: "PENDING", to: "VERIFIED", actor: "o" });
    await s.transitionItem(item.id, {
      from: "VERIFIED", to: "PUBLISHED", actor: "o", publish: true,
    });
    const hits = await s.searchItems({ query: "escrow" });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      itemId: item.id, slug: "escrow-guide", kind: "GUIDE",
    });
    expect(hits[0].rank).toBeGreaterThan(0);
    expect(hits[0].snippet.length).toBeGreaterThan(0);
    // Agent reads hard-PUBLISHED: a WITHDRAWN item disappears again.
    await s.transitionItem(item.id, {
      from: "PUBLISHED", to: "WITHDRAWN", actor: "o", unpublish: true,
    });
    expect(await s.searchItems({ query: "escrow" })).toHaveLength(0);
  });

  it("capabilities: upsert idempotent, m:n dedupe, reverse lookup", async () => {
    const s = createMemoryKnowledgeStores();
    const up1 = await s.upsertCapability({
      id: id("kc"), name: "mcp.get_balance", kind: "MCP_TOOL",
      source: "SEEDED", verified: true,
    });
    expect(up1.created).toBe(true);
    const up2 = await s.upsertCapability({
      id: id("kc"), name: "mcp.get_balance", kind: "MCP_TOOL",
      source: "SEEDED", verified: true, description: "d",
    });
    expect(up2.created).toBe(false);
    expect(up2.row.id).toBe(up1.row.id);
    const { item } = await mkItem(s, "cap-item");
    expect((await s.linkCapability(item.id, up1.row.id)).created).toBe(true);
    expect((await s.linkCapability(item.id, up1.row.id)).created).toBe(false);
    expect(await s.itemsForCapability("mcp.get_balance")).toEqual([item.id]);
    expect(await s.capabilitiesForItem(item.id)).toHaveLength(1);
    expect((await s.unlinkCapability(item.id, up1.row.id)).removed).toBe(true);
  });

  it("relations: compound dedupe + both-direction read", async () => {
    const s = createMemoryKnowledgeStores();
    const { item: a } = await mkItem(s, "rel-a");
    const { item: b } = await mkItem(s, "rel-b");
    const r = await s.addRelation({
      id: id("kr"), fromItemId: a.id, toItemId: b.id,
      type: "RELATED_TO", createdBy: "ops",
    });
    expect(r.created).toBe(true);
    const dup = await s.addRelation({
      id: id("kr"), fromItemId: a.id, toItemId: b.id,
      type: "RELATED_TO", createdBy: "ops",
    });
    expect(dup.created).toBe(false);
    expect((await s.relationsFor(a.id)).outgoing).toHaveLength(1);
    expect((await s.relationsFor(b.id)).incoming).toHaveLength(1);
    expect((await s.removeRelation(r.row!.id)).removed).toBe(true);
  });

  it("evidence: cap + missing-version + reverse citation", async () => {
    const s = createMemoryKnowledgeStores();
    const { version } = await mkItem(s, "ev-item");
    const bad = await s.addEvidence({
      id: id("ke"), versionId: "nope", type: "EXTERNAL_URL",
      uri: "https://x", addedBy: "ops",
    });
    expect(bad).toEqual({ ok: false, reason: "missing_version" });
    for (let i = 0; i < KNOWLEDGE_EVIDENCE_CAP; i += 1) {
      await s.addEvidence({
        id: id("ke"), versionId: version.id, type: "EXTERNAL_URL",
        uri: `https://e/${i}`, addedBy: "ops",
      });
    }
    const over = await s.addEvidence({
      id: id("ke"), versionId: version.id, type: "EXTERNAL_URL",
      uri: "https://e/over", addedBy: "ops",
    });
    expect(over).toEqual({ ok: false, reason: "cap_exceeded" });
    const citing = await s.itemsCiting("https://e/3");
    expect(citing).toHaveLength(1);
  });

  it("recordGap: create then dedupe-bump; samples capped; CAS lifecycle", async () => {
    const s = createMemoryKnowledgeStores();
    const g1 = await s.recordGap({
      id: id("kg"), normalizedQuery: "how pay", sampleQuery: "How pay?",
      source: "COMPOSER_REFUSAL",
    });
    expect(g1.created).toBe(true);
    expect(g1.row.count).toBe(1);
    expect(g1.row.status).toBe("OPEN");
    for (let i = 0; i < KNOWLEDGE_GAP_SAMPLES_CAP + 2; i += 1) {
      await s.recordGap({
        id: id("kg"), normalizedQuery: "how pay", sampleQuery: `variant ${i}`,
        source: "INTERACTION_SIGNAL",
      });
    }
    const g = await s.getGap(g1.row.id);
    expect(g?.count).toBe(1 + KNOWLEDGE_GAP_SAMPLES_CAP + 2);
    expect(g?.sampleQueries.length).toBe(KNOWLEDGE_GAP_SAMPLES_CAP);
    const bad = await s.transitionGap(g1.row.id, {
      from: "RESOLVED", to: "OPEN",
    });
    expect(bad.transitioned).toBe(false);
    const ok = await s.transitionGap(g1.row.id, {
      from: "OPEN", to: "RESOLVED", linkedItemId: "ki_x",
    });
    expect(ok.transitioned).toBe(true);
    expect(ok.gap?.linkedItemId).toBe("ki_x");
  });

  it("pickKnowledgeStores: memory fallback is a process-wide singleton", () => {
    const a = pickKnowledgeStores({ knowledge: null });
    const b = pickKnowledgeStores({ knowledge: null });
    expect(a).toBe(b); // shared state — D-143
    expect(a.backend).toBe("memory");
  });
});
