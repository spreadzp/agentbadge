/**
 * SLICE-201-1 (EPIC-201): universal task-model projection types.
 *
 * The "universal task" vocabulary of EPIC-201 (Task/Receipt/PaymentLeg) is a
 * projection over existing records — BoardCardRecord/BoardEntryRecord are NOT
 * modified (D-201-0, D-201-3). These tests pin the projection contract that
 * SLICE-201-2 (Task Receipt endpoint) will sign.
 */
import { describe, expect, it } from "vitest";
import type { BoardCardRecord, BoardEntryRecord } from "../src/server/lib/board/types";
import { computeSpecHash } from "../src/server/lib/board/types";
import {
  PaymentLegSchema,
  TaskReceiptInputSchema,
  TaskSnapshotSchema,
  toTaskSnapshot,
} from "../src/server/lib/board/task-model";

const SPEC = "## Fix flaky bounty e2e\nRun bunx vitest run until green.";

function mkCard(overrides: Partial<BoardCardRecord> = {}): BoardCardRecord {
  return {
    cardId: "board_abc123",
    bountyId: "bounty_1",
    column: "done",
    title: "Fix flaky e2e",
    budgetUsdc: "25.00",
    specHash: computeSpecHash(SPEC),
    spec: SPEC,
    createdBy: "ops",
    currentPassportId: "passport_77",
    createdAt: "2026-10-18T10:00:00.000Z",
    ...overrides,
  };
}

function mkEntry(overrides: Partial<BoardEntryRecord> = {}): BoardEntryRecord {
  return {
    id: "bent_1",
    cardId: "board_abc123",
    seq: 1,
    attempt: 1,
    kind: "claim",
    actor: "passport_77",
    atMs: 1_760_000_000_000,
    ...overrides,
  };
}

describe("TaskSnapshotSchema", () => {
  it("accepts a valid snapshot", () => {
    const snap = toTaskSnapshot(mkCard());
    expect(TaskSnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it("rejects a snapshot without specHash", () => {
    const snap = { ...toTaskSnapshot(mkCard()), specHash: undefined };
    expect(TaskSnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it("rejects a non-hex specHash", () => {
    const snap = toTaskSnapshot(mkCard());
    expect(
      TaskSnapshotSchema.safeParse({ ...snap, specHash: "not-hex" }).success,
    ).toBe(false);
  });
});

describe("toTaskSnapshot", () => {
  it("projects card fields without loss", () => {
    const card = mkCard();
    const snap = toTaskSnapshot(card);
    expect(snap.taskId).toBe(card.cardId);
    expect(snap.bountyId).toBe(card.bountyId);
    expect(snap.title).toBe(card.title);
    expect(snap.specHash).toBe(card.specHash);
    expect(snap.budgetUsdc).toBe("25.00");
    expect(snap.status).toBe("done");
    expect(snap.executorPassportId).toBe("passport_77");
    expect(snap.createdAt).toBe(card.createdAt);
  });

  it("defaults budgetUsdc to null when absent", () => {
    const snap = toTaskSnapshot(mkCard({ budgetUsdc: undefined }));
    expect(snap.budgetUsdc).toBeNull();
  });

  it("derives executor from the latest claim entry when card field is empty", () => {
    const card = mkCard({ currentPassportId: undefined });
    const entries = [
      mkEntry({ seq: 1, kind: "claim", actor: "passport_55", attempt: 1 }),
      mkEntry({ id: "bent_2", seq: 2, kind: "submit", actor: "passport_55", attempt: 1 }),
    ];
    const snap = toTaskSnapshot(card, entries);
    expect(snap.executorPassportId).toBe("passport_55");
    expect(snap.latestAttempt).toBe(1);
  });

  it("picks the highest attempt number across entries", () => {
    const card = mkCard();
    const entries = [
      mkEntry({ attempt: 1 }),
      mkEntry({ id: "bent_2", seq: 2, attempt: 3, kind: "reopen" }),
      mkEntry({ id: "bent_3", seq: 3, attempt: 2, kind: "qa" }),
    ];
    expect(toTaskSnapshot(card, entries).latestAttempt).toBe(3);
  });

  it("is deterministic — same input yields identical object", () => {
    const card = mkCard();
    const entries = [mkEntry()];
    expect(toTaskSnapshot(card, entries)).toEqual(toTaskSnapshot(card, entries));
  });
});

describe("PaymentLegSchema", () => {
  const leg = {
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    amountUsdc: "25.00",
    chainId: 5042002,
    txHash: "0x" + "ab".repeat(32),
  };

  it("accepts a valid leg", () => {
    expect(PaymentLegSchema.safeParse(leg).success).toBe(true);
  });

  it("rejects a bad address", () => {
    expect(
      PaymentLegSchema.safeParse({ ...leg, from: "0xzz" }).success,
    ).toBe(false);
  });

  it("rejects a non-hex txHash", () => {
    expect(
      PaymentLegSchema.safeParse({ ...leg, txHash: "tx_123" }).success,
    ).toBe(false);
  });
});

describe("TaskReceiptInputSchema", () => {
  it("accepts a complete receipt input", () => {
    const input = {
      task: toTaskSnapshot(mkCard()),
      attempt: 2,
      completedAt: "2026-10-18T12:00:00.000Z",
      txHashes: ["0x" + "cd".repeat(32)],
      verdictId: "0x" + "ef".repeat(32),
      payment: {
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        amountUsdc: "25.00",
        chainId: 5042002,
        txHash: "0x" + "ab".repeat(32),
      },
    };
    expect(TaskReceiptInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects when task snapshot is invalid", () => {
    const input = {
      task: { taskId: "board_abc123" }, // incomplete
      attempt: 1,
      completedAt: "2026-10-18T12:00:00.000Z",
      txHashes: [],
    };
    expect(TaskReceiptInputSchema.safeParse(input).success).toBe(false);
  });
});
