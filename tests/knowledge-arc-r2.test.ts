import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  addRelation,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  evidenceFingerprint,
  listEvidence,
  recordGap,
  transitionKnowledgeItem,
  updateKnowledgeDraft,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeUi } from "../src/server/routes/admin-knowledge-ui";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import { approveTransition } from "./helpers/knowledge";

/**
 * Arc Studio R2 regression pack — one test per finding class:
 * - H-1: SSR mutations require a render-minted single-use token;
 *        spent/missing tokens refuse honestly (no 24h failure cache).
 * - H-2: approval gates evaluate under the row lock — evidence freezes
 *        at PENDING, expectedVersionId refuses stale-page approvals,
 *        SoD reads the latest prior actor.
 * - M-1: WONTFIX is final (recorded:false), RESOLVED reopens.
 * - M-7: SUPERSEDES cycles refuse at the store, incl. the decoy shape.
 * - M-8: expectedSeq lost-update precondition on updateDraft.
 */

const OP = "ops_test";
const OP2 = "ops_review";
const KEY = "test-admin-key";
const AUTH = `Basic ${Buffer.from(`x:${KEY}`).toString("base64")}`;

function mkUi(store: ReturnType<typeof createMemoryKnowledgeStores>) {
  process.env.ADMIN_API_KEY = KEY;
  resetIdempotencyStore();
  const app = new Hono();
  app.route("/", createAdminKnowledgeUi(store));
  return app;
}
const get = (app: Hono, p: string) =>
  app.request(p, { headers: { authorization: AUTH } });
const post = (app: Hono, p: string, b: Record<string, string>) =>
  app.request(p, {
    method: "POST",
    headers: {
      authorization: AUTH,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(b).toString(),
  });
const token = async (app: Hono, page: string) =>
  /name="formToken" value="([^"]+)"/.exec(await (await get(app, page)).text())
    ?.[1];

describe("Arc R2 — H-1 single-use form tokens", () => {
  it("missing token refuses; forged token refuses; minted works once", async () => {
    const store = createMemoryKnowledgeStores();
    const app = mkUi(store);
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const id = c.item.id;
    const path = `/admin/knowledge/${id}/transition`;

    // No token at all → refused, item untouched.
    const noTok = await post(app, path, { to: "PENDING", operator: "op" });
    expect(noTok.headers.get("location")).toContain("err=");
    // Forged token shape → same refusal.
    const forged = await post(app, path, {
      to: "PENDING", operator: "op", formToken: "ft_forged",
    });
    expect(forged.headers.get("location")).toContain("err=");
    expect((await store.getItem(id))?.status).toBe("DRAFT");

    const t = await token(app, `/admin/knowledge/${id}`);
    expect(t).toBeTruthy();
    const ok1 = await post(app, path, {
      to: "PENDING", operator: "op", formToken: t!,
    });
    expect(ok1.headers.get("location")).not.toContain("err=");
    // Spend-replay: same token, same body → refused (no silent dedupe).
    const replay = await post(app, path, {
      to: "PENDING", operator: "op", formToken: t!,
    });
    expect(replay.headers.get("location")).toContain("err=");
    const events = await store.listStatusEvents(id);
    expect(events.filter((e) => e.to === "PENDING")).toHaveLength(1);
  });
});

describe("Arc R2 — H-2 gates under the lock", () => {
  it("evidence refuses once PENDING (freeze at submit)", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    // DRAFT: editable.
    const ok = await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://e.com/x", addedBy: OP,
    });
    expect(ok.ok).toBe(true);
    await approveTransition(store, c.item.id, "PENDING", OP);
    // PENDING: frozen — the verifier's set is final.
    const frozen = await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://e.com/y", addedBy: OP,
    });
    expect(frozen.ok).toBe(false);
    expect(await listEvidence(store, c.version.id)).toHaveLength(1);
  });

  it("expectedVersionId refuses a stale-page approval", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const staleVersionId = c.version.id;
    await addEvidence(store, c.version.id, {
      type: "EXTERNAL_URL", uri: "https://e.com/x", addedBy: OP,
    });
    // Edit while still DRAFT → latest version moved (evidence copied).
    const up = await updateKnowledgeDraft(
      store, c.item.id, { title: "t2" }, OP,
    );
    expect(up.ok).toBe(true);
    await approveTransition(store, c.item.id, "PENDING", OP);
    // Reviewer opened the page at seq=1 — the precondition must refuse.
    const cur0 = await store.getItem(c.item.id);
    const fp0 = evidenceFingerprint(
      await listEvidence(store, cur0!.latestVersionId!),
    );
    const stale = await transitionKnowledgeItem(
      store, c.item.id, "VERIFIED", OP2, null,
      { expectedVersionId: staleVersionId, expectedEvidence: fp0 },
    );
    expect(stale).toMatchObject({ ok: false, error: "stale_version" });
    expect((await store.getItem(c.item.id))?.status).toBe("PENDING");
    // Same call with the CURRENT version succeeds.
    const cur = await store.getItem(c.item.id);
    const fresh = await transitionKnowledgeItem(
      store, c.item.id, "VERIFIED", OP2, null,
      { expectedVersionId: cur!.latestVersionId!, expectedEvidence: fp0 },
    );
    expect(fresh.ok).toBe(true);
  });
});

