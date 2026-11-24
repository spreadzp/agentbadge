// SLICE-258-18: e2e — two real scans produce comparable proof_set
// snapshots; the pure diff renders DROPPED on confirmed absence and
// recheck_unchecked on resolver failure (never a revocation).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(async () => ["93.184.216.34"]),
  resolve6: vi.fn(async () => {
    throw new Error("no AAAA");
  }),
  lookup: vi.fn(async () => ({ address: "93.184.216.34", family: 4 })),
}));

vi.mock("../../../src/agent-readiness/scanner/ssrf/pinned-fetch", () => ({
  fetchPinned: vi.fn(async (url: string, _ip: string, opts?: { method?: string }) =>
    (await import("./e2e-matrix/harness")).routeSite(url, opts)),
}));

import { resetPayToDnsCache } from "../../../src/agent-readiness/scanner/fetchers/payto-dns-fetcher";
import {
  sites, doh, mockFetch, dns, dohOk, DOH_NXDOMAIN, x402Site, accept,
  txt, scan, ADDR_A, ADDR_B,
} from "./e2e-matrix/harness";
import {
  diffPaytoReports,
  type ProofSetSnapshot,
} from "../../../src/agent-readiness/payto-recheck";

process.env.CACHE_ENABLED = "false";

beforeEach(() => {
  sites.clear();
  doh.clear();
  resetPayToDnsCache();
  vi.stubGlobal("fetch", mockFetch);
});

const T1 = "2026-11-20T12:00:00Z";
const T2 = "2026-11-24T12:00:00Z";

const proofSet = (d: Record<string, unknown>, observed_at: string): ProofSetSnapshot =>
  ({ ...(d.proof_set as ProofSetSnapshot), observed_at });

describe("E2E recheck — proof_set snapshots + diffPaytoReports (SLICE-258-18)", () => {
  it("scan1 proven → scan2 confirmed-absent → DROPPED with both dates", async () => {
    const host = "rotate.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });

    const s1 = await scan(host);
    const set1 = proofSet(s1.detail("AB-188"), T1);
    expect(set1.entries).toHaveLength(1);
    expect(set1.entries[0]!.payTo).toBe(ADDR_A.toLowerCase());
    expect(set1.absence_confirmed).toBe(true); // live lookup, resolvers agreed

    // Business drops the record between scans.
    dns(`_x402-payto.${host}`, DOH_NXDOMAIN);
    resetPayToDnsCache(); // next scan = fresh lookup, not a cache hit

    const s2 = await scan(host);
    const set2 = proofSet(s2.detail("AB-188"), T2);
    expect(set2.entries).toHaveLength(0);
    expect(set2.absence_confirmed).toBe(true);

    const diff = diffPaytoReports(set1, set2);
    expect(diff.comparable).toBe(true);
    if (!diff.comparable) return;
    expect(diff.transitions).toHaveLength(1);
    const t = diff.transitions[0]!;
    expect(t.kind).toBe("DROPPED");
    expect(t.severity).toBe("medium");
    expect(t.payTo).toBe(ADDR_A.toLowerCase());
    expect(t.previously_verified_at).toBe(T1);
    expect(t.currently_observed_at).toBe(T2);
    expect(t.note).toBe(
      `${ADDR_A.toLowerCase()} was proven 2026-11-20, absent 2026-11-24 — possible rotation or compromise`,
    );
  });

  it("scan1 proven → scan2 SERVFAIL → recheck_unchecked, never dropped", async () => {
    const host = "flap.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });

    const s1 = await scan(host);
    const set1 = proofSet(s1.detail("AB-188"), T1);

    dns(`_x402-payto.${host}`, { google: "error", cf: "error" });
    dns("_x402-payto.example.com", { google: "error", cf: "error" });
    resetPayToDnsCache();

    const s2 = await scan(host);
    const set2 = proofSet(s2.detail("AB-188"), T2);
    expect(set2.dns_state).toBe("unchecked");
    expect(set2.absence_confirmed).toBe(false);

    const diff = diffPaytoReports(set1, set2);
    expect(diff.comparable).toBe(true);
    if (!diff.comparable) return;
    expect(diff.transitions[0]!.kind).toBe("recheck_unchecked");
    expect(diff.summary).toBe("unchecked");
  });

  it("rotation: scan1 proves A → scan2 proves B → ROTATED pair", async () => {
    const host = "swap.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });

    const s1 = await scan(host);
    const set1 = proofSet(s1.detail("AB-188"), T1);

    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_B) }));
    resetPayToDnsCache();
    x402Site(host, { accepts: [accept(ADDR_B)] });

    const s2 = await scan(host);
    const set2 = proofSet(s2.detail("AB-188"), T2);

    const diff = diffPaytoReports(set1, set2);
    expect(diff.comparable).toBe(true);
    if (!diff.comparable) return;
    expect(diff.summary).toBe("changed");
    const kinds = diff.transitions.map((t) => t.kind);
    expect(kinds).toEqual(["ROTATED", "ROTATED"]);
    const dropped = diff.transitions.find((t) => t.payTo === ADDR_A.toLowerCase());
    expect(dropped?.replaced_by).toBe(ADDR_B.toLowerCase());
  });
});
