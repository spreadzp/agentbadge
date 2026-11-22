import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  createMemoryKnowledgeStores,
  evidenceFingerprint,
  createKnowledgeItem,
  isOperatorActor,
  onKnowledgeEvent,
  setKnowledgeEventsGateForTests,
  type KnowledgeEvent,
  type KnowledgeStatus,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import { approveTransition } from "./helpers/knowledge";

/**
 * SLICE-229-3 DoD — approval machine: every legal transition walks,
 * every illegal pair is refused honestly (INVALID_TRANSITION, nothing
 * written), publish/withdraw pin+clear publishedVersionId, status
 * events land with the mutation, agent actors can't verify/publish.
 * Route level: idempotency-key required (400), invalid → 409.
 */

const OP = "ops_test";
// Arc R1: verifier must differ from submitter (separation of duties);
// publisher must differ from verifier — submitter MAY publish.
const OP2 = "ops_review";

async function mkItem(store: ReturnType<typeof createMemoryKnowledgeStores>) {
  const r = await createKnowledgeItem(
    store,
    { kind: "GUIDE", title: "wf item", body: "b" },
    OP,
  );
  if (!r.ok) throw new Error("create failed");
  return r.item;
}

/** Arc R1 H4: VERIFIED now requires ≥1 evidence on the version. */
async function mkItemWithEvidence(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
) {
  const r = await createKnowledgeItem(
    store,
    { kind: "GUIDE", title: "wf item", body: "b" },
    OP,
  );
  if (!r.ok) throw new Error("create failed");
  const ev = await addEvidence(store, r.version.id, {
    type: "INTERNAL_DOC",
    uri: "internal://runbook/wf",
    addedBy: OP,
  });
  if (!ev.ok) throw new Error(`evidence: ${ev.error}`);
  return r.item;
}

