import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { resetIdempotencyStore } from "../src/server/lib/contract-guards";
import {
  createMemoryKnowledgeStores,
  recordGap,
  triageGap,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import { createAdminKnowledgeUi } from "../src/server/routes/admin-knowledge-ui";
import { generateReportId } from "../src/agent-readiness/integrity/ulid";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "./helpers/operators";
import { mkGap, mkPublishedItem } from "./helpers/knowledge";

/**
 * SLICE-264-12 — the ownership write path from the console/API:
 * POST …/assign dispatches assigned-vs-reassigned (audit names
 * what happened), service/inactive/missing assignees are typed
 * 400s, due-changes on an assigned gap demand /due+reason (C3).
 * List params: ?assigned=none + ?sort=overdue.
 */

let idem = 0;
const WRITE = (key: string) => ({
  "x-admin-key": key,
  "content-type": "application/json",
  "idempotency-key": `own-${Date.now()}-${++idem}`,
});

async function mkApp() {
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const operators = createMemoryOperatorStore();
  const admin = await seedOperator(operators, "Admin");
  const alice = await seedOperator(operators, "Alice");
  const bob = await seedOperator(operators, "Bob");
  const svc = await operators.createOperator({
    id: `op_${generateReportId()}`,
    displayName: "svc-intel",
    principalType: "service",
    capabilities: ["read"],
  });
  if (!svc.ok) throw new Error("service seed failed");
  const app = new Hono();
  app.route("/", createAdminKnowledgeRoutes({ store, operatorStore: operators }));
  return {
    app,
    store,
    operators,
    admin,
    alice,
    bob,
    svcId: svc.operator.id,
  };
}

const post = (
  app: Hono,
  path: string,
  key: string,
  body?: unknown,
) =>
  app.request(path, {
    method: "POST",
    headers: WRITE(key),
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("264-12: POST …/gaps/:id/assign|unassign|due", () => {
  it("assign → reassign dispatches honestly; audit names each", async () => {
    const { app, store, admin, alice, bob } = await mkApp();
    const gap = await mkGap(store);

    const a1 = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: alice.operatorId,
      dueAt: "2026-12-15T00:00:00.000Z",
    });
    expect(a1.status).toBe(200);
    const a1b = await a1.json();
    expect(a1b.gap.assignedTo).toBe(alice.operatorId);
    expect(a1b.gap.assignedBy).toBe(admin.operatorId);

    const a2 = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: bob.operatorId,
    });
    expect(a2.status).toBe(200);
    const events = await store.listGapEvents(gap.id);
    expect(events.map((e) => e.kind)).toEqual(["assigned", "reassigned"]);
    expect(events[1].previousAssignee).toBe(alice.operatorId);
    expect(events[1].dueAt).toBe("2026-12-15T00:00:00.000Z");

    // unassign → 200, deadline survives; second unassign → 200, NO
    // noise row (the no-op guard — audit carries facts, not taps).
    const u1 = await post(app, `/admin/api/knowledge/gaps/${gap.id}/unassign`, admin.key);
    expect(u1.status).toBe(200);
    const u2 = await post(app, `/admin/api/knowledge/gaps/${gap.id}/unassign`, admin.key);
    expect(u2.status).toBe(200);
    const ev2 = await store.listGapEvents(gap.id);
    expect(ev2.filter((e) => e.kind === "unassigned").length).toBe(1);
    expect(ev2[ev2.length - 1].dueAt).toBe("2026-12-15T00:00:00.000Z");
  });

  it("typed refusals: service/missing assignee → 400; due-on-assigned → 409; terminal → 409; unknown → 404", async () => {
    const { app, store, operators, admin, alice, svcId } = await mkApp();
    const gap = await mkGap(store);

    const svc = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: svcId,
    });
    expect(svc.status).toBe(400);
    expect((await svc.json()).error.code).toBe("ASSIGNEE_NOT_HUMAN");

    const ghost = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: "op_nonexistent",
    });
    expect(ghost.status).toBe(400);
    expect((await ghost.json()).error.code).toBe("ASSIGNEE_MISSING");

    const disabled = await operators.createOperator({
      id: `op_${generateReportId()}`,
      displayName: "disabled-op",
      principalType: "human",
      capabilities: ["read"],
    });
    if (!disabled.ok) throw new Error("seed failed");
    const off0 = await operators.disableOperator(disabled.operator.id);
    if (!off0.ok) throw new Error(`disable failed: ${off0.reason}`);
    const off = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: disabled.operator.id,
    });
    expect(off.status).toBe(400);
    expect((await off.json()).error.code).toBe("ASSIGNEE_INACTIVE");

    const miss = await post(app, "/admin/api/knowledge/gaps/kgap_none/assign", admin.key, {
      assignedTo: alice.operatorId,
    });
    expect(miss.status).toBe(404);

    // assign + then a body carrying a NEW dueAt on the owned gap →
    // 409: deadlines move only through /due with a reason (C3).
    await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: alice.operatorId,
      dueAt: "2026-12-15T00:00:00.000Z",
    });
    const launder = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: alice.operatorId,
      dueAt: "2027-01-01T00:00:00.000Z",
    });
    expect(launder.status).toBe(409);
    expect((await launder.json()).error.code).toBe("DUE_AT_CHANGE_NEEDS_REASON");

    // terminal gap takes no owner.
    await triageGap(store, gap.id, admin.operatorId);
    await store.transitionGap(gap.id, {
      from: "TRIAGED",
      to: "WONTFIX",
      resolvedAt: null,
    });
    const term = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: alice.operatorId,
    });
    expect(term.status).toBe(409);
    expect((await term.json()).error.code).toBe("GAP_TERMINAL");
  });

  it("/due: reason required → typed 400; set + clear write due_set/due_cleared", async () => {
    const { app, store, admin } = await mkApp();
    const gap = await mkGap(store);

    const noReason = await post(app, `/admin/api/knowledge/gaps/${gap.id}/due`, admin.key, {
      dueAt: "2026-12-15T00:00:00.000Z",
      reason: "",
    });
    expect(noReason.status).toBe(400);
    // whitespace passes zod but the domain trims it → typed code.
    const wsReason = await post(app, `/admin/api/knowledge/gaps/${gap.id}/due`, admin.key, {
      dueAt: "2026-12-15T00:00:00.000Z",
      reason: "   ",
    });
    expect(wsReason.status).toBe(400);
    expect((await wsReason.json()).error.code).toBe("REASON_REQUIRED");

    const naive = await post(app, `/admin/api/knowledge/gaps/${gap.id}/due`, admin.key, {
      dueAt: "2026-12-15T00:00:00",
      reason: "naive stamp",
    });
    expect(naive.status).toBe(400);
    expect((await naive.json()).error.code).toBe("BAD_DUE_AT");

    const set = await post(app, `/admin/api/knowledge/gaps/${gap.id}/due`, admin.key, {
      dueAt: "2026-12-20T00:00:00.000Z",
      reason: "sprint slip",
    });
    expect(set.status).toBe(200);

    const clear = await post(app, `/admin/api/knowledge/gaps/${gap.id}/due`, admin.key, {
      dueAt: null,
      reason: "deprioritized",
    });
    expect(clear.status).toBe(200);

    const events = await store.listGapEvents(gap.id);
    expect(events.map((e) => e.kind)).toEqual(["due_set", "due_cleared"]);
    expect(events[0].reason).toBe("sprint slip");
    expect(events[1].reason).toBe("deprioritized");
    expect((await store.getGap(gap.id))!.dueAt).toBeNull();
  });

  it("missing idempotency-key → 400 before any work", async () => {
    const { app, store, admin, alice } = await mkApp();
    const gap = await mkGap(store);
    const r = await app.request(`/admin/api/knowledge/gaps/${gap.id}/assign`, {
      method: "POST",
      headers: { "x-admin-key": admin.key, "content-type": "application/json" },
      body: JSON.stringify({ assignedTo: alice.operatorId }),
    });
    expect(r.status).toBe(400);
    expect(await store.listGapEvents(gap.id)).toEqual([]);
  });

  it("edge honesty: read-only cred → 403; malformed body → 400; unassign/due → 404 on unknown gap", async () => {
    const { app, store, operators, admin, alice } = await mkApp();
    const gap = await mkGap(store);
    const ro = await seedOperator(operators, "ReadOnly", ["read"]);
    const denied = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, ro.key, {
      assignedTo: alice.operatorId,
    });
    expect(denied.status).toBe(403);

    const malformed = await post(app, `/admin/api/knowledge/gaps/${gap.id}/assign`, admin.key, {
      assignedTo: 123,
    });
    expect(malformed.status).toBe(400);

    const u = await post(app, "/admin/api/knowledge/gaps/kgap_none/unassign", admin.key, {});
    expect(u.status).toBe(404);
    const d = await post(app, "/admin/api/knowledge/gaps/kgap_none/due", admin.key, {
      dueAt: null,
      reason: "x",
    });
    expect(d.status).toBe(404);
  });
});

