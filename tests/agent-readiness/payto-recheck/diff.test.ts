// SLICE-258-18: diffPaytoReports transition matrix — every class of
// the revocation ontology (D-258-Q20) + the advisor's 4 countercases.
import { describe, expect, it } from "vitest";
import {
  diffPaytoReports,
  RECHECK_SCHEMA_VERSION,
  type ProofSetEntry,
  type ProofSetSnapshot,
} from "../../../src/agent-readiness/payto-recheck";

const D = "example.com";
const A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const B = "0x1111222233334444555566667777888899990000";
const C = "0x9999888877776666555544443333222211110000";

const T1 = "2026-11-20T12:00:00Z";
const T2 = "2026-11-24T12:00:00Z";

const dns = (
  payTo: string,
  scope = `_x402-payto.${D}`,
  over: Partial<ProofSetEntry> = {},
): ProofSetEntry => ({ payTo, source: "dns", scope_name: scope, ...over });

const site = (
  payTo: string,
  over: Partial<ProofSetEntry> = {},
): ProofSetEntry => ({ payTo, source: "site", scope_name: D, ...over });

function snap(over: Partial<ProofSetSnapshot> = {}): ProofSetSnapshot {
  return {
    schema_version: RECHECK_SCHEMA_VERSION,
    domain: D,
    observed_at: T2,
    dns_state: "ok",
    site_state: "absent",
    dns_hit_name: `_x402-payto.${D}`,
    entries: [],
    absence_confirmed: true,
    ...over,
  };
}

const kinds = (r: ReturnType<typeof diffPaytoReports>) =>
  r.comparable ? r.transitions.map((t) => t.kind) : [];

describe("diffPaytoReports — comparability gate (D-258-Q26)", () => {
  const base = snap({ entries: [dns(A)] });

  it("different domain → not comparable, never a drop", () => {
    const r = diffPaytoReports(base, snap({ domain: "other.com" }));
    expect(r.comparable).toBe(false);
    if (!r.comparable) expect(r.reason).toBe("domain_mismatch");
  });

  it("schema version mismatch → not comparable", () => {
    const r = diffPaytoReports(base, snap({ schema_version: 99 }));
    expect(r.comparable).toBe(false);
    if (!r.comparable) expect(r.reason).toBe("schema_version_mismatch");
  });

  it("cur not strictly later → not comparable (equal stamps too)", () => {
    const r1 = diffPaytoReports(base, snap({ observed_at: T1 }));
    expect(r1.comparable).toBe(false);
    const r2 = diffPaytoReports(base, snap({ observed_at: T1 }));
    expect(r2.comparable).toBe(false);
  });
});

describe("diffPaytoReports — stable classes", () => {
  it("same member → still_verified", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A)] }),
      snap({ entries: [dns(A)] }),
    );
    expect(r.comparable).toBe(true);
    expect(kinds(r)).toEqual(["still_verified"]);
    if (r.comparable) expect(r.summary).toBe("stable");
  });

  it("empty → empty → still_absent marker", () => {
    const r = diffPaytoReports(snap({ observed_at: T1 }), snap());
    expect(kinds(r)).toEqual(["still_absent"]);
  });

  it("absent → proven → newly_proven (info)", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1 }),
      snap({ entries: [dns(A)] }),
    );
    expect(kinds(r)).toEqual(["newly_proven"]);
    if (r.comparable) expect(r.summary).toBe("unchanged_info");
  });
});

describe("diffPaytoReports — DROPPED only on confirmed absence", () => {
  it("proven → confirmed absent → DROPPED (medium, evidence dates)", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A)] }),
      snap(),
    );
    expect(kinds(r)).toEqual(["DROPPED"]);
    if (r.comparable) {
      expect(r.summary).toBe("changed");
      const t = r.transitions[0]!;
      expect(t.severity).toBe("medium");
      expect(t.previously_verified_at).toBe(T1);
      expect(t.currently_observed_at).toBe(T2);
      expect(t.note).toContain("was proven 2026-11-20");
      expect(t.note).toContain("absent 2026-11-24");
      expect(t.note).toContain("possible rotation or compromise");
    }
  });

  it("proven → SERVFAIL/unchecked → recheck_unchecked, NEVER dropped", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A)] }),
      snap({ dns_state: "unchecked", site_state: "unchecked", absence_confirmed: false }),
    );
    expect(kinds(r)).toEqual(["recheck_unchecked"]);
    if (r.comparable) {
      expect(r.summary).toBe("unchecked");
      expect(r.transitions[0]!.note).toContain("NOT a revocation");
    }
  });

  it("unconfirmed absence (no absence_confirmed, resolver flap) → unchecked", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A)] }),
      snap({ dns_state: "unchecked", absence_confirmed: false }),
    );
    expect(kinds(r)).toEqual(["recheck_unchecked"]);
  });
});