describe("knowledge workflow (SLICE-229-3)", () => {
  it("happy path DRAFT→PENDING→VERIFIED→PUBLISHED pins publishedVersionId", async () => {
    const store = createMemoryKnowledgeStores();
    const events: KnowledgeEvent[] = [];
    const off = onKnowledgeEvent((e) => {
      events.push(e);
    });
    setKnowledgeEventsGateForTests(() => true);
    try {
      const item = await mkItemWithEvidence(store);
      const steps: Array<[KnowledgeStatus, string, string]> = [
        ["PENDING", "knowledge.submitted", OP],
        ["VERIFIED", "knowledge.verified", OP2],
        ["PUBLISHED", "knowledge.published", OP],
      ];
      for (const [to, kind, actor] of steps) {
        const r = await approveTransition(store, item.id, to, actor);
        expect(r.ok).toBe(true);
        expect(events.at(-1)?.kind).toBe(kind);
      }
      const final = await store.getItem(item.id);
      expect(final?.status).toBe("PUBLISHED");
      expect(final?.publishedVersionId).toBe(final?.latestVersionId);
      // Audit: create + 3 transitions, in order.
      const audit = await store.listStatusEvents(item.id);
      expect(audit.map((e) => e.to)).toEqual([
        "DRAFT", "PENDING", "VERIFIED", "PUBLISHED",
      ]);
      // Separation of duties shows up in the audit trail.
      expect(audit.map((e) => e.actor)).toEqual([OP, OP, OP2, OP]);
    } finally {
      off();
      setKnowledgeEventsGateForTests(null);
    }
  });

  it("PENDING→DRAFT reject emits knowledge.rejected; reason persisted", async () => {
    const store = createMemoryKnowledgeStores();
    const item = await mkItem(store);
    await approveTransition(store, item.id, "PENDING", OP);
    const r = await approveTransition(
      store, item.id, "DRAFT", OP, "needs sources",
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.event.reason).toBe("needs sources");
    const audit = await store.listStatusEvents(item.id);
    expect(audit.at(-1)?.to).toBe("DRAFT");
    expect(audit.at(-1)?.from).toBe("PENDING");
  });

  it("illegal transitions refuse + write NOTHING (audit untouched)", async () => {
    const store = createMemoryKnowledgeStores();
    const item = await mkItem(store);
    const bad: KnowledgeStatus[] = ["VERIFIED", "PUBLISHED", "DRAFT" as never];
    for (const to of bad.slice(0, 2)) {
      const r = await approveTransition(store, item.id, to, OP);
      expect(r).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    }
    // DRAFT→WITHDRAWN is legal (discard) — verify it from each state.
    const auditBefore = await store.listStatusEvents(item.id);
    expect(auditBefore).toHaveLength(1); // only the create event
    const pending = await approveTransition(store, item.id, "PENDING", OP);
    expect(pending.ok).toBe(true);
    for (const to of ["PUBLISHED", "PENDING"] as const) {
      const r = await approveTransition(store, item.id, to, OP);
      expect(r).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    }
    // VERIFIED→PENDING (skip backwards) refused.
    await approveTransition(store, item.id, "VERIFIED", OP2);
    const back = await approveTransition(store, item.id, "PENDING", OP);
    expect(back).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    // WITHDRAWN is terminal — nothing escapes.
    await approveTransition(store, item.id, "PUBLISHED", OP);
    await approveTransition(store, item.id, "WITHDRAWN", OP);
    const dead = await approveTransition(store, item.id, "DRAFT", OP);
    expect(dead).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
  });

  it("WITHDRAWN clears publishedVersionId", async () => {
    const store = createMemoryKnowledgeStores();
    const item = await mkItemWithEvidence(store);
    await approveTransition(store, item.id, "PENDING", OP);
    await approveTransition(store, item.id, "VERIFIED", OP2);
    await approveTransition(store, item.id, "PUBLISHED", OP);
    expect((await store.getItem(item.id))?.publishedVersionId).not.toBeNull();
    const w = await approveTransition(store, item.id, "WITHDRAWN", OP);
    expect(w.ok).toBe(true);
    expect(w.ok && w.item.publishedVersionId).toBeNull();
    expect(w.ok && w.item.status).toBe("WITHDRAWN");
  });

  it("§16.5: agent actors cannot verify or publish", async () => {
    const store = createMemoryKnowledgeStores();
    const item = await mkItemWithEvidence(store);
    await approveTransition(store, item.id, "PENDING", OP);
    for (const agent of ["did:hedera:testnet:0.0.1", "agt_abc", "agent:x"]) {
      expect(isOperatorActor(agent)).toBe(false);
      const v = await approveTransition(store, item.id, "VERIFIED", agent);
      expect(v).toMatchObject({ ok: false, error: "ACTOR_NOT_OPERATOR" });
    }
    // Arc R1 H2: the bypass shapes the old prefix-only list missed.
    // Fullwidth agent refs NFKC-collapse to ASCII then hit the deny.
    for (const bypass of ["agent-7", "agt-1", "\u200bops", "ｄｉｄ:foo"]) {
      expect(isOperatorActor(bypass)).toBe(false);
      const v = await approveTransition(store, item.id, "VERIFIED", bypass);
      expect(v).toMatchObject({ ok: false, error: "ACTOR_NOT_OPERATOR" });
    }
    await approveTransition(store, item.id, "VERIFIED", OP2);
    const p = await approveTransition(
      store, item.id, "PUBLISHED", "did:hedera:testnet:0.0.9",
    );
    expect(p).toMatchObject({ ok: false, error: "ACTOR_NOT_OPERATOR" });
    // Item state untouched by refused attempts.
    const audit = await store.listStatusEvents(item.id);
    expect(audit.map((e) => e.to)).toEqual(["DRAFT", "PENDING", "VERIFIED"]);
  });
});

// ─── Route level ────────────────────────────────────────────────

const ADMIN = { "x-admin-key": "test-admin-key" };
const OPH = { ...ADMIN, "x-operator-id": "ops_test" };
let idem = 0;
const writeHeaders = (op = OPH) => ({
  ...op,
  "content-type": "application/json",
  "idempotency-key": `kn-${Date.now()}-${++idem}`,
});

function mkApp() {
  process.env.ADMIN_API_KEY = "test-admin-key";
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const app = new Hono();
  app.route("/", createAdminKnowledgeRoutes({ store }));
  return { app, store };
}

