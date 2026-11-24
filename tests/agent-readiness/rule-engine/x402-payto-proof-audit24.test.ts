// SLICE-258-24 arc-review regressions, checker level:
//   M13 — skipped well-known entries are malformedness, not absence
//   H2  — DNS unreachable + site hit → NOT verified (unchecked)
//   H4  — divergent probes without a proof set → absent, not exempt
import { describe, it, expect } from "vitest";
import { checkerX402PaytoProof } from "../../../src/agent-readiness/rule-engine/semantic-checkers/x402-payto-proof";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const DOMAIN = "example.com";
const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const ADDR_B = "0x1111222233334444555566667777888899990000";
const NOW = "2026-11-22T12:00:00.000Z";

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

function dnsSnap(over: { status?: "hit" | "absent" | "unchecked"; records?: { data: string; ttl: number }[]; fromCache?: boolean } = {}): ResponseSnapshot {
  const status = over.status ?? "absent";
  const r = {
    domain: DOMAIN,
    hitName: status === "hit" ? `_x402-payto.${DOMAIN}` : null,
    queryNames: [`_x402-payto.${DOMAIN}`],
    records: over.records ?? [],
    status,
    pslStopped: false,
    fromCache: over.fromCache ?? false,
    fetchTime: 9,
  };
  return snap(`_x402-payto.${DOMAIN}`, status === "hit" ? 200 : status === "absent" ? 404 : 0, JSON.stringify(r));
}

function siteSnap(status: number, innerBody: string | null = null): ResponseSnapshot {
  const url = "https://example.com/.well-known/x402-payto.json";
  return snap(url, status, JSON.stringify({ url, status, body: innerBody, bodyHash: "x", resolvedIp: null, fetchTime: 7 }));
}

interface Accept { payTo?: string }
const accepts = (payTo: string): Accept[] => [{ payTo }];

const probe = (acceptsList: Accept[] | null, endpoint = "/api/paid") => ({
  endpoint,
  method: "GET",
  attempts: [
    { status: 402, observedAt: NOW, accepts: acceptsList },
    { status: 402, observedAt: "2026-11-22T12:00:01.000Z", accepts: acceptsList },
  ],
  divergent: false,
});

/** Two attempts quoting DIFFERENT payTo — the per-payment suspect shape. */
const divergentProbe = (a1: string, a2: string) => ({
  endpoint: "/api/paid",
  method: "GET",
  attempts: [
    { status: 402, observedAt: NOW, accepts: accepts(a1) },
    { status: 402, observedAt: "2026-11-22T12:00:01.000Z", accepts: accepts(a2) },
  ],
  divergent: true,
});

function x402Snap(doc: unknown): ResponseSnapshot {
  return snap("https://example.com/.well-known/x402.json", 200, JSON.stringify(doc));
}

const manifest = (services: unknown[] = [{ method: "GET", path: "/api/paid" }]) => ({
  x402Version: 1,
  network: "eip155:5042002",
  services,
});

const detail = (r: { outcome: string; detail: string }) =>
  JSON.parse(r.detail) as { verdict: string; perAddress: { payTo: string; outcome: string }[] };

describe("arc-review 258-24 — checker regressions", () => {
  it("M13: well-known file whose only entry is skipped → malformed, not absent", () => {
    const doc = {
      version: 1,
      domain: DOMAIN,
      payTo: [{ bogus: true }], // no `address` → skipped by parser
    };
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(200, JSON.stringify(doc)),
      x402: x402Snap({ manifest: manifest(), probes: [probe(accepts(ADDR_A))] }),
    });
    const d = detail(r);
    expect(d.verdict).toBe("malformed");
    expect(r.outcome).toBe("absent"); // malformed surfaces as gap-with-fix, not clean absent
  });

  it("H2: DNS unchecked + site hit match → NOT found (site could be shadowed)", () => {
    const doc = { version: 1, domain: DOMAIN, payTo: [{ address: ADDR_A, network: "eip155:5042002" }] };
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "unchecked" }),
      x402_payto_site: siteSnap(200, JSON.stringify(doc)),
      x402: x402Snap({ manifest: manifest(), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).not.toBe("found");
    expect(detail(r).verdict).not.toBe("verified");
  });

  it("H2: DNS unchecked + site hit mismatch → not conflict either", () => {
    const doc = { version: 1, domain: DOMAIN, payTo: [{ address: ADDR_B, network: "eip155:5042002" }] };
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "unchecked" }),
      x402_payto_site: siteSnap(200, JSON.stringify(doc)),
      x402: x402Snap({ manifest: manifest(), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).not.toBe("conflict");
    expect(detail(r).verdict).not.toBe("mismatch");
  });

  it("H4: divergent payTo across probes + NO proof set → absent, not exempt", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(),
        probes: [divergentProbe(ADDR_A, ADDR_B)],
      }),
    });
    const d = detail(r);
    expect(d.verdict).not.toBe("possible_per_payment_address");
    expect(d.verdict).toBe("absent");
  });

  it("H4: divergent payTo + ready proof set → exempt preserved", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: `v=x402payto1; a=${ADDR_A}; d=2026-11-01`, ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(),
        probes: [divergentProbe(ADDR_B, "0x9999888877776666555544443333222211110000")],
      }),
    });
    const d = detail(r);
    expect(d.verdict).toBe("possible_per_payment_address");
  });
});
