import { describe, expect, it } from "vitest";

import {
  assignGap,
  reassignGap,
  recordGap,
  resolveGap,
  setGapDueAt,
  triageGap,
  unassignGap,
  wontfixGap,
} from "../src/server/lib/knowledge";
import type { AdminOperator } from "../src/server/lib/operators/types";
import { seedOperator } from "./helpers/operators";
import {
  mkGap,
  mkGapStore as mkStore,
  mkPublishedItem,
  mkServiceOp,
} from "./helpers/knowledge";

/**
 * SLICE-264-10 DoD — gap ownership fields:
 * - assign/unassign/reassign/setGapDueAt on the memory backend
 * - service/break_glass/inactive/missing assignee → typed refusal
 * - reassign NEVER resets dueAt (anti-laundering); unassign keeps it
 * - setGapDueAt without reason → reason_required; bad ts → bad_due_at
 * - RESOLVED transition stamps resolvedAt; reopen clears it
 * - terminal gaps refuse assignment
 *
 * The 264-11 persisted-audit coverage lives in
 * knowledge-gap-audit.test.ts (token-limit split).
 */

describe("gap ownership (SLICE-264-10)", () => {
  it("assign writes all four fields", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators, "On-call");
    const due = "2026-12-01T00:00:00.000Z";
    const r = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: due },
      { operators },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.gap.assignedTo).toBe(operatorId);
    expect(r.gap.assignedBy).toBe("op_admin");
    expect(r.gap.assignedAt).not.toBeNull();
    expect(r.gap.dueAt).toBe(due);
    expect(r.gap.status).toBe("OPEN"); // assignment ≠ lifecycle
  });

  it("assign refusals: missing gap / missing op / non-human / inactive / terminal", async () => {
    // break_glass rows can't come through createOperator anymore
    // (Arc-264-16 M4 — reserved class); a phantom row is fixture-
    // prefilled so the non-human refusal stays covered.
    const bg: AdminOperator = {
      id: "op_bgx",
      displayName: "bg",
      principalType: "break_glass",
      capabilities: ["read"],
      status: "active",
      createdAt: new Date().toISOString(),
      disabledAt: null,
    };
    const { store, operators } = await mkStore({ operators: [bg] });
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators, "A");
    await seedOperator(operators, "B"); // keeps C5 satisfied while A…nope — B is the spare

    const missingGap = await assignGap(
      store,
      { gapId: "kgap_nope", assignedTo: operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(missingGap.ok).toBe(false);
    if (!missingGap.ok) expect(missingGap.error).toBe("not_found");

    const missingOp = await assignGap(
      store,
      { gapId: gap.id, assignedTo: "op_nope", assignedBy: "op_admin" },
      { operators },
    );
    expect(missingOp.ok).toBe(false);
    if (!missingOp.ok) {
      expect(missingOp.error).toBe("assignee_missing");
      expect(missingOp.field).toBe("assignedTo");
    }

    const svcId = await mkServiceOp(operators, "service");
    for (const nonHuman of [svcId, bg.id]) {
      const r = await assignGap(
        store,
        { gapId: gap.id, assignedTo: nonHuman, assignedBy: "op_admin" },
        { operators },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe("assignee_not_human");
    }

    // inactive human — B stays active so C5 lets A disable.
    const inactive = await seedOperator(operators, "Gone");
    const disabled = await operators.disableOperator(inactive.operatorId);
    expect(disabled.ok).toBe(true);
    const r2 = await assignGap(
      store,
      { gapId: gap.id, assignedTo: inactive.operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe("assignee_inactive");

    // terminal — RESOLVED needs a published linked item.
    const itemId = await mkPublishedItem(store, "escrow-answer");
    await triageGap(store, gap.id);
    const resolved = await resolveGap(store, gap.id, itemId);
    expect(resolved.ok).toBe(true);
    const term = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(term.ok).toBe(false);
    if (!term.ok) expect(term.error).toBe("gap_terminal");
  });

  it("assign validates dueAt shape (absolute timestamp, not duration)", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators);
    const r = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: "in 3 days" },
      { operators },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("bad_due_at");
      expect(r.field).toBe("dueAt");
    }
    // Naive ISO (no zone) parses as LOCAL time — must refuse (C3:
    // absolute UTC only). Same for a bare date.
    for (const bad of ["2026-12-01T00:00:00", "2026-12-01", "12/01/2026"]) {
      const naive = await assignGap(
        store,
        { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: bad },
        { operators },
      );
      expect(naive.ok).toBe(false);
      if (!naive.ok) expect(naive.error).toBe("bad_due_at");
    }
    // Explicit offsets are absolute too.
    const offset = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: "2026-12-01T03:00:00+03:00" },
      { operators },
    );
    expect(offset.ok).toBe(true);
  });

  it("anti-laundering: assign ≠ reassign path; dueAt moves only via setGapDueAt", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const a = await seedOperator(operators, "A");
    const b = await seedOperator(operators, "B");
    const due = "2026-12-10T00:00:00.000Z";
    await assignGap(
      store,
      { gapId: gap.id, assignedTo: a.operatorId, assignedBy: "op_admin", dueAt: due },
      { operators },
    );
    // Different owner via assignGap → already_assigned (reassign is
    // the path; it keeps dueAt).
    const hijack = await assignGap(
      store,
      { gapId: gap.id, assignedTo: b.operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) expect(hijack.error).toBe("already_assigned");
    // Same owner re-assert is idempotent — and can't touch dueAt.
    const reassert = await assignGap(
      store,
      { gapId: gap.id, assignedTo: a.operatorId, assignedBy: "op_admin", dueAt: "2027-01-01T00:00:00.000Z" },
      { operators },
    );
    expect(reassert.ok).toBe(false);
    if (!reassert.ok) {
      expect(reassert.error).toBe("due_at_change_needs_reason");
      expect(reassert.field).toBe("dueAt");
    }
    // unassign keeps dueAt; re-adding an owner keeps it too —
    // and explicitly changing it here is still refused.
    await unassignGap(store, { gapId: gap.id, actor: "op_admin" });
    const sneak = await assignGap(
      store,
      { gapId: gap.id, assignedTo: b.operatorId, assignedBy: "op_admin", dueAt: "2027-06-01T00:00:00.000Z" },
      { operators },
    );
    expect(sneak.ok).toBe(false);
    if (!sneak.ok) expect(sneak.error).toBe("due_at_change_needs_reason");
    const back = await assignGap(
      store,
      { gapId: gap.id, assignedTo: b.operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.gap.assignedTo).toBe(b.operatorId);
    expect(back.gap.dueAt).toBe(due); // launder-proof
  });

  it("reassign keeps dueAt; unassign clears the triple but keeps dueAt", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const a = await seedOperator(operators, "A");
    const b = await seedOperator(operators, "B");
    const due = "2026-12-05T12:00:00.000Z";
    await assignGap(
      store,
      { gapId: gap.id, assignedTo: a.operatorId, assignedBy: "op_admin", dueAt: due },
      { operators },
    );
    const re = await reassignGap(
      store,
      { gapId: gap.id, assignedTo: b.operatorId, assignedBy: "op_admin2" },
      { operators },
    );
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    expect(re.gap.assignedTo).toBe(b.operatorId);
    expect(re.gap.assignedBy).toBe("op_admin2");
    expect(re.gap.dueAt).toBe(due); // anti-laundering: deadline survives

    const un = await unassignGap(store, { gapId: gap.id, actor: "op_admin" });
    expect(un.ok).toBe(true);
    if (!un.ok) return;
    expect(un.gap.assignedTo).toBeNull();
    expect(un.gap.assignedBy).toBeNull();
    expect(un.gap.assignedAt).toBeNull();
    expect(un.gap.dueAt).toBe(due);
  });

  it("setGapDueAt requires reason; updates/clears the deadline; validates ts", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators);
    await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: "2026-12-01T00:00:00.000Z" },
      { operators },
    );

    const noReason = await setGapDueAt(store, {
      gapId: gap.id,
      dueAt: "2026-12-20T00:00:00.000Z",
      reason: "  ", actor: "op_admin",
    });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toBe("reason_required");

    const badTs = await setGapDueAt(store, {
      gapId: gap.id, dueAt: "tomorrow-ish", reason: "reprioritize", actor: "op_admin",
    });
    expect(badTs.ok).toBe(false);
    if (!badTs.ok) expect(badTs.error).toBe("bad_due_at");

    const moved = await setGapDueAt(store, {
      gapId: gap.id, dueAt: "2026-12-20T00:00:00.000Z", reason: "sprint slip", actor: "op_admin",
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.gap.dueAt).toBe("2026-12-20T00:00:00.000Z");
    expect(moved.gap.assignedTo).toBe(operatorId); // assignment untouched

    const cleared = await setGapDueAt(store, {
      gapId: gap.id, dueAt: null, reason: "deprioritized", actor: "op_admin",
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.gap.dueAt).toBeNull();
  });

  it("RESOLVED stamps resolvedAt; reopen clears it; WONTFIX refuses assign", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators);
    const itemId = await mkPublishedItem(store, "wontfix-answer");
    await triageGap(store, gap.id);
    const resolved = await resolveGap(store, gap.id, itemId);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.gap.resolvedAt).not.toBeNull();
    const stamp = resolved.gap.resolvedAt!;

    // same normalizedQuery → reopen; resolvedAt must clear.
    const again = await recordGap(store, {
      query: "how DOES escrow settlement WORK",
      source: "INTERACTION_SIGNAL",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reopened).toBe(true);
    expect(again.gap!.resolvedAt).toBeNull();
    expect(again.gap!.status).toBe("OPEN");

    // re-resolve then wontfix a second gap for the terminal pair.
    await triageGap(store, gap.id);
    await resolveGap(store, gap.id, itemId);
    const g2 = await recordGap(store, {
      query: "Why is the sky blue?", source: "MANUAL",
    });
    if (!g2.ok || !g2.gap) throw new Error("gap2 failed");
    await triageGap(store, g2.gap.id);
    const wf = await wontfixGap(store, g2.gap.id);
    expect(wf.ok).toBe(true);
    if (!wf.ok) return;
    expect(wf.gap.resolvedAt).toBeNull(); // WONTFIX ≠ resolved
    const term = await assignGap(
      store,
      { gapId: g2.gap.id, assignedTo: operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(term.ok).toBe(false);
    if (!term.ok) expect(term.error).toBe("gap_terminal");
    void stamp;
  });

  it("CAS: a claim landing mid-write → honest conflict, no lying event (264-12 review)", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators);
    // Inject a mid-flight owner BETWEEN the domain's pre-read and
    // the store write — the CAS must refuse rather than overwrite,
    // and no audit row claiming previousAssignee:null may mint.
    const inner = store.assignGap.bind(store);
    store.assignGap = async (id, input) => {
      const row = await store.getGap(id);
      if (row && row.assignedTo === null) row.assignedTo = "op_racer";
      return inner(id, input);
    };
    const r = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("conflict");
    expect(await store.listGapEvents(gap.id)).toEqual([]);
    // The racer's claim stands — conflict means "re-read + retry",
    // never a silent dispossession.
    expect((await store.getGap(gap.id))!.assignedTo).toBe("op_racer");
  });
});

