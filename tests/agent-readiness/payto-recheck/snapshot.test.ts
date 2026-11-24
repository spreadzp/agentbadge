// SLICE-258-18: proofSnapshotFromInputs — adapter contract.
import { describe, expect, it } from "vitest";
import type { ProofEntry } from "@agentbadge/x402-payto-proof";
import {
  proofSnapshotFromInputs,
  RECHECK_SCHEMA_VERSION,
} from "../../../src/agent-readiness/payto-recheck";

const D = "example.com";
const A = "0xAAAABBBBCCCCDDDDEEEEFFFF0000111122223333"; // mixed case → normalized
const B = "0x1111222233334444555566667777888899990000";

const ent = (address: string, over: Partial<ProofEntry> = {}): ProofEntry => ({
  address,
  source: "dns",
  ...over,
});

const base = {
  domain: D,
  dnsEntries: [ent(A)],
  siteEntries: [ent(B)],
  dnsState: "ok" as const,
  siteState: "ok" as const,
  dnsHitName: `_x402-payto.${D}`,
  liveRecheckDone: true,
  observedAt: "2026-11-24T12:00:00Z",
};

describe("proofSnapshotFromInputs", () => {
  it("flattens both tiers with normalized payTo + scope identity", () => {
    const s = proofSnapshotFromInputs(base);
    expect(s.schema_version).toBe(RECHECK_SCHEMA_VERSION);
    expect(s.entries).toHaveLength(2);
    const [d, w] = s.entries;
    expect(d!.payTo).toBe(A.toLowerCase());
    expect(d!.source).toBe("dns");
    expect(d!.scope_name).toBe(`_x402-payto.${D}`);
    expect(d!.signature_status).toBe("none"); // unsigned record
    expect(w!.source).toBe("site");
    expect(w!.scope_name).toBe(D);
  });

  it("child-scope hit-name becomes the entry scope (child≠parent identity)", () => {
    const s = proofSnapshotFromInputs({
      ...base,
      siteEntries: [],
      dnsHitName: `_x402-payto.api.${D}`,
    });
    expect(s.entries[0]!.scope_name).toBe(`_x402-payto.api.${D}`);
    expect(s.dns_hit_name).toBe(`_x402-payto.api.${D}`);
  });

  it("absence_confirmed requires live recheck AND dns ok — cache hits never confirm", () => {
    expect(proofSnapshotFromInputs(base).absence_confirmed).toBe(true);
    expect(
      proofSnapshotFromInputs({ ...base, liveRecheckDone: false })
        .absence_confirmed,
    ).toBe(false);
    expect(
      proofSnapshotFromInputs({ ...base, dnsState: "unchecked" })
        .absence_confirmed,
    ).toBe(false);
    expect(
      proofSnapshotFromInputs({ ...base, liveRecheckDone: undefined })
        .absence_confirmed,
    ).toBe(false);
  });
});
