/**
 * SLICE-176-6 tests: spendApproval store — типы + state machine + бэкенды.
 *
 * Covered (per spec acceptance):
 *  - park → pending record (id, createdAt); queue cap → approval_queue_full
 *  - decide approve/reject → decidedBy/decidedAt; invalid transitions → false
 *  - consume: approved→consumed атомарно, single-use (повтор → false)
 *  - lazy expiry: pending + expiresAt<=now → expired на get/list/decide/consume
 *  - expireOverdue bulk-sweep + sweeper audit alert approval.expired
 *  - expired не может быть approved/consumed
 *  - json round-trip; sqlite parity когда bun:sqlite доступен
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createJsonApprovalStore,
  createMemoryApprovalStore,
  createSqliteApprovalStore,
  sweepExpiredApprovals,
  type ApprovalStore,
  type ApprovalState,
} from "../../src/server/lib/agent-wallet/approvals";
import {
  createMemorySpendAlertStore,
  initSpendAlerts,
} from "../../src/server/lib/agent-wallet/audit";

const W = "0x00000000000000000000000000000000000000b1";
const W2 = "0x00000000000000000000000000000000000000b2";

const input = (over: Record<string, unknown> = {}) => ({
  wallet: W as `0x${string}`,
  amountUsd: 5,
  kind: "eaas" as const,
  refId: "r1",
  expiresAt: Date.now() + 60_000,
  ...over,
});

/** Общий test-suite контракт — гоняется по каждому бэкенду. */
function storeSuite(label: string, mk: () => ApprovalStore) {
  describe(`approvals store: ${label}`, () => {
    it("park → pending с id/createdAt; get возвращает", async () => {
      const s = mk();
      const a = await s.park(input());
      expect(a.state).toBe("pending");
      expect(a.id).toMatch(/^ap_/);
      expect(a.createdAt).toBeGreaterThan(0);
      expect((await s.get(a.id))?.state).toBe("pending");
    });

    it("decide approve → approved + decidedBy/decidedAt", async () => {
      const s = mk();
      const a = await s.park(input());
      expect(await s.decide(a.id, "approve", W)).toBe(true);
      const got = (await s.get(a.id))!;
      expect(got.state).toBe("approved");
      expect(got.decidedBy).toBe(W);
      expect(got.decidedAt).toBeGreaterThan(0);
    });

    it("decide reject → rejected", async () => {
      const s = mk();
      const a = await s.park(input());
      expect(await s.decide(a.id, "reject", W)).toBe(true);
      expect((await s.get(a.id))!.state).toBe("rejected");
    });

    it("invalid transitions: decide на approved/rejected/consumed/unknown → false", async () => {
      const s = mk();
      const a = await s.park(input());
      await s.decide(a.id, "approve", W);
      expect(await s.decide(a.id, "reject", W)).toBe(false);
      const b = await s.park(input({ refId: "r2" }));
      await s.decide(b.id, "reject", W);
      expect(await s.decide(b.id, "approve", W)).toBe(false);
      expect(await s.decide("ap_nonexistent", "approve", W)).toBe(false);
      // consumed
      const cRec = await s.park(input({ refId: "r3" }));
      await s.decide(cRec.id, "approve", W);
      await s.consume(cRec.id);
      expect(await s.decide(cRec.id, "reject", W)).toBe(false);
    });

    it("consume: approved→consumed атомарно; повтор → false (single-use)", async () => {
      const s = mk();
      const a = await s.park(input());
      expect(await s.consume(a.id)).toBe(false); // pending не consume'ится
      await s.decide(a.id, "approve", W);
      expect(await s.consume(a.id)).toBe(true);
      const got = (await s.get(a.id))!;
      expect(got.state).toBe("consumed");
      expect(got.consumedAt).toBeGreaterThan(0);
      // гонка/повтор: второй consume → false
      expect(await s.consume(a.id)).toBe(false);
      expect(await s.consume(a.id)).toBe(false);
    });

    it("expired не может быть approved/consumed; lazy expiry на get", async () => {
      const s = mk();
      const a = await s.park(input({ expiresAt: Date.now() - 1 }));
      expect((await s.get(a.id))!.state).toBe("expired");
      expect(await s.decide(a.id, "approve", W)).toBe(false);
      expect(await s.consume(a.id)).toBe(false);
    });

    it("listByWallet: фильтр по state, только свой wallet", async () => {
      const s = mk();
      await s.park(input());
      const b = await s.park(input({ refId: "r2" }));
      await s.decide(b.id, "approve", W);
      await s.park(input({ wallet: W2 as `0x${string}`, refId: "other" }));

      const all = await s.listByWallet(W);
      expect(all.length).toBe(2);
      const pending = await s.listByWallet(W, "pending");
      expect(pending.length).toBe(1);
      const approved: ApprovalState[] = (await s.listByWallet(W, "approved"))
        .map((x) => x.state);
      expect(approved).toEqual(["approved"]);
    });

    it("countPending: считает только live pending", async () => {
      const s = mk();
      for (let i = 0; i < 2; i++) await s.park(input({ refId: `q${i}` }));
      expect(await s.countPending(W)).toBe(2);
      // не pending не считаются
      const d = await s.park(input({ refId: "q3" }));
      await s.decide(d.id, "reject", W);
      expect(await s.countPending(W)).toBe(2);
      // просроченный pending не считается (уже мёртв, ждёт sweep)
      await s.park(input({ refId: "q4", expiresAt: Date.now() - 1 }));
      expect(await s.countPending(W)).toBe(2);
    });

    it("expireOverdue: bulk pending→expired, возвращает новые", async () => {
      const s = mk();
      const live = await s.park(input());
      await s.park(input({ refId: "old", expiresAt: Date.now() - 5 }));
      const expired = await s.expireOverdue(Date.now());
      expect(expired.length).toBe(1);
      expect(expired[0].refId).toBe("old");
      expect((await s.get(live.id))!.state).toBe("pending");
      // повторный sweep — ничего нового
      expect((await s.expireOverdue(Date.now())).length).toBe(0);
    });
  });
}

