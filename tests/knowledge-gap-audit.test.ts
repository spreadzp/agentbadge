import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createDatabase, type Database } from "@agentbadge/database";

import {
  assignGap,
  createMemoryKnowledgeStores,
  DbKnowledgeStore,
  normalizeQuery,
  recordGap,
  reassignGap,
  resolveGap,
  setGapDueAt,
  triageGap,
  unassignGap,
} from "../src/server/lib/knowledge";
import { createAdminKnowledgeRoutes } from "../src/server/routes/admin-knowledge-api";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "./helpers/operators";
import {
  mkGap,
  mkGapStore as mkStore,
  mkPublishedItem,
} from "./helpers/knowledge";

/**
 * SLICE-264-11 DoD — persisted gap audit (the memory backend proves
 * the invariant without PG): assign→reassign→due-change reads
 * row-by-row with actors + previousAssignee chain; lifecycle +
 * auto-reopen write events; a guarded refusal writes none. Plus the
 * events admin route and the opt-in PG-backend block.
 */

describe("gap audit (SLICE-264-11)", () => {
  it("264-11: assign→reassign→due-change reads row-by-row with actors + assignee chain", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const a = await seedOperator(operators, "aud-a");
    const b = await seedOperator(operators, "aud-b");
    const due = "2026-12-15T00:00:00.000Z";

    await assignGap(
      store,
      { gapId: gap.id, assignedTo: a.operatorId, assignedBy: "op_admin", dueAt: due },
      { operators },
    );
    await reassignGap(
      store,
      { gapId: gap.id, assignedTo: b.operatorId, assignedBy: "op_admin2" },
      { operators },
    );
    await setGapDueAt(store, {
      gapId: gap.id,
      dueAt: "2026-12-30T00:00:00.000Z",
      reason: "sprint slip",
      actor: "op_admin3",
    });
    await unassignGap(store, { gapId: gap.id, actor: "op_admin" });

    const events = await store.listGapEvents(gap.id);
    expect(events.map((e) => e.kind)).toEqual([
      "assigned",
      "reassigned",
      "due_set",
      "unassigned",
    ]);
    // previousAssignee chain — who held it before each event.
    expect(events[0].previousAssignee).toBeNull();
    expect(events[0].assignedTo).toBe(a.operatorId);
    expect(events[0].actor).toBe("op_admin");
    expect(events[0].dueAt).toBe(due);
    expect(events[1].previousAssignee).toBe(a.operatorId);
    expect(events[1].assignedTo).toBe(b.operatorId);
    expect(events[1].actor).toBe("op_admin2");
    // anti-laundering visible in the row: reassign kept the dueAt.
    expect(events[1].dueAt).toBe(due);
    expect(events[2].reason).toBe("sprint slip");
    expect(events[2].actor).toBe("op_admin3");
    expect(events[2].dueAt).toBe("2026-12-30T00:00:00.000Z");
    expect(events[3].previousAssignee).toBe(b.operatorId);
    expect(events[3].assignedTo).toBeNull();
    // occurredAt ordering is the audit read contract.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].occurredAt >= events[i - 1].occurredAt).toBe(true);
    }
    // events are scoped per-gap — another gap's log stays empty.
    const other = await recordGap(store, {
      query: "unrelated gap question", source: "MANUAL",
    });
    if (other.ok && other.gap) {
      expect(await store.listGapEvents(other.gap.id)).toEqual([]);
    }
  });

  it("264-11: lifecycle + auto-reopen persist events; guarded refusal writes none", async () => {
    const { store } = await mkStore();
    const gap = await mkGap(store);
    const itemId = await mkPublishedItem(store, "audit-answer");

    // due_set without reason → guard refuses → NO event row.
    const refused = await setGapDueAt(store, {
      gapId: gap.id,
      dueAt: "2026-12-20T00:00:00.000Z",
      reason: "",
      actor: "op_admin",
    });
    expect(refused.ok).toBe(false);
    expect(await store.listGapEvents(gap.id)).toEqual([]);

    await triageGap(store, gap.id, "op_admin");
    await resolveGap(store, gap.id, itemId, "op_admin2");
    let events = await store.listGapEvents(gap.id);
    expect(events.map((e) => e.kind)).toEqual(["triaged", "resolved"]);
    expect(events[0].actor).toBe("op_admin");
    expect(events[1].actor).toBe("op_admin2");

    // auto-reopen (dedupe hit on RESOLVED) — actor "system".
    const again = await recordGap(store, {
      query: "how DOES escrow settlement WORK",
      source: "INTERACTION_SIGNAL",
    });
    if (!again.ok) throw new Error("reopen failed");
    events = await store.listGapEvents(gap.id);
    expect(events.map((e) => e.kind)).toEqual([
      "triaged",
      "resolved",
      "reopened",
    ]);
    expect(events[2].actor).toBe("system");

    // Cap-blocked reopen: resolve again, then a dedupe hit under
    // openCap 0 — the refused flip must not mint a reopened row.
    await triageGap(store, gap.id, "op_admin");
    await resolveGap(store, gap.id, itemId, "op_admin2");
    const blocked = await store.recordGap(
      {
        id: `kgap_blocked_${gap.id}`,
        normalizedQuery: gap.normalizedQuery,
        sampleQuery: "how DOES escrow settlement WORK",
        source: "MANUAL",
      },
      { openCap: 0 },
    );
    expect(blocked.recorded).toBe(true);
    expect(blocked.reopened).toBe(false);
    events = await store.listGapEvents(gap.id);
    expect(events.map((e) => e.kind)).toEqual([
      "triaged",
      "resolved",
      "reopened",
      "triaged",
      "resolved",
    ]);
  });
});

