import { afterEach, describe, expect, it } from "vitest";

import {
  createMemoryKnowledgeStores,
  createKnowledgeItem,
  updateKnowledgeDraft,
  restoreKnowledgeVersion,
  getKnowledgeVersion,
  isValidKnowledgeSlug,
  slugifyTitle,
  onKnowledgeEvent,
  setKnowledgeEventsGateForTests,
  type KnowledgeEvent,
} from "../src/server/lib/knowledge";

/**
 * SLICE-229-2 DoD — domain lib over the memory store: create →
 * update×2 → restore yields correct seq/pointers; old versions are
 * never mutated; events emit; publishedVersionId stays NULL (only
 * the workflow layer may set it).
 */

const OP = "ops_test";

function mkEnv() {
  const store = createMemoryKnowledgeStores();
  const events: KnowledgeEvent[] = [];
  const off = onKnowledgeEvent((e) => {
    events.push(e);
  });
  setKnowledgeEventsGateForTests(() => true);
  return {
    store,
    events,
    done() {
      off();
      setKnowledgeEventsGateForTests(null);
    },
  };
}

describe("knowledge items/versions lib (SLICE-229-2)", () => {
  it("create → item DRAFT + version seq=1 + emitted events", async () => {
    const env = mkEnv();
    try {
      const r = await createKnowledgeItem(
        env.store,
        {
          kind: "GUIDE",
          title: "x402 Settlement States",
          body: "How settlement works",
          summary: "s",
        },
        OP,
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.item.status).toBe("DRAFT");
      expect(r.item.slug).toBe("x402-settlement-states");
      expect(r.item.latestVersionId).toBe(r.version.id);
      expect(r.item.publishedVersionId).toBeNull();
      expect(r.version.seq).toBe(1);
      expect(r.version.restoredFromVersionId).toBeNull();
      // create status event persisted (from NULL → DRAFT).
      const evs = await env.store.listStatusEvents(r.item.id);
      expect(evs).toHaveLength(1);
      expect(evs[0].from).toBeNull();
      expect(env.events.map((e) => e.kind)).toEqual(["knowledge.created"]);
    } finally {
      env.done();
    }
  });

  it("explicit slug: validated, uniqueness enforced", async () => {
    const env = mkEnv();
    try {
      const bad = await createKnowledgeItem(
        env.store,
        { slug: "UPPER CASE!", kind: "FAQ", title: "t", body: "b" },
        OP,
      );
      expect(bad).toMatchObject({ ok: false, error: "invalid_slug" });
      const one = await createKnowledgeItem(
        env.store,
        { slug: "taken-slug", kind: "FAQ", title: "t", body: "b" },
        OP,
      );
      expect(one.ok).toBe(true);
      const dup = await createKnowledgeItem(
        env.store,
        { slug: "taken-slug", kind: "FAQ", title: "t", body: "b" },
        OP,
      );
      expect(dup).toMatchObject({ ok: false, error: "slug_taken" });
      // Derived slug collides → suffix.
      const two = await createKnowledgeItem(
        env.store,
        { kind: "FAQ", title: "taken slug", body: "b" },
        OP,
      );
      expect(two.ok && two.item.slug === "taken-slug-2").toBe(true);
    } finally {
      env.done();
    }
  });

  it("input limits: title>300 / body>64KB rejected honestly", async () => {
    const env = mkEnv();
    try {
      const t = await createKnowledgeItem(
        env.store,
        { kind: "FAQ", title: "x".repeat(301), body: "b" },
        OP,
      );
      expect(t).toMatchObject({ ok: false, field: "title" });
      const b = await createKnowledgeItem(
        env.store,
        { kind: "FAQ", title: "ok", body: "x".repeat(64 * 1024 + 1) },
        OP,
      );
      expect(b).toMatchObject({ ok: false, field: "body" });
    } finally {
      env.done();
    }
  });

  it("updateDraft appends seq+1, bumps latest, never mutates old versions", async () => {
    const env = mkEnv();
    try {
      const c = await createKnowledgeItem(
        env.store,
        { kind: "GUIDE", title: "v1 title", body: "v1 body" },
        OP,
      );
      if (!c.ok) throw new Error("create failed");
      const itemId = c.item.id;

      const u1 = await updateKnowledgeDraft(
        env.store, itemId, { title: "v2 title" }, OP,
      );
      expect(u1.ok && u1.version.seq).toBe(2);
      const u2 = await updateKnowledgeDraft(
        env.store, itemId, { body: "v3 body" }, OP,
      );
      expect(u2.ok && u2.version.seq).toBe(3);
      expect(u2.ok && u2.item.latestVersionId).toBe(
        u2.ok ? u2.version.id : "",
      );

      // Merge semantics: v3 kept v2's title, v1's nothing-changed body?
      // v3 body=v3 body, title=v2 title (inherited), summary=null.
      const v3 = await getKnowledgeVersion(env.store, itemId, 3);
      expect(v3?.title).toBe("v2 title");
      expect(v3?.body).toBe("v3 body");
      // Immutability: v1 untouched.
      const v1 = await getKnowledgeVersion(env.store, itemId, 1);
      expect(v1?.title).toBe("v1 title");
      expect(v1?.body).toBe("v1 body");
      // publishedVersionId STILL null — domain lib must never set it.
      expect(u2.ok && u2.item.publishedVersionId).toBeNull();
      expect(
        env.events.filter((e) => e.kind === "knowledge.version_created"),
      ).toHaveLength(2);
    } finally {
      env.done();
    }
  });

  it("updateDraft refuses non-DRAFT status + empty update", async () => {
    const env = mkEnv();
    try {
      const c = await createKnowledgeItem(
        env.store,
        { kind: "FAQ", title: "t", body: "b" },
        OP,
      );
      if (!c.ok) throw new Error("create failed");
      // Flip out of DRAFT directly via store (workflow owns this normally).
      await env.store.transitionItem(c.item.id, {
        from: "DRAFT", to: "PENDING", actor: OP,
      });
      const r = await updateKnowledgeDraft(
        env.store, c.item.id, { title: "x" }, OP,
      );
      expect(r).toMatchObject({ ok: false, error: "not_editable_in_status" });
      const empty = await updateKnowledgeDraft(env.store, c.item.id, {}, OP);
      expect(empty.ok).toBe(false);
      const ghost = await updateKnowledgeDraft(
        env.store, "ki_missing", { title: "x" }, OP,
      );
      expect(ghost).toMatchObject({ ok: false, error: "not_found" });
    } finally {
      env.done();
    }
  });

  it("restoreVersion: new copy with restoredFromVersionId, source untouched", async () => {
    const env = mkEnv();
    try {
      const c = await createKnowledgeItem(
        env.store,
        { kind: "GUIDE", title: "orig", body: "orig body", summary: "s1" },
        OP,
      );
      if (!c.ok) throw new Error("create failed");
      const itemId = c.item.id;
      await updateKnowledgeDraft(env.store, itemId, {
        title: "edited", body: "edited body",
      }, OP);

      const r = await restoreKnowledgeVersion(env.store, itemId, 1, OP);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.version.seq).toBe(3);
      expect(r.version.title).toBe("orig");
      expect(r.version.body).toBe("orig body");
      expect(r.version.summary).toBe("s1");
      expect(r.version.restoredFromVersionId).toBe(c.version.id);
      // Source v1 is immutable; latest pointer = restore copy.
      const v1 = await getKnowledgeVersion(env.store, itemId, 1);
      expect(v1?.title).toBe("orig");
      const reloaded = await env.store.getItem(itemId);
      expect(reloaded?.latestVersionId).toBe(r.version.id);
      // Bogus seq → honest not_found.
      const bad = await restoreKnowledgeVersion(env.store, itemId, 99, OP);
      expect(bad).toMatchObject({ ok: false, error: "version_not_found" });
    } finally {
      env.done();
    }
  });

  it("slug helpers", () => {
    expect(isValidKnowledgeSlug("abc")).toBe(true);
    expect(isValidKnowledgeSlug("a-b-c")).toBe(true);
    expect(isValidKnowledgeSlug("-abc")).toBe(false);
    expect(isValidKnowledgeSlug("ab")).toBe(false);
    expect(isValidKnowledgeSlug("A-b-c")).toBe(false);
    expect(slugifyTitle("How do I pay?")).toBe("how-do-i-pay");
    expect(slugifyTitle("!!!")).toBeNull();
    expect(slugifyTitle("ab")).toBeNull(); // <3 chars after clean
  });

  afterEach(() => {
    setKnowledgeEventsGateForTests(null);
  });
});