/** Arc-264-16 audit fixes — the store-level CAS halves the domain
 *  pre-flight can't see (TOCTOU), plus the reopen ownership-clear. */
describe("gap ownership — Arc-264-16 hardening", () => {
  it("M3: expectedDueAt CAS — a deadline moved mid-write refuses", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators, "A");
    const { operatorId: op2 } = await seedOperator(operators, "B");
    const due = "2026-01-01T00:00:00.000Z";
    const a = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: due },
      { operators },
    );
    expect(a.ok).toBe(true);
    // Race: reassign pre-reads dueAt=D1; a concurrent setGapDueAt
    // lands D2 between read and write. Without the dueAt half of
    // the CAS, reassign writes D1 back over D2 — laundering.
    const inner = store.assignGap.bind(store);
    store.assignGap = async (id, input) => {
      const row = await store.getGap(id);
      if (row && row.dueAt === due) {
        row.dueAt = "2027-01-01T00:00:00.000Z"; // racer's deadline
      }
      return inner(id, input);
    };
    const r = await reassignGap(
      store,
      { gapId: gap.id, assignedTo: op2, assignedBy: "op_admin" },
      { operators },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("conflict");
    // The racer's deadline stands — the stale write-back never landed.
    expect((await store.getGap(gap.id))!.dueAt).toBe("2027-01-01T00:00:00.000Z");
    expect((await store.getGap(gap.id))!.assignedTo).toBe(operatorId);
  });

  it("M3: owner-install on a gap resolved mid-flight → conflict; unassign still cleans up", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators);
    // Gap is OPEN at pre-flight; resolve lands before the write.
    const inner = store.assignGap.bind(store);
    store.assignGap = async (id, input) => {
      const row = await store.getGap(id);
      if (row && row.status === "OPEN") row.status = "RESOLVED";
      return inner(id, input);
    };
    const r = await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin" },
      { operators },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("conflict");
    const after = (await store.getGap(gap.id))!;
    expect(after.status).toBe("RESOLVED");
    expect(after.assignedTo).toBeNull();
    // Owner-CLEARING writes stay allowed on a closed gap — give it
    // an owner directly (seed path, no CAS) then unassign.
    after.assignedTo = operatorId;
    const u = await unassignGap(store, { gapId: gap.id, actor: "op_admin" });
    expect(u.ok).toBe(true);
    expect((await store.getGap(gap.id))!.assignedTo).toBeNull();
  });

  it("M9: reopen clears the ownership tuple — no instant re-breach on the same generation", async () => {
    const { store, operators } = await mkStore();
    const gap = await mkGap(store);
    const { operatorId } = await seedOperator(operators);
    await assignGap(
      store,
      { gapId: gap.id, assignedTo: operatorId, assignedBy: "op_admin", dueAt: "2020-06-01T00:00:00.000Z" },
      { operators },
    );
    await triageGap(store, gap.id);
    const itemId = await mkPublishedItem(store, "reopen-answer");
    await resolveGap(store, gap.id, itemId);
    const again = await recordGap(store, {
      query: "how DOES escrow settlement WORK",
      source: "INTERACTION_SIGNAL",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.reopened).toBe(true);
    const g = again.gap!;
    expect(g.status).toBe("OPEN");
    expect(g.assignedTo).toBeNull();
    expect(g.assignedBy).toBeNull();
    expect(g.assignedAt).toBeNull();
    expect(g.dueAt).toBeNull(); // the 2020 deadline can't re-breach
  });
});