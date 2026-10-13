import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMemoryWitnessStore,
  WITNESS_SEATS_PER_JOB,
  type WitnessAttestation,
  type WitnessEnroll,
  type WitnessStore,
} from "../src/server/lib/witness/store";
import { createJsonWitnessStore } from "../src/server/lib/witness/store-json";
import { enrollWitness } from "../src/server/lib/witness/enroll";

const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";

function makeEnroll(overrides: Partial<WitnessEnroll> = {}): WitnessEnroll {
  return {
    agentId: "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:1",
    domains: ["scan"],
    wallet: WALLET_A,
    enrolledAt: 1000,
    status: "active",
    ...overrides,
  };
}

function makeAttestation(
  overrides: Partial<WitnessAttestation> = {},
): WitnessAttestation {
  return {
    jobId: "job-1",
    agentId: "agent-1",
    verdict: "pass",
    contentSha256: `0x${"a".repeat(64)}`,
    reason: "looks correct",
    attestedAt: new Date(1000).toISOString(),
    signature: `0x${"b".repeat(130)}`,
    ...overrides,
  };
}

/* --------------------------- store conformance --------------------------- */

function conformance(
  backendName: string,
  makeStore: () => WitnessStore,
  cleanup?: () => void,
) {
  describe(`WitnessStore conformance [${backendName}]`, () => {
    let store: WitnessStore;
    beforeEach(() => {
      store = makeStore();
    });
    afterEach(() => cleanup?.());

    it("putEnroll → getEnroll round-trips the record", async () => {
      const rec = makeEnroll();
      expect(await store.putEnroll(rec)).toBe(true);
      expect(await store.getEnroll(rec.agentId)).toEqual(rec);
    });

    it("getEnroll returns undefined for unknown agentId", async () => {
      expect(await store.getEnroll("nope")).toBeUndefined();
    });

    it("putEnroll rejects a duplicate agentId atomically", async () => {
      const rec = makeEnroll();
      await store.putEnroll(rec);
      const dup = await store.putEnroll(
        makeEnroll({ wallet: WALLET_B, domains: ["code"] }),
      );
      expect(dup).toBe(false);
      // wallet is immutable once enrolled
      expect((await store.getEnroll(rec.agentId))?.wallet).toBe(WALLET_A);
    });

    it("suspendEnroll flips status, idempotent, false on unknown", async () => {
      const rec = makeEnroll();
      await store.putEnroll(rec);
      expect(await store.suspendEnroll(rec.agentId)).toBe(true);
      expect((await store.getEnroll(rec.agentId))?.status).toBe("suspended");
      expect(await store.suspendEnroll(rec.agentId)).toBe(true);
      expect(await store.suspendEnroll("nope")).toBe(false);
    });

    it("claimSeat grants seats up to WITNESS_SEATS_PER_JOB then no_seats", async () => {
      const exp = Date.now() + 3600_000;
      expect(await store.claimSeat("j1", "a1", exp)).toBe("claimed");
      expect(await store.claimSeat("j1", "a2", exp)).toBe("claimed");
      expect(await store.claimSeat("j1", "a3", exp)).toBe("no_seats");
      const seats = await store.listSeats("j1");
      expect(seats).toHaveLength(WITNESS_SEATS_PER_JOB);
      expect(seats.map((s) => s.seatNo).sort()).toEqual([1, 2]);
    });

    it("parallel claimSeat race → exactly WITNESS_SEATS_PER_JOB winners", async () => {
      const exp = Date.now() + 3600_000;
      const results = await Promise.all(
        ["a1", "a2", "a3", "a4", "a5"].map((id) =>
          store.claimSeat("race-job", id, exp),
        ),
      );
      expect(results.filter((r) => r === "claimed")).toHaveLength(
        WITNESS_SEATS_PER_JOB,
      );
      expect(results.filter((r) => r === "no_seats")).toHaveLength(
        5 - WITNESS_SEATS_PER_JOB,
      );
    });

    it("claimSeat is idempotent per agent (already_seated)", async () => {
      const exp = Date.now() + 3600_000;
      await store.claimSeat("j2", "a1", exp);
      expect(await store.claimSeat("j2", "a1", exp)).toBe("already_seated");
      expect(await store.listSeats("j2")).toHaveLength(1);
    });

    it("claimSeat after attestation → already_attested", async () => {
      const exp = Date.now() + 3600_000;
      await store.claimSeat("j3", "a1", exp);
      await store.putAttestation(makeAttestation({ jobId: "j3", agentId: "a1" }));
      expect(await store.claimSeat("j3", "a1", exp)).toBe("already_attested");
    });

    it("claimSeat refuses once the window is closed", async () => {
      const past = Date.now() - 1;
      expect(await store.claimSeat("j4", "a1", past)).toBe("window_closed");
      expect(await store.listSeats("j4")).toHaveLength(0);
    });

    it("seat expiry does not release the seat (v1: no re-release)", async () => {
      // seat claimed, window later passes — seat record stays claimed
      const exp = Date.now() + 5;
      await store.claimSeat("j5", "a1", exp);
      await new Promise((r) => setTimeout(r, 10));
      const seats = await store.listSeats("j5");
      expect(seats).toHaveLength(1);
      expect(seats[0]?.claimed).toBe(true);
      // and a different agent still cannot claim past the window
      expect(await store.claimSeat("j5", "a2", exp)).toBe("window_closed");
    });

    it("putAttestation → get/list round-trip; duplicate rejected", async () => {
      const att = makeAttestation({ jobId: "j6", agentId: "a1" });
      expect(await store.putAttestation(att)).toBe(true);
      expect(await store.getAttestation("j6", "a1")).toEqual(att);
      expect(await store.putAttestation(att)).toBe(false);
      await store.putAttestation(makeAttestation({ jobId: "j6", agentId: "a2" }));
      expect(await store.listAttestations("j6")).toHaveLength(2);
      expect(await store.listAttestations("other")).toHaveLength(0);
    });

    it("incrDailyCredits counts per agentId+dayKey independently", async () => {
      expect(await store.incrDailyCredits("a1", "2026-10-13")).toBe(1);
      expect(await store.incrDailyCredits("a1", "2026-10-13")).toBe(2);
      expect(await store.incrDailyCredits("a2", "2026-10-13")).toBe(1);
      expect(await store.incrDailyCredits("a1", "2026-10-14")).toBe(1);
    });
  });
}