describe("264-11: GET /admin/api/knowledge/gaps/:id/events", () => {
  it("404 on unknown gap; chronological audit trail on a real one", async () => {
    const store = createMemoryKnowledgeStores();
    const operators = createMemoryOperatorStore();
    const alice = await seedOperator(operators, "Alice");
    const bob = await seedOperator(operators, "Bob");
    const app = new Hono();
    app.route("/", createAdminKnowledgeRoutes({ store, operatorStore: operators }));
    const AUTH = { "x-admin-key": alice.key };

    const miss = await app.request(
      "/admin/api/knowledge/gaps/kgap_none/events",
      { headers: AUTH },
    );
    expect(miss.status).toBe(404);

    const gap = await mkGap(store);
    await assignGap(
      store,
      {
        gapId: gap.id,
        assignedTo: bob.operatorId,
        assignedBy: alice.operatorId,
        dueAt: "2026-12-15T00:00:00.000Z",
      },
      { operators },
    );
    await unassignGap(store, { gapId: gap.id, actor: alice.operatorId });

    const r = await app.request(
      `/admin/api/knowledge/gaps/${gap.id}/events`,
      { headers: AUTH },
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.count).toBe(2);
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual([
      "assigned",
      "unassigned",
    ]);
    expect(body.events[0].actor).toBe(alice.operatorId);
    expect(body.events[0].assignedTo).toBe(bob.operatorId);
    expect(body.events[1].actor).toBe(alice.operatorId);
    expect(body.events[1].previousAssignee).toBe(bob.operatorId);
    expect(body.events[1].assignedTo).toBeNull();
  });
});

/** Opt-in PG run — the server's own DATABASE_URL DB doesn't carry
 *  the package migrations; point KNOWLEDGE_PG_URL at a migrated
 *  dev PG (e.g. packages/database's) to exercise the real
 *  DbKnowledgeStore.assignGap/mapGap glue the memory suite can't. */