describe("admin knowledge API (SLICE-229-3)", () => {
  it("create draft: 201 + idempotent replay; missing key → 400", async () => {
    const { app } = mkApp();
    const noKey = await app.request("/admin/api/knowledge/items", {
      method: "POST",
      headers: { ...OPH, "content-type": "application/json" },
      body: JSON.stringify({ kind: "FAQ", title: "t", body: "b" }),
    });
    expect(noKey.status).toBe(400);
    const key = `kn-create-${Date.now()}`;
    const mk = () =>
      app.request("/admin/api/knowledge/items", {
        method: "POST",
        headers: { ...OPH, "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ kind: "FAQ", title: "pay faq", body: "b" }),
      });
    const first = await mk();
    expect(first.status).toBe(201);
    const second = await mk();
    expect(second.status).toBe(201);
    expect((await second.json()).duplicate).toBe(true);
  });

  it("transition: missing key → 400; invalid → 409 INVALID_TRANSITION", async () => {
    const { app, store } = mkApp();
    const item = await mkItem(store);
    const noKey = await app.request(
      `/admin/api/knowledge/items/${item.id}/transition`,
      { method: "POST", headers: OPH, body: JSON.stringify({ to: "PENDING" }) },
    );
    expect(noKey.status).toBe(400);
    const invalid = await app.request(
      `/admin/api/knowledge/items/${item.id}/transition`,
      {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({ to: "PUBLISHED" }),
      },
    );
    expect(invalid.status).toBe(409);
    expect((await invalid.json()).error.code).toBe("INVALID_TRANSITION");
    const ghost = await app.request(
      `/admin/api/knowledge/items/ki_ghost/transition`,
      {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({ to: "PENDING" }),
      },
    );
    expect(ghost.status).toBe(404);
  });

  it("full operator path: create → submit → verify → publish via API", async () => {
    const { app, store } = mkApp();
    const created = await app.request("/admin/api/knowledge/items", {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify({
        kind: "GUIDE", slug: "api-guide", title: "api", body: "b",
      }),
    });
    const { item, version } = await created.json();
    // Arc R1 H4: attach evidence before verify (gate at VERIFIED).
    const ev = await app.request(
      `/admin/api/knowledge/versions/${version.id}/evidence`,
      {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({
          type: "INTERNAL_DOC",
          uri: "internal://runbook/api-guide",
        }),
      },
    );
    expect(ev.status).toBe(200);
    // Separation of duties: verifier differs from submitter.
    for (const [to, op] of [
      ["PENDING", "ops_test"],
      ["VERIFIED", "ops_review"],
      ["PUBLISHED", "ops_test"],
    ] as const) {
      // Arc R3: VERIFIED/PUBLISHED require the stale-page preconditions —
      // pin the current version + evidence fingerprint like the UI does.
      const cur = await store.getItem(item.id);
      const ev = cur?.latestVersionId
        ? await store.listEvidence(cur.latestVersionId)
        : [];
      const r = await app.request(
        `/admin/api/knowledge/items/${item.id}/transition`,
        {
          method: "POST",
          headers: writeHeaders({
            ...ADMIN,
            "x-operator-id": op,
          }),
          body: JSON.stringify({
            to,
            expectedVersionId: cur?.latestVersionId ?? undefined,
            expectedEvidence: evidenceFingerprint(ev),
          }),
        },
      );
      expect(r.status).toBe(200);
    }
    const final = await store.getItem(item.id);
    expect(final?.status).toBe("PUBLISHED");
    expect(final?.publishedVersionId).toBe(final?.latestVersionId);
    // Detail endpoint exposes versions + audit.
    const detail = await app.request(
      `/admin/api/knowledge/items/${item.id}`, { headers: ADMIN },
    );
    const d = await detail.json();
    expect(d.versions).toHaveLength(1);
    expect(d.events).toHaveLength(4);
    // Legal transitions endpoint.
    const tr = await app.request(
      `/admin/api/knowledge/items/${item.id}/transitions`, { headers: ADMIN },
    );
    expect((await tr.json()).allowed).toEqual(["WITHDRAWN"]);
  });

  it("unauthenticated → 401; list filter validation", async () => {
    const { app } = mkApp();
    expect(
      (await app.request("/admin/api/knowledge/items")).status,
    ).toBe(401);
    const bad = await app.request(
      "/admin/api/knowledge/items?status=BOGUS", { headers: ADMIN },
    );
    expect(bad.status).toBe(400);
  });
});