describe("264-12: GET …/gaps — assigned=none + sort=overdue", () => {
  const mkOwned = async (
    t: { store: ReturnType<typeof createMemoryKnowledgeStores> },
    query: string,
    owner: string | null,
    dueAt: string | null,
  ) => {
    const r = await recordGap(t.store, { query, source: "MANUAL" });
    if (!r.ok || !r.gap) throw new Error("seed failed");
    if (owner !== null || dueAt !== null) {
      await t.store.assignGap(r.gap.id, {
        assignedTo: owner,
        assignedBy: owner === null ? null : "seed",
        assignedAt: owner === null ? null : "2026-11-24T00:00:00.000Z",
        dueAt,
      });
    }
    return r.gap;
  };

  it("unassigned pool filter + overdue-first ordering", async () => {
    const t = await mkApp();
    const past = "2020-01-01T00:00:00.000Z";
    const future = "2030-01-01T00:00:00.000Z";
    const free = await mkOwned(t, "pool free gap", null, null);
    const overdue = await mkOwned(t, "pool overdue gap", t.alice.operatorId, past);
    await mkOwned(t, "pool future gap", t.alice.operatorId, future);
    // RESOLVED + past-due is NOT overdue — a finished row can't be late.
    const done = await mkOwned(t, "pool done gap", t.alice.operatorId, past);
    await triageGap(t.store, done.id, t.admin.operatorId);
    await t.store.transitionGap(done.id, {
      from: "TRIAGED",
      to: "RESOLVED",
      linkedItemId: "item_x",
      resolvedAt: "2026-11-24T00:00:00.000Z",
    });

    const AUTH = { "x-admin-key": t.admin.key };
    const pool = await t.app.request(
      "/admin/api/knowledge/gaps?status=all&assigned=none",
      { headers: AUTH },
    );
    expect(pool.status).toBe(200);
    const poolBody = await pool.json();
    const ids = poolBody.gaps.map((g: { id: string }) => g.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(overdue.id);

    const all = await t.app.request(
      "/admin/api/knowledge/gaps?status=all&sort=overdue&limit=50",
      { headers: AUTH },
    );
    const allBody = await all.json();
    expect(allBody.gaps[0].id).toBe(overdue.id);
  });
});

// ─── SSR console (DoD: unassigned pool → claim → due → overdue →
// resolve) — browser forms ride operatorBrowserAuth + minted
// single-use formTokens; the actor is the credential principal.

async function mkUi() {
  resetIdempotencyStore();
  const store = createMemoryKnowledgeStores();
  const operators = createMemoryOperatorStore();
  const alice = await seedOperator(operators, "Alice");
  const bob = await seedOperator(operators, "Bob");
  const app = new Hono();
  app.route("/", createAdminKnowledgeUi(store, operators));
  const AUTH = `Basic ${Buffer.from(`x:${alice.key}`).toString("base64")}`;
  return { app, store, operators, alice, bob, AUTH };
}

const uiToken = async (app: Hono, AUTH: string, path: string) => {
  const page = await (
    await app.request(path, { headers: { authorization: AUTH } })
  ).text();
  const m = /name="formToken" value="([^"]+)"/.exec(page);
  return m?.[1];
};