const PG_URL = process.env["KNOWLEDGE_PG_URL"];
describe.skipIf(!PG_URL)("gap ownership — PG backend", () => {
  let database: Database | undefined;
  afterAll(async () => {
    await database?.close();
  });

  it("assign/reassign/unassign/dueAt + resolvedAt lifecycle on DbKnowledgeStore", async () => {
    database = createDatabase({ url: PG_URL, enabled: true });
    const k = database.knowledge;
    if (!k) throw new Error("knowledge repos missing");
    const store = new DbKnowledgeStore(k.core, k.taxonomy);
    const operators = createMemoryOperatorStore();
    const a = await seedOperator(operators, "pg-a");
    const b = await seedOperator(operators, "pg-b");

    const nq = `pg-own-${Date.now().toString(36)}`;
    const g = await recordGap(store, { query: nq, source: "MANUAL" });
    if (!g.ok || !g.gap) throw new Error("gap seed failed");
    expect(g.gap.assignedTo).toBeNull();
    expect(g.gap.resolvedAt).toBeNull();

    const due = "2026-12-15T00:00:00.000Z";
    const a1 = await assignGap(
      store,
      { gapId: g.gap.id, assignedTo: a.operatorId, assignedBy: "op_admin", dueAt: due },
      { operators },
    );
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    expect(a1.gap.assignedTo).toBe(a.operatorId);
    expect(new Date(a1.gap.dueAt!).toISOString()).toBe(due);

    // reassign keeps dueAt; unassign clears the triple, keeps it.
    const re = await reassignGap(
      store,
      { gapId: g.gap.id, assignedTo: b.operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    expect(re.gap.assignedTo).toBe(b.operatorId);
    expect(new Date(re.gap.dueAt!).toISOString()).toBe(due);
    const un = await unassignGap(store, { gapId: g.gap.id, actor: "op_admin" });
    expect(un.ok).toBe(true);
    if (!un.ok) return;
    expect(un.gap.assignedTo).toBeNull();
    expect(new Date(un.gap.dueAt!).toISOString()).toBe(due);

    // RESOLVED stamps; dedupe-hit reopen clears resolvedAt too.
    await store.transitionGap(g.gap.id, {
      from: "OPEN", to: "TRIAGED", resolvedAt: null,
    });
    const res = await store.transitionGap(g.gap.id, {
      from: "TRIAGED", to: "RESOLVED", linkedItemId: "item_pg",
      resolvedAt: "2026-11-24T12:00:00.000Z",
    });
    expect(res.transitioned).toBe(true);
    expect(res.gap?.resolvedAt).not.toBeNull();
    const again = await recordGap(store, { query: nq.toUpperCase(), source: "MANUAL" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reopened).toBe(true);
    expect(again.gap!.resolvedAt).toBeNull();
    expect(again.gap!.status).toBe("OPEN");

    // listGaps surfaces the columns through mapGap.
    const listed = await store.listGaps({ status: "OPEN" });
    const ours = listed.find((r) => r.id === g.gap!.id);
    expect(ours?.assignedTo).toBeNull();
    expect(new Date(ours!.dueAt!).toISOString()).toBe(due);

    // 264-11: persisted audit — domain writes (assign/reassign/
    // unassign) + the store-internal reopen; the two bare
    // transitionGap calls above carried no event (store-level
    // event stays optional for non-domain callers).
    const events = await store.listGapEvents(g.gap.id);
    expect(events.map((e) => e.kind)).toEqual([
      "assigned",
      "reassigned",
      "unassigned",
      "reopened",
    ]);
    expect(events[0].actor).toBe("op_admin");
    expect(events[0].previousAssignee).toBeNull();
    expect(new Date(events[0].dueAt!).toISOString()).toBe(due);
    expect(events[1].previousAssignee).toBe(a.operatorId);
    expect(events[1].assignedTo).toBe(b.operatorId);
    expect(events[2].previousAssignee).toBe(b.operatorId);
    expect(events[2].assignedTo).toBeNull();
    expect(events[3].actor).toBe("system");
    // reopened carries the post-write snapshot — owner cleared by
    // unassign, deadline still held (memory parity).
    expect(events[3].assignedTo).toBeNull();
    expect(new Date(events[3].dueAt!).toISOString()).toBe(due);
    for (const e of events) {
      expect(Number.isNaN(Date.parse(e.occurredAt))).toBe(false);
    }
  });

  it("cap-blocked reopen writes no reopened event", async () => {
    database = createDatabase({ url: PG_URL, enabled: true });
    const k = database.knowledge;
    if (!k) throw new Error("knowledge repos missing");
    const store = new DbKnowledgeStore(k.core, k.taxonomy);

    const nq = `pg-cap-${Date.now().toString(36)}`;
    const g = await recordGap(store, { query: nq, source: "MANUAL" });
    if (!g.ok || !g.gap) throw new Error("gap seed failed");
    await store.transitionGap(g.gap.id, {
      from: "OPEN", to: "TRIAGED", resolvedAt: null,
    });
    await store.transitionGap(g.gap.id, {
      from: "TRIAGED", to: "RESOLVED", linkedItemId: "item_cap",
      resolvedAt: "2026-11-24T12:00:00.000Z",
    });

    // openCap 0 refuses the flip back to OPEN — bump lands, no event.
    // Store-level call (the domain fn owns openCap policy; the
    // no-event-on-refused-flip invariant lives in the store write).
    const blocked = await store.recordGap(
      {
        id: `kgap_${Date.now().toString(36)}x`,
        normalizedQuery: normalizeQuery(nq),
        sampleQuery: nq.toUpperCase(),
        source: "MANUAL",
      },
      { openCap: 0 },
    );
    expect(blocked.recorded).toBe(true);
    expect(blocked.reopened).toBe(false);
    expect(blocked.row?.status).toBe("RESOLVED");
    expect(await store.listGapEvents(g.gap.id)).toEqual([]);
  });
});
