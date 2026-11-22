import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  addRelation,
  composeAnswer,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  listEvidence,
  removeEvidence,
  resolveGap,
  recordGap,
  searchKnowledgeItems,
  transitionKnowledgeItem,
  upsertKnowledgeCapability,
  type KnowledgeGapRecorder,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import { createAdminKnowledgeUi } from "../src/server/routes/admin-knowledge-ui";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";

/**
 * Arc Studio R1 regression pack — one test per finding class so a
 * refactor can't silently reopen them:
 * - H1: idempotency key binds the request body (mismatch → 409)
 * - H2: operator-ref strictness (bypass shapes) + separation of duties
 * - H3: gap writes are honest (bounded backlog, honest refusal hint)
 * - H4: evidence immutable off the review lane + verify needs evidence
 * - H5: addVersion asserts status under the lock
 * - M1: multi-hop SUPERSEDES cycles refused
 * - M3: MANUAL upsert cannot downgrade a SEEDED capability
 * - M5/M6: deterministic ordering + unicode tokenizer
 * - M8: control chars in path params → 400, never 500
 * - M9: protocol-relative/backslash URIs refused
 * - M10: SSR double-submit dedupes
 */

const ADMIN = { authorization: "Bearer test-admin-key" };
const OP = "ops_test";
const OP2 = "ops_review";
let idem = 0;
const writeHeaders = (op = OP) => ({
  ...ADMIN,
  "x-operator-id": op,
  "content-type": "application/json",
  "idempotency-key": `arc-${Date.now()}-${++idem}`,
});

function mkApp() {
  process.env.ADMIN_API_KEY = "test-admin-key";
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const app = new Hono();
  app.route("/", createAdminKnowledgeRoutes({ store }));
  return { app, store };
}

async function publishItem(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
  title = slug,
  body = `${slug} body`,
) {
  const c = await createKnowledgeItem(
    store,
    { kind: "GUIDE", slug, title, body },
    OP,
  );
  if (!c.ok) throw new Error(`create ${slug}: ${c.error}`);
  const ev = await addEvidence(store, c.version.id, {
    type: "INTERNAL_DOC",
    uri: `internal://runbook/${slug}`,
    addedBy: OP,
  });
  if (!ev.ok) throw new Error(`evidence ${slug}: ${ev.error}`);
  for (const [to, actor] of [
    ["PENDING", OP],
    ["VERIFIED", OP2],
    ["PUBLISHED", OP],
  ] as const) {
    const r = await transitionKnowledgeItem(store, c.item.id, to, actor);
    if (!r.ok) throw new Error(`transition ${to}: ${r.error}`);
  }
  return c;
}

describe("Arc R1 — H1 idempotency payload binding", () => {
  it("same key + different body → 409; same body → replay", async () => {
    const { app, store } = mkApp();
    const c0 = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "idem", body: "b" }, OP,
    );
    if (!c0.ok) throw new Error("create failed");
    const item = c0.item;
    const key = `arc-bind-${Date.now()}`;
    const mk = (to: string) =>
      app.request(`/admin/api/knowledge/items/${item.id}/transition`, {
        method: "POST",
        headers: { ...writeHeaders(), "idempotency-key": key },
        body: JSON.stringify({ to }),
      });
    const first = await mk("PENDING");
    expect(first.status).toBe(200);
    // Replayed key with a DIFFERENT body must not silently return the
    // first result — the withdrawal would have been swallowed before.
    const swapped = await mk("WITHDRAWN");
    expect(swapped.status).toBe(409);
    // Same key + same body → honest replay.
    const replay = await mk("PENDING");
    expect(replay.status).toBe(200);
    expect((await replay.json()).duplicate).toBe(true);
    // State is exactly what the first write produced.
    expect((await store.getItem(item.id))?.status).toBe("PENDING");
  });
});

describe("Arc R1 — H2 operator identity", () => {
  it("bypass shapes → 400 at the route edge", async () => {
    const { app, store } = mkApp();
    const c0 = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "op", body: "b" }, OP,
    );
    if (!c0.ok) throw new Error("create failed");
    const item = c0.item;
    // Zero-width/fullwidth refs can't travel inside an HTTP header
    // (>255 bytes) — the NFKC+shape checks cover them at the lib
    // layer (see the §16.5 workflow test).
    for (const bad of [
      "agent-7",
      "agt-1",
      "did:hedera:testnet:0.0.1",
      "key:abc",
      "bot:x",
      "x".repeat(81),
    ]) {
      const r = await app.request(
        `/admin/api/knowledge/items/${item.id}/transition`,
        {
          method: "POST",
          headers: { ...writeHeaders(bad) },
          body: JSON.stringify({ to: "PENDING" }),
        },
      );
      expect(r.status).toBe(400);
    }
  });

  it("separation of duties: submitter cannot verify own item", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "sod", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    await addEvidence(store, c.version.id, {
      type: "INTERNAL_DOC", uri: "internal://x", addedBy: OP,
    });
    await transitionKnowledgeItem(store, c.item.id, "PENDING", OP);
    const self = await transitionKnowledgeItem(store, c.item.id, "VERIFIED", OP);
    expect(self).toMatchObject({ ok: false, error: "SEPARATION_OF_DUTIES" });
    const other = await transitionKnowledgeItem(
      store, c.item.id, "VERIFIED", OP2,
    );
    expect(other.ok).toBe(true);
    // Verifier cannot publish — submitter may.
    const vp = await transitionKnowledgeItem(
      store, c.item.id, "PUBLISHED", OP2,
    );
    expect(vp).toMatchObject({ ok: false, error: "SEPARATION_OF_DUTIES" });
    const sp = await transitionKnowledgeItem(
      store, c.item.id, "PUBLISHED", OP,
    );
    expect(sp.ok).toBe(true);
  });
});