describe("Arc R2 — M-1 gap semantics", () => {
  it("WONTFIX is final; RESOLVED dedupe reopens honestly", async () => {
    const store = createMemoryKnowledgeStores();
    const { triageGap, wontfixGap, resolveGap } = await import(
      "../src/server/lib/knowledge"
    );
    // WONTFIX final: a repeat sighting does NOT resurrect it.
    const g1 = await recordGap(store, { query: "wontfix q", source: "MANUAL" });
    if (!g1.ok) throw new Error("gap1");
    await triageGap(store, g1.gap!.id, OP);
    await wontfixGap(store, g1.gap!.id, OP);
    const again = await recordGap(store, { query: "wontfix q", source: "MANUAL" });
    if (!again.ok) throw new Error("again");
    expect(again.recorded).toBe(false);
    expect((await store.getGap(g1.gap!.id))?.status).toBe("WONTFIX");

    // RESOLVED + repeat sighting → back to OPEN (reopened).
    const g2 = await recordGap(store, { query: "res q", source: "MANUAL" });
    if (!g2.ok) throw new Error("gap2");
    await triageGap(store, g2.gap!.id, OP);
    const pub = await createKnowledgeItem(
      store, { kind: "FAQ", title: "x", body: "b" }, OP,
    );
    if (!pub.ok) throw new Error("pub");
    await addEvidence(store, pub.version.id, {
      type: "EXTERNAL_URL", uri: "https://e.com/x", addedBy: OP,
    });
    for (const [to, actor] of [
      ["PENDING", OP], ["VERIFIED", OP2], ["PUBLISHED", OP],
    ] as const) {
      await approveTransition(store, pub.item.id, to, actor);
    }
    await resolveGap(store, g2.gap!.id, pub.item.id, OP);
    const re = await recordGap(store, { query: "res q", source: "MANUAL" });
    if (!re.ok) throw new Error("re");
    expect(re.recorded).toBe(true);
    expect((await store.getGap(g2.gap!.id))?.status).toBe("OPEN");
  });
});

describe("Arc R2 — M-7/M-8 store-level guards", () => {
  it("SUPERSEDES cycles refuse incl. multi-hop decoy shapes", async () => {
    const store = createMemoryKnowledgeStores();
    const mk = async (slug: string) => {
      const c = await createKnowledgeItem(
        store, { kind: "GUIDE", slug, title: slug, body: "b" }, OP,
      );
      if (!c.ok) throw new Error("mk");
      return c.item.id;
    };
    const a = await mk("cyc-a");
    const b = await mk("cyc-b");
    const d = await mk("cyc-decoy");
    // a→b and a→decoy (decoy is NOT on the a→b path).
    expect((await addRelation(store, {
      fromItemId: a, toItemId: b,
      type: "SUPERSEDES", actorRef: OP,
    })).ok).toBe(true);
    expect((await addRelation(store, {
      fromItemId: a, toItemId: d,
      type: "SUPERSEDES", actorRef: OP,
    })).ok).toBe(true);
    // b→a closes a real cycle — the store must refuse even though a
    // naive "visited" DFS could stop at the decoy edge instead.
    const cyc = await addRelation(store, {
      fromItemId: b, toItemId: a,
      type: "SUPERSEDES", actorRef: OP,
    });
    expect(cyc).toMatchObject({ ok: false, error: "supersedes_cycle" });
    // Non-SUPERSEDES edges are unaffected by the cycle guard.
    expect((await addRelation(store, {
      fromItemId: b, toItemId: a,
      type: "RELATED_TO", actorRef: OP,
    })).ok).toBe(true);
  });

  it("expectedSeq refuses a lost-update edit", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "t", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const e1 = await updateKnowledgeDraft(
      store, c.item.id, { title: "e1" }, OP,
    );
    expect(e1.ok).toBe(true);
    // A second editor holding seq=1 loses the race honestly.
    const e2 = await updateKnowledgeDraft(
      store, c.item.id, { body: "e2", expectedSeq: 1 }, OP,
    );
    expect(e2).toMatchObject({ ok: false, error: "stale_seq" });
    // Evidence on the CURRENT latest (v2) — then an edit copies it
    // forward under the lock.
    const mid = await store.getItem(c.item.id);
    const ev = await addEvidence(store, mid!.latestVersionId!, {
      type: "EXTERNAL_URL", uri: "https://e.com/x", addedBy: OP,
    });
    expect(ev.ok).toBe(true);
    const e3 = await updateKnowledgeDraft(
      store, c.item.id,
      { title: "e3", expectedSeq: 2 }, OP,
    );
    expect(e3.ok).toBe(true);
    const latest = await store.getItem(c.item.id);
    expect(await listEvidence(store, latest!.latestVersionId!))
      .toHaveLength(1);
  });
});
