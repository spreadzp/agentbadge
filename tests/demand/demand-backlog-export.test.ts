import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAdminDemandRoutes } from "../../src/server/routes/admin-demand-api";
import { createMemoryDemandStores } from "../../src/server/lib/demand/db-stores";
import { ingestDemand } from "../../src/server/lib/demand/pipeline";
import {
  createBacklogTaskWriter,
  linkDemandBacklog,
  type BacklogTaskWriter,
} from "../../src/server/lib/demand/backlog-export";
import {
  createDemandOpportunity,
  transitionDemandOpportunity,
} from "../../src/server/lib/demand/operator-ops-opportunities";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-231-8: «→ Backlog task» export — card content from the
 * frozen snapshot, taskId persisted + LINKED status, idempotent
 * repeat click, CAS-loss rollback (no orphan card), FS writer id
 * allocation. Uses a stub writer for op-level tests and a real
 * tmp-dir writer for the FS cases.
 */

const seedAcceptedOpp = async (
  store: ReturnType<typeof createMemoryDemandStores>,
) => {
  const a = await ingestDemand(
    store,
    {
      text: "can you escrow my payout",
      source: "DEMAND_API",
      declaredLevel: "INTENT",
    },
    { resolution: "API_KEY", actorRef: "agent:agb_1" },
  );
  if (!a.ok) throw new Error("ingest failed");
  const created = await createDemandOpportunity(
    store, a.cluster.id, { title: "Escrow payouts" }, "op_test",
  );
  if (!created.ok) throw new Error("opp create failed");
  const opp = created.opportunity;
  // PROPOSED → EVALUATING → ACCEPTED through the shared op.
  for (const to of ["EVALUATING", "ACCEPTED"] as const) {
    const r = await transitionDemandOpportunity(
      store, opp.id, to, {}, "op_test",
    );
    if (!r.ok) throw new Error(`transition ${to} failed: ${r.reason}`);
  }
  return { cluster: a.cluster, opp: (await store.getOpportunity(opp.id))! };
};

const fakeWriter = (
  captured: { cards: unknown[]; rolledBack: number },
): BacklogTaskWriter => ({
  write: async (card) => {
    captured.cards.push(card);
    return {
      taskId: `MYPROJ-${9000 + captured.cards.length}`,
      filePath: "/fake",
      rollback: async () => {
        captured.rolledBack++;
      },
    };
  },
});