describe("Arc R1 — H4 evidence immutability + verify gate", () => {
  it("VERIFIED requires ≥1 evidence", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "noev", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    await transitionKnowledgeItem(store, c.item.id, "PENDING", OP);
    const r = await transitionKnowledgeItem(store, c.item.id, "VERIFIED", OP2);
    expect(r).toMatchObject({ ok: false, error: "evidence_required" });
  });

  it("evidence add/remove refused on PUBLISHED; internal uri redacted", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await publishItem(store, "ev-lock");
    const vid = c.item.publishedVersionId ?? "";
    const add = await addEvidence(store, vid, {
      type: "EXTERNAL_URL", uri: "https://x.test", addedBy: OP,
    });
    expect(add.ok).toBe(false);
    if (!add.ok) expect(add.error).toBe("not_editable_in_status");
    const existing = await listEvidence(store, vid);
    const rm = await removeEvidence(store, existing[0]?.id ?? "");
    expect(rm).toMatchObject({ ok: false, error: "not_editable_in_status" });
    const answer = await composeAnswer(store, "ev-lock");
    const internal = answer.sources
      .flatMap((s) => s.evidence)
      .find((e) => e.type === "INTERNAL_DOC");
    expect(internal?.uri).toBeNull();
  });
});

describe("Arc R1 — H3 honest gap refusal", () => {
  it("hint claims 'recorded' only when the write landed", async () => {
    const store = createMemoryKnowledgeStores();
    const fail: KnowledgeGapRecorder = {
      recordGap: async () => false,
    };
    const a = await composeAnswer(store, "unanswerable thing", {
      gapRecorder: fail,
    });
    expect(a.status).toBe("REFUSED");
    expect(a.hint).not.toContain("gap was recorded");
    const b = await composeAnswer(store, "unanswerable thing", {
      gapRecorder: {
        recordGap: async () => {
          throw new Error("store down");
        },
      },
    });
    expect(b.hint).not.toContain("gap was recorded");
    const ok = await composeAnswer(store, "unanswerable thing", {
      gapRecorder: {
        recordGap: async () => true,
      },
    });
    expect(ok.hint).toContain("gap was recorded");
  });
});

describe("Arc R1 — M1/M3 taxonomy guards", () => {
  it("multi-hop SUPERSEDES cycle refused", async () => {
    const store = createMemoryKnowledgeStores();
    const a = await publishItem(store, "chain-a");
    const b = await publishItem(store, "chain-b");
    const c = await publishItem(store, "chain-c");
    await addRelation(store, {
      fromItemId: a.item.id, toItemId: b.item.id,
      type: "SUPERSEDES", actorRef: OP,
    });
    await addRelation(store, {
      fromItemId: b.item.id, toItemId: c.item.id,
      type: "SUPERSEDES", actorRef: OP,
    });
    // C→A would close a 3-cycle — the old 2-hop check missed this.
    const r = await addRelation(store, {
      fromItemId: c.item.id, toItemId: a.item.id,
      type: "SUPERSEDES", actorRef: OP,
    });
    expect(r).toMatchObject({ ok: false, error: "supersedes_cycle" });
  });

  it("MANUAL upsert cannot downgrade a SEEDED capability", async () => {
    const store = createMemoryKnowledgeStores();
    await upsertKnowledgeCapability(store, {
      name: "x402-escrow", kind: "X402_PACK",
      description: "seeded desc", source: "SEEDED",
    });
    const r = await upsertKnowledgeCapability(store, {
      name: "x402-escrow", kind: "MCP_TOOL",
      description: "manual overwrite", source: "MANUAL",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.created).toBe(false);
      expect(r.capability.kind).toBe("X402_PACK");
      expect(r.capability.verified).toBe(true);
      expect(r.capability.source).toBe("SEEDED");
    }
    // A SEEDED refresh still updates code-derived fields.
    const seed2 = await upsertKnowledgeCapability(store, {
      name: "x402-escrow", kind: "X402_PACK",
      description: "new seed", source: "SEEDED",
    });
    expect(seed2.ok && seed2.capability.description).toBe("new seed");
  });
});

