/**
 * SLICE-176-1 tests: owner-control fields in SpendCaps + validation +
 * deny codes. Foundation slice — schema/validation only, no behavior.
 *
 * Covered (per spec acceptance):
 *  - validateCaps accepts new fields (approvalAboveUsd, maxTxPerHour,
 *    maxAmountPerHour, allowedKinds) in valid combos
 *  - rejects non-numeric/negative numeric fields; maxTxPerHour must be
 *    integer ≥1
 *  - allowedKinds ⊆ SpendKind; invalid kind → error; empty array →
 *    error (unset = allow-all, empty = forbidden)
 *  - approvalAboveUsd does NOT join the monotonic cap chain
 *  - backward compat: old caps objects validate as before
 *  - ErrorCodes exposes the six 176 deny codes (snake_case wire values)
 *  - AgentWalletRecord carries optional `suspended` flag (round-trips
 *    through the memory store)
 */
import { describe, it, expect } from "vitest";

import { validateCaps } from "../src/server/lib/agent-wallet/envelope";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../src/server/lib/agent-wallet/registry";
import { ErrorCodes } from "../src/server/lib/error-codes";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;

describe("validateCaps — owner-control fields", () => {
  it("accepts all new fields with valid values", () => {
    const caps = validateCaps({
      approvalAboveUsd: 25,
      maxTxPerHour: 10,
      maxAmountPerHour: 100,
      allowedKinds: ["x402", "eaas"],
    });
    expect(caps.approvalAboveUsd).toBe(25);
    expect(caps.maxTxPerHour).toBe(10);
    expect(caps.maxAmountPerHour).toBe(100);
    expect(caps.allowedKinds).toEqual(["x402", "eaas"]);
  });

  it("accepts zero for USD threshold fields", () => {
    const caps = validateCaps({
      approvalAboveUsd: 0,
      maxAmountPerHour: 0,
    });
    expect(caps.approvalAboveUsd).toBe(0);
    expect(caps.maxAmountPerHour).toBe(0);
  });

  it("rejects negative and non-numeric approvalAboveUsd", () => {
    expect(() => validateCaps({ approvalAboveUsd: -1 })).toThrow(
      /approvalAboveUsd/,
    );
    expect(() => validateCaps({ approvalAboveUsd: "ten" })).toThrow(
      /approvalAboveUsd/,
    );
    expect(() => validateCaps({ approvalAboveUsd: NaN })).toThrow(
      /approvalAboveUsd/,
    );
  });

  it("rejects negative and non-numeric maxAmountPerHour", () => {
    expect(() => validateCaps({ maxAmountPerHour: -5 })).toThrow(
      /maxAmountPerHour/,
    );
    expect(() => validateCaps({ maxAmountPerHour: {} })).toThrow(
      /maxAmountPerHour/,
    );
  });

  it("requires maxTxPerHour to be an integer ≥1", () => {
    expect(() => validateCaps({ maxTxPerHour: 0 })).toThrow(/maxTxPerHour/);
    expect(() => validateCaps({ maxTxPerHour: -2 })).toThrow(/maxTxPerHour/);
    expect(() => validateCaps({ maxTxPerHour: 1.5 })).toThrow(/maxTxPerHour/);
    expect(() => validateCaps({ maxTxPerHour: "many" })).toThrow(
      /maxTxPerHour/,
    );
    expect(validateCaps({ maxTxPerHour: 1 }).maxTxPerHour).toBe(1);
  });

  it("accepts allowedKinds ⊆ SpendKind, rejects unknown kinds", () => {
    expect(
      validateCaps({ allowedKinds: ["venue-fee"] }).allowedKinds,
    ).toEqual(["venue-fee"]);
    expect(() =>
      validateCaps({ allowedKinds: ["x402", "casino"] }),
    ).toThrow(/allowedKinds/);
    expect(() => validateCaps({ allowedKinds: [42] })).toThrow(
      /allowedKinds/,
    );
    expect(() => validateCaps({ allowedKinds: "x402" })).toThrow(
      /allowedKinds/,
    );
  });

  it("rejects empty allowedKinds array — unset is allow-all, empty is forbidden", () => {
    expect(() => validateCaps({ allowedKinds: [] })).toThrow(/allowedKinds/);
    // unset is fine
    expect(validateCaps({}).allowedKinds).toBeUndefined();
  });

  it("approvalAboveUsd is a hold threshold, not part of the monotonic chain", () => {
    // approvalAboveUsd above perTxUsd is legal — it is a gate, not a cap
    const caps = validateCaps({
      perTxUsd: 5,
      dailyUsd: 20,
      approvalAboveUsd: 15,
    });
    expect(caps.approvalAboveUsd).toBe(15);
  });

  it("keeps backward compat: legacy caps validate and stay monotonic", () => {
    const caps = validateCaps({
      perTxUsd: 1,
      dailyUsd: 10,
      weeklyUsd: 50,
      monthlyUsd: 150,
    });
    expect(caps.perTxUsd).toBe(1);
    expect(() =>
      validateCaps({ perTxUsd: 100, dailyUsd: 10 }),
    ).toThrow(/monotonic/);
    expect(() => validateCaps({ dailyUsd: -1 })).toThrow(/dailyUsd/);
    expect(() => validateCaps(null)).toThrow();
    expect(() => validateCaps("caps")).toThrow();
  });
});

describe("owner-control deny codes", () => {
  it("exposes all six codes with snake_case wire values", () => {
    expect(ErrorCodes.APPROVAL_REQUIRED).toBe("approval_required");
    expect(ErrorCodes.SPEND_SUSPENDED).toBe("spend_suspended");
    expect(ErrorCodes.VELOCITY_TX).toBe("velocity_tx");
    expect(ErrorCodes.VELOCITY_AMOUNT).toBe("velocity_amount");
    expect(ErrorCodes.KIND_NOT_ALLOWED).toBe("kind_not_allowed");
    expect(ErrorCodes.APPROVAL_QUEUE_FULL).toBe("approval_queue_full");
  });
});

describe("wallet record suspended flag", () => {
  it("round-trips through the store", async () => {
    const store = createMemoryAgentWalletStore();
    const rec: AgentWalletRecord = {
      address: W,
      label: "w1",
      kind: "eoa",
      envelope: {},
      registeredBy: W,
      createdAt: Date.now(),
      active: true,
      suspended: true,
    };
    await store.put(rec);
    expect((await store.get(W))?.suspended).toBe(true);
    // unset stays undefined (not suspended)
    await store.put({ ...rec, suspended: undefined });
    expect((await store.get(W))?.suspended).toBeUndefined();
  });
});