const uiPost = (
  app: Hono,
  AUTH: string,
  path: string,
  body: Record<string, string>,
) =>
  app.request(path, {
    method: "POST",
    headers: {
      authorization: AUTH,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });

describe("264-12: gaps console (SSR)", () => {
  it("full DoD cycle: pool → claim → due → OVERDUE badge → resolve → out", async () => {
    const { app, store, alice, AUTH } = await mkUi();
    const gap = await mkGap(store);

    // unassigned pool shows it; claimed rows drop out.
    const pool = await (
      await app.request("/admin/knowledge/gaps?assigned=none", {
        headers: { authorization: AUTH },
      })
    ).text();
    expect(pool).toContain(gap.normalizedQuery);

    const token = await uiToken(app, AUTH, "/admin/knowledge/gaps");
    expect(token).toBeTruthy();

    // claim → the CREDENTIAL principal owns it (never a form field).
    const claim = await uiPost(app, AUTH, `/admin/knowledge/gaps/${gap.id}/assign`, {
      claim: "1",
      formToken: token!,
    });
    expect(claim.status).toBe(303);
    const mine = await store.getGap(gap.id);
    expect(mine?.assignedTo).toBe(alice.operatorId);
    expect(mine?.assignedBy).toBe(alice.operatorId);

    const pool2 = await (
      await app.request("/admin/knowledge/gaps?assigned=none", {
        headers: { authorization: AUTH },
      })
    ).text();
    expect(pool2).not.toContain(gap.normalizedQuery);

    // due via the console form (datetime-local → UTC stamped).
    const token2 = await uiToken(app, AUTH, `/admin/knowledge/gaps/${gap.id}`);
    const due = await uiPost(app, AUTH, `/admin/knowledge/gaps/${gap.id}/due`, {
      dueAt: "2020-06-01T12:00",
      reason: "console deadline",
      formToken: token2!,
    });
    expect(due.status).toBe(303);
    expect((await store.getGap(gap.id))?.dueAt).toBe("2020-06-01T12:00:00Z");

    // OVERDUE badge renders on the backlog row (OPEN + past due).
    const list = await (
      await app.request("/admin/knowledge/gaps", {
        headers: { authorization: AUTH },
      })
    ).text();
    expect(list).toContain("OVERDUE");
    expect(list).toContain("Alice");

    // detail page shows the audit feed — actor + previousAssignee.
    const detail = await (
      await app.request(`/admin/knowledge/gaps/${gap.id}`, {
        headers: { authorization: AUTH },
      })
    ).text();
    expect(detail).toContain("assigned");
    expect(detail).toContain("due_set");
    expect(detail).toContain("console deadline");

    // resolve (TRIAGED → link a real item) → out of the live queue.
    // Token from the DETAIL page — the list defaults to OPEN and a
    // TRIAGED row no longer renders there (empty page → no tokens).
    await triageGap(store, gap.id, alice.operatorId);
    const itemId = await mkPublishedItem(store, "console-answer");
    const res = await uiPost(app, AUTH, `/admin/knowledge/gaps/${gap.id}/resolve`, {
      linkedItemId: itemId,
      formToken: (await uiToken(app, AUTH, `/admin/knowledge/gaps/${gap.id}`))!,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).not.toContain("err=");
    expect((await store.getGap(gap.id))?.status).toBe("RESOLVED");
    const out = await (
      await app.request("/admin/knowledge/gaps?status=OPEN", {
        headers: { authorization: AUTH },
      })
    ).text();
    expect(out).not.toContain(gap.normalizedQuery);
  });

  it("form refusals: no token → refused; no reason → err flash", async () => {
    const { app, store, alice, AUTH } = await mkUi();
    const gap = await mkGap(store);

    const noTok = await uiPost(app, AUTH, `/admin/knowledge/gaps/${gap.id}/assign`, {
      assignedTo: alice.operatorId,
    });
    expect(noTok.status).toBe(303);
    expect(noTok.headers.get("location")).toContain("err=");
    expect((await store.getGap(gap.id))?.assignedTo).toBeNull();

    const token = await uiToken(app, AUTH, "/admin/knowledge/gaps");
    const noReason = await uiPost(app, AUTH, `/admin/knowledge/gaps/${gap.id}/due`, {
      dueAt: "2026-12-20T10:00",
      reason: "",
      formToken: token!,
    });
    expect(noReason.headers.get("location")).toContain("err=");
    expect((await store.getGap(gap.id))?.dueAt).toBeNull();
  });

  it("C3 bypass shut (264-12 review): assign form can't stamp a deadline on an OWNED gap", async () => {
    const { app, store, alice, AUTH } = await mkUi();
    const gap = await mkGap(store);
    // Alice already owns it — no deadline yet. The JSON API used to
    // refuse this via a route-local check the form never had.
    await store.assignGap(gap.id, {
      assignedTo: alice.operatorId,
      assignedBy: "seed",
      assignedAt: "2026-11-24T00:00:00.000Z",
      dueAt: null,
    });
    const token = await uiToken(app, AUTH, `/admin/knowledge/gaps/${gap.id}`);
    const r = await uiPost(app, AUTH, `/admin/knowledge/gaps/${gap.id}/assign`, {
      assignedTo: alice.operatorId,
      dueAt: "2027-01-01T00:00",
      formToken: token!,
      next: `/admin/knowledge/gaps/${gap.id}`,
    });
    expect(r.status).toBe(303);
    const loc = r.headers.get("location") ?? "";
    // `next` honored (detail context kept) + typed refusal, no
    // write, no audit row — the deadline only moves via /due+reason.
    expect(loc).toContain(`/admin/knowledge/gaps/${gap.id}?`);
    expect(loc).toContain("err=due_at_change_needs_reason");
    expect((await store.getGap(gap.id))?.dueAt).toBeNull();
    expect(await store.listGapEvents(gap.id)).toEqual([]);
  });
});
