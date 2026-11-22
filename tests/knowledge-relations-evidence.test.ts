import { describe, expect, it } from "vitest";

import {
  addEvidence,
  addRelation,
  createKnowledgeItem,
  itemsCiting,
  listEvidence,
  relationsFor,
  removeEvidence,
  removeRelation,
  supersededBy,
  updateKnowledgeDraft,
  createMemoryKnowledgeStores,
} from "../src/server/lib/knowledge";

/**
 * SLICE-229-6 DoD — typed edges + version-scoped evidence:
 * - dedup by compound unique, self-loop ban, SUPERSEDES-cycle ban
 * - RELATED_TO reads both directions
 * - evidence: cap 50, uri validation, itemsCiting reverse lookup
 * - relations are item-scope — re-versioning does not break them
 */

const OP = "ops_test";

async function mk(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
) {
  const r = await createKnowledgeItem(
    store,
    { kind: "GUIDE", slug, title: slug, body: `${slug} body` },
    OP,
  );
  if (!r.ok) throw new Error(`create ${slug} failed: ${r.error}`);
  return r.item;
}

describe("knowledge relations (SLICE-229-6)", () => {
  it("dedup: same triple twice → created:false, same row", async () => {
    const store = createMemoryKnowledgeStores();
    const [a, b] = [await mk(store, "rel-a"), await mk(store, "rel-b")];
    const r1 = await addRelation(store, {
      fromItemId: a.id, toItemId: b.id, type: "RELATED_TO", actorRef: OP,
    });
    const r2 = await addRelation(store, {
      fromItemId: a.id, toItemId: b.id, type: "RELATED_TO", actorRef: OP,
    });
    expect(r1.ok && r1.created).toBe(true);
    expect(r2.ok && !r2.created).toBe(true);
    if (r1.ok && r2.ok) expect(r2.relation.id).toBe(r1.relation.id);
  });

  it("self-loop + bad type + missing endpoint rejected", async () => {
    const store = createMemoryKnowledgeStores();
    const a = await mk(store, "loop-a");
    for (const bad of [
      { fromItemId: a.id, toItemId: a.id, type: "RELATED_TO" },
      { fromItemId: a.id, toItemId: "ki_missing", type: "RELATED_TO" },
      { fromItemId: a.id, toItemId: a.id, type: "BOGUS" },
    ]) {
      const r = await addRelation(store, { ...bad, actorRef: OP });
      expect(r.ok).toBe(false);
    }
  });

  it("SUPERSEDES cycle banned — A→B ok, then B→A rejected", async () => {
    const store = createMemoryKnowledgeStores();
    const [a, b] = [await mk(store, "sup-a"), await mk(store, "sup-b")];
    const fwd = await addRelation(store, {
      fromItemId: a.id, toItemId: b.id, type: "SUPERSEDES", actorRef: OP,
    });
    expect(fwd.ok).toBe(true);
    const back = await addRelation(store, {
      fromItemId: b.id, toItemId: a.id, type: "SUPERSEDES", actorRef: OP,
    });
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.error).toBe("supersedes_cycle");
    // supersededBy(b) → a; supersededBy(a) → null.
    expect((await supersededBy(store, b.id))?.id).toBe(a.id);
    expect(await supersededBy(store, a.id)).toBeNull();
  });

  it("RELATED_TO reads both directions; edges survive re-versioning", async () => {
    const store = createMemoryKnowledgeStores();
    const [a, b] = [await mk(store, "dir-a"), await mk(store, "dir-b")];
    await addRelation(store, {
      fromItemId: a.id, toItemId: b.id, type: "RELATED_TO", actorRef: OP,
    });
    const fromA = await relationsFor(store, a.id);
    const fromB = await relationsFor(store, b.id);
    expect(fromA.outgoing[0]?.item.id).toBe(b.id);
    expect(fromB.incoming[0]?.item.id).toBe(a.id);
    // Re-version A — edge still there (item-scope, not version-scope).
    const u = await updateKnowledgeDraft(
      store, a.id, { body: "v2 body" }, OP,
    );
    expect(u.ok).toBe(true);
    const afterA = await relationsFor(store, a.id);
    expect(afterA.outgoing[0]?.item.id).toBe(b.id);
    // removeRelation works.
    const relId = afterA.outgoing[0]?.relationId ?? "";
    const rm = await removeRelation(store, relId);
    expect(rm.ok && rm.removed).toBe(true);
    expect((await relationsFor(store, a.id)).outgoing).toHaveLength(0);
  });
});

describe("knowledge evidence (SLICE-229-6)", () => {
  it("uri validation + bad type + missing version", async () => {
    const store = createMemoryKnowledgeStores();
    const a = await mk(store, "ev-a");
    const vId = a.latestVersionId ?? "";
    for (const bad of [
      { type: "BOGUS", uri: "https://x.test" },
      { type: "EXTERNAL_URL", uri: "not a uri" },
      { type: "EXTERNAL_URL", uri: `/${"x".repeat(1001)}` },
      { type: "EXTERNAL_URL", uri: "ftp://nope" },
    ]) {
      const r = await addEvidence(store, vId, { ...bad, addedBy: OP });
      expect(r.ok).toBe(false);
    }
    const missing = await addEvidence(store, "kv_missing", {
      type: "EXTERNAL_URL", uri: "https://x.test", addedBy: OP,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("missing_version");
    // Valid shapes: https:// for EXTERNAL_URL; /path is internal
    // provenance — refused as an EXTERNAL_URL (Arc R1 M9).
    for (const [type, uri] of [
      ["EXTERNAL_URL", "https://docs.example/x"],
      ["INTERNAL_DOC", "/internal/spec.md"],
      ["INTERNAL_DOC", "internal://runbook/spec"],
    ] as const) {
      const r = await addEvidence(store, vId, { type, uri, addedBy: OP });
      expect(r.ok).toBe(true);
    }
    expect((await listEvidence(store, vId)).length).toBe(3);
  });

  it("cap 50 enforced; itemsCiting + removeEvidence work", async () => {
    const store = createMemoryKnowledgeStores();
    const a = await mk(store, "ev-cap");
    const vId = a.latestVersionId ?? "";
    for (let i = 0; i < 50; i += 1) {
      const r = await addEvidence(store, vId, {
        type: "API_ENDPOINT",
        uri: `https://api.example/e${i === 10 ? "/shared" : `/${i}`}`,
        addedBy: OP,
      });
      expect(r.ok).toBe(true);
    }
    const overflow = await addEvidence(store, vId, {
      type: "API_ENDPOINT", uri: "https://api.example/e51", addedBy: OP,
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error).toBe("evidence_cap");

    const citing = await itemsCiting(store, "https://api.example/e/shared");
    expect(citing).toHaveLength(1);
    const rm = await removeEvidence(store, citing[0]?.id ?? "");
    expect(rm.ok && rm.removed).toBe(true);
    expect(
      (await itemsCiting(store, "https://api.example/e/shared")).length,
    ).toBe(0);
  });
});
