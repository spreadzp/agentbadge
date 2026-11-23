// SLICE-258-17: AB-188 freshness surface — observed_at/probe_id/observer
// on evidence rows, issued_age_days + stale_issued in detail.
// Split out of x402-payto-proof.test.ts (token-limit hook: 20KB/file).
// Helpers duplicated per the self-contained test-file convention.
import { describe, it, expect } from "vitest";
import { checkerX402PaytoProof } from "../../../src/agent-readiness/rule-engine/semantic-checkers/x402-payto-proof";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const DOMAIN = "example.com";
const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const ADDR_B = "0x1111222233334444555566667777888899990000";
const NOW = "2026-11-22T12:00:00.000Z";
const ISSUED = "2026-11-01";

const txt = (a: string, extra = "") =>
  `v=x402payto1; a=${a}; d=${ISSUED}${extra}`;

function snap(url: string, status: number, body: string | null): ResponseSnapshot {
  return {
    url,
    status,
    bodyHash: "deadbeef",
    bodySize: body?.length ?? 0,
    contentType: "application/json",
    resolvedIp: "93.184.216.34",
    fetchedAt: NOW,
    fetchTimeMs: 12,
    redirectChain: [],
    body,
  };
}

interface DnsOver {
  domain?: string;
  status?: "hit" | "absent" | "unchecked";
  records?: { data: string; ttl: number }[];
  fromCache?: boolean;
  hitName?: string | null;
}

function dnsSnap(over: DnsOver = {}): ResponseSnapshot {
  const r = {
    domain: over.domain ?? DOMAIN,
    hitName: over.hitName ?? (over.status === "hit" ? `_x402-payto.${over.domain ?? DOMAIN}` : null),
    queryNames: [`_x402-payto.${over.domain ?? DOMAIN}`],
    records: over.records ?? [],
    status: over.status ?? "absent",
    pslStopped: false,
    fromCache: over.fromCache ?? false,
    fetchTime: 9,
  };
  return snap(
    `_x402-payto.${r.domain}`,
    r.status === "hit" ? 200 : r.status === "absent" ? 404 : 0,
    JSON.stringify(r),
  );
}

function siteSnap(status: number, innerBody: string | null = null): ResponseSnapshot {
  const url = "https://example.com/.well-known/x402-payto.json";
  return snap(
    url,
    status,
    JSON.stringify({ url, status, body: innerBody, bodyHash: "x", resolvedIp: null, fetchTime: 7 }),
  );
}

interface Accept {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
}
const accepts = (payTo: string, network = "eip155:5042002", asset = "USDC"): Accept[] => [
  { scheme: "exact", network, asset, payTo },
];

interface ProbeOver {
  divergent?: boolean;
  secondStatus?: number;
  secondAccepts?: Accept[] | null;
  endpoint?: string;
  method?: string;
}
const probe = (acceptsList: Accept[] | null, over: ProbeOver = {}) => ({
  endpoint: over.endpoint ?? "/api/paid",
  method: over.method ?? "GET",
  attempts: [
    { status: 402, observedAt: NOW, accepts: acceptsList },
    {
      status: over.secondStatus ?? 402,
      observedAt: "2026-11-22T12:00:01.000Z",
      accepts: over.secondAccepts === undefined ? acceptsList : over.secondAccepts,
    },
  ],
  divergent: over.divergent ?? false,
});

const manifest = (payTo?: string, services: unknown[] = [{ method: "GET", path: "/api/paid" }]) => ({
  x402Version: 1,
  payTo,
  network: "eip155:5042002",
  services,
});

function x402Snap(doc: unknown): ResponseSnapshot {
  return snap("https://example.com/.well-known/x402.json", 200, JSON.stringify(doc));
}

const detail = (r: { outcome: string; detail: string }) => JSON.parse(r.detail) as {
  verdict: string;
  perAddress: {
    key: string;
    payTo: string;
    outcome: string;
    level?: string;
    issued?: string;
    signatureStatus: string;
    observed_at?: string;
    probe_id?: string;
    observer?: string;
    issued_age_days?: number | null;
    stale_issued?: boolean;
    anomalies: string[];
  }[];
  anomalies: string[];
  freshness?: "computed" | "not_computed";
  notes?: string[];
};

describe("checkerX402PaytoProof — freshness surface (SLICE-258-17)", () => {
  it("stale-issued proof (40d) → still found, note informs not warns", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: `v=x402payto1; a=${ADDR_A}; d=2026-10-13`, ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("found");
    const d = detail(r);
    const a = d.perAddress.find((x) => x.payTo === ADDR_A);
    expect(a?.outcome).toBe("verified");
    expect(a?.issued_age_days).toBe(40);
    expect(a?.stale_issued).toBe(true);
    expect(d.freshness).toBe("computed");
    expect(d.notes?.join(" ")).toContain("40 days ago");
  });

  it("fresh proof → age surfaced, no stale flag, no note", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: `v=x402payto1; a=${ADDR_A}; d=2026-11-18`, ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("found");
    const a = detail(r).perAddress.find((x) => x.payTo === ADDR_A);
    expect(a?.issued_age_days).toBe(4);
    expect(a?.stale_issued).toBeUndefined();
    expect(detail(r).notes).toBeUndefined();
  });

  it("every evidence row carries observed_at + probe_id + observer", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    const a = detail(r).perAddress.find((x) => x.payTo === ADDR_A);
    expect(a?.observed_at).toBe(NOW);
    expect(a?.probe_id).toBe("/api/paid#1");
    expect(a?.observer).toBe("x402-double-probe");
  });

  it("divergent double-probe → two rows, two distinct observed_at + probe_id", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [
          { data: txt(ADDR_A), ttl: 300 },
          { data: txt(ADDR_B), ttl: 300 },
        ],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(ADDR_A),
        probes: [
          probe(accepts(ADDR_A), { divergent: true, secondAccepts: accepts(ADDR_B) }),
        ],
      }),
    });
    const rows = detail(r).perAddress;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.observed_at)).size).toBe(2);
    expect(new Set(rows.map((x) => x.probe_id)).size).toBe(2);
    expect(rows.every((x) => x.observer === "x402-double-probe")).toBe(true);
  });

  it("non-YYYY-MM-DD issued → spec-malformed at parse, before freshness", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: `v=x402payto1; a=${ADDR_A}; d=yesterday`, ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    // Record is malformed per spec — it never reaches the freshness
    // assessment (issued_unparseable is for API consumers that skip
    // our strict parser; covered by lib tests).
    expect(r.outcome).toBe("absent");
  });
});