let tmpDir: string | undefined;
conformance("memory", () => createMemoryWitnessStore());
conformance(
  "json",
  () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agb-wit-"));
    return createJsonWitnessStore(join(tmpDir, "witness.json"));
  },
  () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  },
);

describe("json store persistence", () => {
  it("survives re-instantiation on the same file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agb-wit-"));
    try {
      const path = join(dir, "witness.json");
      await createJsonWitnessStore(path).putEnroll(makeEnroll());
      const reloaded = createJsonWitnessStore(path);
      expect(await reloaded.getEnroll(makeEnroll().agentId)).toEqual(
        makeEnroll(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------- enroll ---------------------------------- */

describe("enrollWitness", () => {
  let store: WitnessStore;
  beforeEach(() => {
    store = createMemoryWitnessStore();
  });

  it("enrolls with valid domains + wallet (checksummed)", async () => {
    const res = await enrollWitness(store, {
      agentId: "agent-1",
      domains: ["scan", "data"],
      wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.record.status).toBe("active");
      expect(res.record.wallet).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
    }
  });

  it("dedupes domains and rejects empty/oversized/unknown domains", async () => {
    const dup = await enrollWitness(store, {
      agentId: "a1",
      domains: ["scan", "scan", "generic"],
      wallet: WALLET_A,
    });
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.record.domains).toEqual(["scan", "generic"]);

    const empty = await enrollWitness(store, {
      agentId: "a2",
      domains: [],
      wallet: WALLET_A,
    });
    expect(empty).toEqual({ ok: false, code: "witness_invalid_domains" });
    const bogus = await enrollWitness(store, {
      agentId: "a3",
      domains: ["scan", "bogus"],
      wallet: WALLET_A,
    });
    expect(bogus).toEqual({ ok: false, code: "witness_invalid_domains" });
    const oversized = await enrollWitness(store, {
      agentId: "a4",
      domains: Array(9).fill("scan"),
      wallet: WALLET_A,
    });
    expect(oversized).toEqual({ ok: false, code: "witness_invalid_domains" });
  });

  it("rejects an invalid wallet address", async () => {
    const res = await enrollWitness(store, {
      agentId: "a1",
      domains: ["scan"],
      wallet: "not-an-address",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("witness_invalid_wallet");
  });

  it("duplicate enroll → witness_already_enrolled; wallet immutable", async () => {
    await enrollWitness(store, {
      agentId: "a1",
      domains: ["scan"],
      wallet: WALLET_A,
    });
    const res = await enrollWitness(store, {
      agentId: "a1",
      domains: ["code"],
      wallet: WALLET_B,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("witness_already_enrolled");
    expect((await store.getEnroll("a1"))?.wallet).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });
});