describe("linkDemandBacklog (op)", () => {
  it("exports card from snapshot, links taskId, → LINKED, emits event", async () => {
    const store = createMemoryDemandStores();
    const { opp } = await seedAcceptedOpp(store);
    const captured = {
      cards: [] as { title: string; description: string }[],
      rolledBack: 0,
    };
    const r = await linkDemandBacklog(store, opp.id, "op_wf", {
      writer: fakeWriter(captured),
    });
    expect(r.ok && r.taskId).toBe("MYPROJ-9001");
    expect(r.ok && r.opportunity.status).toBe("LINKED");
    expect(r.ok && r.opportunity.backlogTaskId).toBe("MYPROJ-9001");
    // Card content — AC#4: what's asked / actors / level / examples.
    const card = captured.cards[0]!;
    expect(card.title).toContain("Escrow payouts");
    expect(card.description).toContain("unique actors");
    expect(card.description).toContain("level INTEREST");
    expect(card.description).toContain("can you escrow my payout");
    const events = await store.listEvents("opportunity", opp.id);
    expect(events.map((e) => e.kind)).toContain(
      "demand.opportunity.linked",
    );
    expect(captured.rolledBack).toBe(0);
  });

  it("repeat click is idempotent — no second card, same taskId", async () => {
    const store = createMemoryDemandStores();
    const { opp } = await seedAcceptedOpp(store);
    const captured = { cards: [] as unknown[], rolledBack: 0 };
    const writer = fakeWriter(captured);
    const first = await linkDemandBacklog(store, opp.id, "op_wf", { writer });
    const second = await linkDemandBacklog(store, opp.id, "op_wf", { writer });
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.alreadyLinked).toBe(true);
    expect(second.ok && second.taskId).toBe(first.ok && first.taskId);
    expect(captured.cards.length).toBe(1); // AC#3 — no duplicate card
  });

  it("refuses non-ACCEPTED and missing opportunities", async () => {
    const store = createMemoryDemandStores();
    const a = await ingestDemand(
      store,
      { text: "x", source: "DEMAND_API", declaredLevel: "INTEREST" },
      { resolution: "ANON", actorRef: "anon:ip:1" },
    );
    if (!a.ok) throw new Error("ingest failed");
    const created = await createDemandOpportunity(
      store, a.cluster.id, {}, "op_test",
    );
    if (!created.ok) throw new Error("opp failed");
    const captured = { cards: [] as unknown[], rolledBack: 0 };
    const proposed = await linkDemandBacklog(
      store, created.opportunity.id, "op_wf",
      { writer: fakeWriter(captured) },
    );
    expect(proposed.ok).toBe(false);
    expect(!proposed.ok && proposed.reason).toBe("illegal_status");
    const missing = await linkDemandBacklog(store, "do_none", "op_wf", {
      writer: fakeWriter(captured),
    });
    expect(missing.ok).toBe(false);
    expect(captured.cards.length).toBe(0); // refused before FS touch
  });

  it("writer failure → write_failed, status untouched", async () => {
    const store = createMemoryDemandStores();
    const { opp } = await seedAcceptedOpp(store);
    const r = await linkDemandBacklog(store, opp.id, "op_wf", {
      writer: { write: () => Promise.reject(new Error("disk full")) },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("write_failed");
    expect((await store.getOpportunity(opp.id))!.status).toBe("ACCEPTED");
  });

  it("CAS drift after write → refusal + rollback (no orphan card)", async () => {
    const store = createMemoryDemandStores();
    const { opp } = await seedAcceptedOpp(store);
    const captured = { cards: [] as unknown[], rolledBack: 0 };
    // Race: someone links the row between our read and our CAS —
    // emulate by linking first, then clearing the field to pass the
    // early-check but fail the store CAS… simpler: a writer that
    // links the row itself mid-write.
    const raceWriter: BacklogTaskWriter = {
      write: async (card) => {
        const res = await store.linkBacklogTask(
          opp.id, "MYPROJ-OTHER", { status: "ACCEPTED" },
          {
            kind: "demand.opportunity.linked",
            visibility: "INTERNAL",
            payload: { raced: true },
            idempotencyKey: "race",
          },
        );
        expect(res.linked).toBe(true);
        return fakeWriter(captured).write(card);
      },
    };
    const r = await linkDemandBacklog(store, opp.id, "op_wf", {
      writer: raceWriter,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("already_linked");
    expect(captured.rolledBack).toBe(1); // orphan card removed
    expect((await store.getOpportunity(opp.id))!.backlogTaskId).toBe(
      "MYPROJ-OTHER",
    );
  });
});

describe("createBacklogTaskWriter (FS)", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("allocates MYPROJ-{max+1}, writes valid task file", async () => {
    dir = mkdtempSync(resolve(tmpdir(), "demand-backlog-"));
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      resolve(dir, "myproj-2948 - existing.md"),
      "---\nid: MYPROJ-2948\nordinal: 3164000\n---\n",
    );
    const writer = createBacklogTaskWriter(dir);
    const r = await writer.write({
      title: "DEMAND: Escrow payouts",
      description: "desc",
      acceptanceCriteria: ["ac1", "ac2"],
      labels: ["demand-export"],
    });
    expect(r.taskId).toBe("MYPROJ-2949");
    const files = readdirSync(dir);
    const created = files.find((f) => f.startsWith("myproj-2949"));
    expect(created).toBeTruthy();
    const body = readFileSync(resolve(dir, created!), "utf8");
    expect(body).toContain("id: MYPROJ-2949");
    expect(body).toContain("status: To Do");
    expect(body).toContain("- [ ] #1 ac1");
    expect(body).toContain("ordinal: 3165000");
    // rollback removes the card
    await r.rollback();
    expect(readdirSync(dir).find((f) => f.startsWith("myproj-2949"))).toBe(
      undefined,
    );
  });
});

describe("API POST /opportunities/:id/backlog", () => {
  it("exports + links via JSON surface; repeat → alreadyLinked", async () => {
    const store = createMemoryDemandStores();
    const opStore = createMemoryOperatorStore();
    const captured = { cards: [] as { description: string }[], rolledBack: 0 };
    const app = new Hono();
    app.route(
      "/",
      createAdminDemandRoutes({
        store,
        operatorStore: opStore,
        backlogWriter: () => fakeWriter(captured),
      }),
    );
    const { key } = await seedOperator(opStore);
    const { opp } = await seedAcceptedOpp(store);
    const call = (idem: string) =>
      app.request(`/api/admin/demand/opportunities/${opp.id}/backlog`, {
        method: "POST",
        headers: { "x-admin-key": key, "idempotency-key": idem },
      });
    const r = await call("idem-backlog-1");
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.taskId).toBe("MYPROJ-9001");
    expect(j.opportunity.status).toBe("LINKED");
    const again = await call("idem-backlog-2");
    expect(again.status).toBe(200);
    expect((await again.json()).alreadyLinked).toBe(true);
    expect(captured.cards.length).toBe(1);
  });
});