describe("diffPaytoReports — ROTATED / REAPPEARED / SCOPE_CHANGED / CONFLICT", () => {
  it("old dropped + new appeared → ROTATED both ways", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A)] }),
      snap({ entries: [dns(B)] }),
    );
    expect(kinds(r).sort()).toEqual(["ROTATED", "ROTATED"].sort());
    if (r.comparable) {
      const old = r.transitions.find((t) => t.payTo === A.toLowerCase())!;
      const neu = r.transitions.find((t) => t.payTo === B.toLowerCase())!;
      expect(old.replaced_by).toBe(B.toLowerCase());
      expect(neu.replaces).toBe(A.toLowerCase());
    }
  });

  it("knownDropped + payTo back → REAPPEARED overrides newly_proven", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1 }), // already absent — the drop happened earlier
      snap({ entries: [dns(A)] }),
      { knownDropped: [A] },
    );
    expect(kinds(r)).toEqual(["REAPPEARED"]);
  });

  it("child→parent move, same payTo → SCOPE_CHANGED not still", () => {
    const r = diffPaytoReports(
      snap({
        observed_at: T1,
        dns_hit_name: `_x402-payto.api.${D}`,
        entries: [dns(A, `_x402-payto.api.${D}`)],
      }),
      snap({ entries: [dns(A)] }), // now at parent scope
    );
    expect(kinds(r)).toEqual(["SCOPE_CHANGED"]);
    if (r.comparable) {
      const t = r.transitions[0]!;
      expect(t.from_scope).toBe(`dns|_x402-payto.api.${D}`);
      expect(t.to_scope).toBe(`dns|_x402-payto.${D}`);
    }
  });

  it("signature valid→invalid on same identity → CONFLICT", () => {
    const r = diffPaytoReports(
      snap({
        observed_at: T1,
        entries: [dns(A, undefined, { signature_status: "valid" })],
      }),
      snap({
        entries: [dns(A, undefined, { signature_status: "invalid" })],
      }),
    );
    expect(kinds(r)).toEqual(["CONFLICT"]);
    if (r.comparable) expect(r.transitions[0]!.severity).toBe("medium");
  });
});

describe("diffPaytoReports — advisor's 4 countercases (round-4)", () => {
  it("child→A + parent→A, child deleted but parent→A stays: SCOPE_CHANGED for child, still for parent — NOT dropped", () => {
    const r = diffPaytoReports(
      snap({
        observed_at: T1,
        entries: [dns(A, `_x402-payto.api.${D}`), dns(A)],
      }),
      snap({ entries: [dns(A)] }), // only parent remains
    );
    const ks = kinds(r).sort();
    expect(ks).toEqual(["SCOPE_CHANGED", "still_verified"].sort());
    expect(kinds(r)).not.toContain("DROPPED");
  });

  it("child→A + parent→A → child gone, parent→B: A is dropped-confirmed AND B is new — scope identity preserved", () => {
    const r = diffPaytoReports(
      snap({
        observed_at: T1,
        entries: [dns(A, `_x402-payto.api.${D}`), dns(A)],
      }),
      snap({ entries: [dns(B)] }),
    );
    // Both A-members absent + B new → ROTATED pairing (drop+add),
    // but identities in evidence keep the scopes distinct.
    expect(kinds(r).filter((k) => k === "ROTATED")).toHaveLength(3);
    expect(kinds(r)).not.toContain("SCOPE_CHANGED");
  });

  it("DNS-down → DNS-up same set → still_verified, NOT dropped (UNCHECKED interval ≠ revocation)", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A)], dns_state: "unchecked", absence_confirmed: false }),
      snap({ entries: [dns(A)] }),
    );
    expect(kinds(r)).toEqual(["still_verified"]);
  });

  it("same payTo under different provenance is a different proof — SCOPE_CHANGED, no still", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [site(A)] }),
      snap({ entries: [dns(A)] }),
    );
    expect(kinds(r)).toEqual(["SCOPE_CHANGED"]);
    if (r.comparable) {
      expect(r.transitions[0]!.from_scope).toBe(`site|${D}`);
      expect(r.transitions[0]!.to_scope).toBe(`dns|_x402-payto.${D}`);
    }
  });
});

describe("diffPaytoReports — multi-member sets", () => {
  it("partial change: one still, one dropped, one new", () => {
    const r = diffPaytoReports(
      snap({ observed_at: T1, entries: [dns(A), dns(B)] }),
      snap({ entries: [dns(A), dns(C)] }),
    );
    const ks = kinds(r).sort();
    expect(ks).toContain("still_verified");
    expect(ks).toContain("ROTATED"); // B dropped + C added
    expect(ks).not.toContain("DROPPED");
  });
});