describe("Arc R1 — M5/M6 determinism + unicode", () => {
  it("search order is deterministic (rank desc, slug asc)", async () => {
    const store = createMemoryKnowledgeStores();
    // Same rank-bearing terms in both titles → ties break by slug.
    await publishItem(store, "zzz-same", "escrow same", "escrow body a");
    await publishItem(store, "aaa-same", "escrow same", "escrow body b");
    const r1 = await searchKnowledgeItems(store, "escrow same", {});
    const r2 = await searchKnowledgeItems(store, "escrow same", {});
    expect(r1.items.map((i) => i.slug)).toEqual(
      r2.items.map((i) => i.slug),
    );
    expect(r1.items[0]?.slug).toBe("aaa-same");
  });

  it("unicode query terms are tokenized, not dropped", async () => {
    const store = createMemoryKnowledgeStores();
    await publishItem(
      store, "jp-pay", "支払い settlement", "支払い は x402 で settle",
    );
    const a = await composeAnswer(store, "支払い settlement");
    // Pre-fix the tokenizer returned [] → confidence 0 → REFUSED.
    expect(a.status).toBe("ANSWERED");
    expect(a.confidence).toBeGreaterThan(0);
  });
});

describe("Arc R1 — M8/M9 input edges", () => {
  it("percent-encoded control chars in :id → 400, never 500", async () => {
    const { app } = mkApp();
    const r = await app.request(
      "/admin/api/knowledge/items/ki_%0A/transition",
      {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({ to: "PENDING" }),
      },
    );
    expect(r.status).toBe(400);
    const g = await app.request("/admin/api/knowledge/items/ki_%00", {
      headers: ADMIN,
    });
    expect(g.status).toBe(400);
  });

  it("protocol-relative + backslash URIs refused", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "u", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    for (const uri of ["//evil.test/x", "/\\evil", "javascript:alert(1)"]) {
      const r = await addEvidence(store, c.version.id, {
        type: "INTERNAL_DOC", uri, addedBy: OP,
      });
      expect(r).toMatchObject({ ok: false, error: "invalid_uri" });
    }
  });
});

describe("Arc R2 — single-use form tokens + resolve published-only", () => {
  it("token double-submit refused: one minted token, one transition", async () => {
    process.env.ADMIN_API_KEY = "test-admin-key";
    resetIdempotencyStore();
    const store = createMemoryKnowledgeStores();
    const app = new Hono();
    app.route("/", createAdminKnowledgeUi(store));
    const AUTH = `Basic ${Buffer.from("x:test-admin-key").toString("base64")}`;
    const get = (path: string) =>
      app.request(path, { headers: { authorization: AUTH } });
    const post = (path: string, body: Record<string, string>) =>
      app.request(path, {
        method: "POST",
        headers: {
          authorization: AUTH,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body).toString(),
      });
    const c = await createKnowledgeItem(
      store, { kind: "GUIDE", title: "ssr", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");

    // No token → refused outright (was silently executed pre-R2).
    const noTok = await post(`/admin/knowledge/${c.item.id}/transition`, {
      to: "PENDING", operator: "ui-op",
    });
    expect(noTok.status).toBe(303);
    expect(noTok.headers.get("location")).toContain("err=");
    expect((await store.getItem(c.item.id))?.status).toBe("DRAFT");

    // Mint via render; the token POST applies exactly once.
    const page = await (
      await get(`/admin/knowledge/${c.item.id}`)
    ).text();
    const token = /name="formToken" value="([^"]+)"/.exec(page)?.[1];
    expect(token).toBeTruthy();
    const form = { to: "PENDING", operator: "ui-op", formToken: token! };
    const first = await post(
      `/admin/knowledge/${c.item.id}/transition`, form,
    );
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).not.toContain("err=");

    // The spent token (F5/back-button/double-click) is refused —
    // not deduped to a phantom success.
    const replay = await post(
      `/admin/knowledge/${c.item.id}/transition`, form,
    );
    expect(replay.headers.get("location")).toContain("err=");

    const item = await store.getItem(c.item.id);
    expect(item?.status).toBe("PENDING");
    const events = await store.listStatusEvents(c.item.id);
    expect(events.filter((e) => e.to === "PENDING")).toHaveLength(1);
  });

  it("resolveGap refuses a non-PUBLISHED linked item", async () => {
    const store = createMemoryKnowledgeStores();
    const c = await createKnowledgeItem(
      store, { kind: "FAQ", title: "draft", body: "b" }, OP,
    );
    if (!c.ok) throw new Error("create failed");
    const g = await recordGap(store, { query: "gq", source: "MANUAL" });
    if (!g.ok) throw new Error("gap failed");
    // Triage first (OPEN→TRIAGED), then resolve → draft item refused.
    const { triageGap } = await import("../src/server/lib/knowledge");
    await triageGap(store, g.gap!.id, OP);
    const r = await resolveGap(store, g.gap!.id, c.item.id, OP);
    expect(r).toMatchObject({ ok: false, error: "linked_item_not_published" });
  });
});