/**
 * SLICE-257-4 fingerprint suite — D-257-Q6 find-or-create by
 * (wallet, dealFingerprint, pending) + fingerprint-bound consume.
 * Runs on every backend via the same harness as storeSuite.
 */
const FP = "sha256:v1:aaa111";
const FP2 = "sha256:v1:bbb222";

function fpSuite(label: string, mk: () => ApprovalStore) {
  describe(`approvals fingerprint dedup: ${label}`, () => {
    it("same (wallet, fp) re-park → SAME pending record, no dup", async () => {
      const s = mk();
      const a = await s.park(input({ dealFingerprint: FP }));
      const b = await s.park(input({ dealFingerprint: FP, refId: "other" }));
      expect(b.id).toBe(a.id);
      expect(b.refId).toBe("r1"); // existing record returned as-is
      expect(await s.countPending(W)).toBe(1);
      expect(await s.listByWallet(W)).toHaveLength(1);
    });

    it("same fp on ANOTHER wallet → separate records", async () => {
      const s = mk();
      const a = await s.park(input({ dealFingerprint: FP }));
      const b = await s.park(
        input({ wallet: W2 as `0x${string}`, dealFingerprint: FP }),
      );
      expect(b.id).not.toBe(a.id);
      expect(await s.countPending(W2)).toBe(1);
    });

    it("different fp same wallet → separate records", async () => {
      const s = mk();
      const a = await s.park(input({ dealFingerprint: FP }));
      const b = await s.park(input({ dealFingerprint: FP2 }));
      expect(b.id).not.toBe(a.id);
      expect(await s.countPending(W)).toBe(2);
    });

    it("decided pending no longer dedups — same fp parks fresh", async () => {
      const s = mk();
      const a = await s.park(input({ dealFingerprint: FP }));
      await s.decide(a.id, "reject", W);
      const b = await s.park(input({ dealFingerprint: FP }));
      expect(b.id).not.toBe(a.id);
    });

    it("expired-but-unswept pending does NOT dedup — new park wins", async () => {
      const s = mk();
      const a = await s.park(
        input({ dealFingerprint: FP, expiresAt: Date.now() - 1 }),
      );
      const b = await s.park(input({ dealFingerprint: FP }));
      expect(b.id).not.toBe(a.id);
      expect((await s.get(b.id))!.state).toBe("pending");
    });

    it("parked record keeps reason/fingerprint/meta verbatim on get+list", async () => {
      const s = mk();
      const meta = {
        verdict: "WARN",
        reasonCodes: ["young_resource"],
        checkedAt: "2026-01-01T00:00:00Z",
      };
      const a = await s.park(
        input({
          approvalReason: "counterparty_warn",
          dealFingerprint: FP,
          fingerprintVersion: 1,
          meta,
        }),
      );
      const got = (await s.get(a.id))!;
      expect(got.approvalReason).toBe("counterparty_warn");
      expect(got.dealFingerprint).toBe(FP);
      expect(got.fingerprintVersion).toBe(1);
      expect(got.meta).toEqual(meta);
      expect((await s.listByWallet(W))[0].meta).toEqual(meta);
    });

    it("consume(id, fp): mismatch refuses WITHOUT consuming; match consumes", async () => {
      const s = mk();
      const a = await s.park(input({ dealFingerprint: FP }));
      await s.decide(a.id, "approve", W);
      // wrong fingerprint → refusal, permit still approved
      expect(await s.consume(a.id, FP2)).toBe(false);
      expect((await s.get(a.id))!.state).toBe("approved");
      // right fingerprint → single-use consume
      expect(await s.consume(a.id, FP)).toBe(true);
      expect((await s.get(a.id))!.state).toBe("consumed");
    });

    it("consume(id) w/o fingerprint stays legacy-unconditional (amount holds)", async () => {
      const s = mk();
      const a = await s.park(input({ dealFingerprint: FP }));
      await s.decide(a.id, "approve", W);
      expect(await s.consume(a.id)).toBe(true);
    });

    it("fingerprint-less records never match a provided fingerprint", async () => {
      const s = mk();
      const a = await s.park(input()); // amount-hold: no fp
      await s.decide(a.id, "approve", W);
      expect(await s.consume(a.id, FP)).toBe(false);
      expect(await s.consume(a.id)).toBe(true);
    });
  });
}

storeSuite("memory", () => createMemoryApprovalStore());
fpSuite("memory", () => createMemoryApprovalStore());

describe("approvals fingerprint dedup — cap interplay (memory)", () => {
  it("dedup hit beats the queue cap; a NEW fp at full queue still throws", async () => {
    const s = createMemoryApprovalStore(1);
    const a = await s.park(input({ dealFingerprint: FP }));
    // queue is full (1/1) — re-park of the SAME deal dedups, not errors
    expect((await s.park(input({ dealFingerprint: FP }))).id).toBe(a.id);
    // a genuinely new hold still hits the cap
    await expect(s.park(input({ dealFingerprint: FP2 }))).rejects.toThrow(
      "approval_queue_full",
    );
  });
});

fpSuite("json", () =>
  createJsonApprovalStore(
    join(mkdtempSync(join(tmpdir(), "appr-fp-json-")), "approvals.json"),
  ),
);

describe("approvals store: json round-trip", () => {
  const dir = mkdtempSync(join(tmpdir(), "appr-"));
  const path = join(dir, "approvals.json");
  afterEach(() => {
    if (existsSync(path)) rmSync(path);
  });
  it("persist + reload: state выживает рестарт", async () => {
    const s1 = createJsonApprovalStore(path);
    const a = await s1.park(input());
    await s1.decide(a.id, "approve", W);
    const s2 = createJsonApprovalStore(path);
    const got = (await s2.get(a.id))!;
    expect(got.state).toBe("approved");
    expect(got.decidedBy).toBe(W);
  });
  it("consume atomicity через reload", async () => {
    const s1 = createJsonApprovalStore(path);
    const a = await s1.park(input());
    await s1.decide(a.id, "approve", W);
    const s2 = createJsonApprovalStore(path);
    expect(await s2.consume(a.id)).toBe(true);
    expect(await s2.consume(a.id)).toBe(false);
  });
});

// bun:sqlite Bun-only — под node/vitest factory отдаёт null → skip.
const sqlite = createSqliteApprovalStore(
  join(mkdtempSync(join(tmpdir(), "appr-sqlite-")), "approvals.db"),
);
if (sqlite) {
  storeSuite("sqlite", () => sqlite);
  fpSuite("sqlite", () => sqlite);
}

describe("queue cap via factory + sweeper", () => {
  it("park сверх maxPending бросает approval_queue_full", async () => {
    const s = createMemoryApprovalStore(2);
    await s.park(input());
    await s.park(input({ refId: "r2" }));
    await expect(s.park(input({ refId: "r3" }))).rejects.toThrow(
      "approval_queue_full",
    );
  });

  it("sweeper: expired → approval.expired audit alert (per record)", async () => {
    const alertStore = createMemorySpendAlertStore();
    initSpendAlerts({ store: alertStore });
    const s = createMemoryApprovalStore();
    await s.park(input({ expiresAt: Date.now() - 10, refId: "dead1" }));
    await s.park(input({ expiresAt: Date.now() - 10, refId: "dead2" }));
    await s.park(input()); // live

    const n = await sweepExpiredApprovals({ store: s });
    expect(n).toBe(2);
    const evs = await alertStore.list({ type: "approval.expired" });
    expect(evs.length).toBe(2);
    expect(evs.map((e) => e.data.refId).sort()).toEqual(["dead1", "dead2"]);
  });

  it("sweeper с wallet-venueId'ом в alert'е не падает без venue", async () => {
    const s = createMemoryApprovalStore();
    await s.park(input({ expiresAt: Date.now() - 1 }));
    expect(await sweepExpiredApprovals({ store: s })).toBe(1);
  });
});

beforeEach(() => {
  initSpendAlerts(null);
});
afterEach(() => {
  initSpendAlerts(null);
});
