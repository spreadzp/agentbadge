// SLICE-258-4: AB-188 x402 payout proof — semantic checker fixture matrix.
// Covers every lib aggregate → scanner status mapping (schema.md):
// verified→found, partial→partial, mismatch→conflict, absent→absent(GAP),
// malformed→absent(GAP+fix-hint), unchecked/manifest-only→not_applicable,
// possible_per_payment→partial(exempt).
import { describe, it, expect } from "vitest";
import { checkerX402PaytoProof } from "../../../src/agent-readiness/rule-engine/semantic-checkers/x402-payto-proof";
import type { Snapshots } from "../../../src/agent-readiness/rule-engine/semantic-checkers/helpers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

// ─── Constants ──────────────────────────────────────────────────────────────

const DOMAIN = "example.com";
const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const ADDR_B = "0x1111222233334444555566667777888899990000";
const ADDR_C = "0x9999888877776666555544443333222211110000";
const NOW = "2026-11-22T12:00:00.000Z";
const ISSUED = "2026-11-01";

// Real published proof for agentbadge.xyz (SLICE-258-6 dogfood artifacts —
// signature is a genuine EIP-191 over the canonical message for this
// domain+address+issued, so it must verify `valid`).
const DF_DOMAIN = "agentbadge.xyz";
const DF_ADDR = "0x23dd386015c154758ee765d2a063b94eabb251b3";
const DF_SIG =
  "0x0b88fdbcb2cbd0bb4cf5a99fedec34072270f0936c894fba6a8f419b71d09c4841ac4a79db2a99145456d8d3aae4c008e5d1fa89d9b9b842f73521127406cfc41b";
const DF_TXT = `v=x402payto1; a=${DF_ADDR}; d=2026-11-22; s=${DF_SIG}`;

const txt = (a: string, extra = "") =>
  `v=x402payto1; a=${a}; d=${ISSUED}${extra}`;

// ─── Snapshot builders ─────────────────────────────────────────────────────

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

/** x402_payto_dns snapshot body = PayToDnsFetchResult JSON. */
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

/** x402_payto_site snapshot body = PayToWellknownFetchResult JSON (inner body = raw file). */
function siteSnap(status: number, innerBody: string | null = null): ResponseSnapshot {
  const url = "https://example.com/.well-known/x402-payto.json";
  return snap(
    url,
    status,
    JSON.stringify({ url, status, body: innerBody, bodyHash: "x", resolvedIp: null, fetchTime: 7 }),
  );
}

const wellKnown = (entries: unknown[], domain = DOMAIN) =>
  JSON.stringify({ version: 1, domain, payTo: entries });

// ─── x402 snapshot builders (new {manifest, probes} shape) ─────────────────

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
  coverage: {
    accepts_found: number;
    probed: number;
    verified: number;
    mismatch: number;
    absent_or_unchecked: number;
    skip_reasons: string[];
  };
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("checkerX402PaytoProof — AB-188", () => {
  it("no_source when every snapshot is missing", () => {
    const r = checkerX402PaytoProof({} as Snapshots);
    expect(r.outcome).toBe("no_source");
  });

  it("verified (full coverage, unsigned dns) → found", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("found");
    const d = detail(r);
    const addr = d.perAddress.find((a) => a.outcome === "verified");
    expect(addr?.level).toBe("dns");
    expect(addr?.signatureStatus).toBe("none");
    expect(addr?.issued).toBe(ISSUED);
    expect(d.coverage.verified).toBe(1);
  });

  it("verified signed (live dogfood proof) → found + level dns_signed + sig valid", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        domain: DF_DOMAIN,
        status: "hit",
        records: [{ data: `"${DF_TXT}"`, ttl: 300 }], // RFC-1035 quoted form
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(DF_ADDR), probes: [probe(accepts(DF_ADDR))] }),
    });
    expect(r.outcome).toBe("found");
    const d = detail(r);
    const addr = d.perAddress.find((a) => a.outcome === "verified");
    expect(addr?.level).toBe("dns_signed");
    expect(addr?.signatureStatus).toBe("valid");
    expect(addr?.issued).toBe("2026-11-22");
  });

  it("partial coverage → partial + per-address breakdown", () => {
    // Fresh lookup would make the uncovered address a mismatch; the
    // cached DNS view keeps it unchecked → verified+unchecked = partial.
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: txt(ADDR_A), ttl: 300 }],
        fromCache: true,
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(ADDR_A),
        probes: [probe([...accepts(ADDR_A, "eip155:5042002"), ...accepts(ADDR_B, "eip155:8453")])],
      }),
    });
    expect(r.outcome).toBe("partial");
    const d = detail(r);
    expect(d.coverage.verified).toBe(1);
    expect(d.coverage.absent_or_unchecked).toBe(1);
    const uncovered = d.perAddress.find((a) => a.outcome !== "verified");
    expect(uncovered?.payTo).toBe(ADDR_B);
    expect(uncovered?.outcome).toBe("unchecked");
    expect(uncovered?.anomalies).toContain("no_live_recheck");
  });

  it("confirmed mismatch → conflict (fresh DNS = live re-check)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_C))] }),
    });
    expect(r.outcome).toBe("conflict");
    const d = detail(r);
    expect(d.coverage.mismatch).toBe(1);
    expect(d.perAddress.find((a) => a.outcome === "mismatch")?.payTo).toBe(ADDR_C);
  });

  it("mismatch inside a partial set → still conflict", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(ADDR_A),
        probes: [probe([...accepts(ADDR_A), ...accepts(ADDR_C, "eip155:8453")])],
      }),
    });
    expect(r.outcome).toBe("conflict");
    const d = detail(r);
    expect(d.coverage.verified).toBe(1);
    expect(d.coverage.mismatch).toBe(1);
  });

  it("no proofs anywhere → absent (informational GAP)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("absent");
  });

  it("malformed DNS record → absent + fix hint in detail", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: "v=x402payto1; d=2026-11-01; s=0xabc", ttl: 300 }], // missing a=
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("absent");
    expect(detail(r).verdict).toBe("malformed");
  });

  it("malformed well-known file → absent + malformed verdict", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(200, JSON.stringify({ version: 2, domain: DOMAIN, payTo: [] })),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("absent");
    expect(detail(r).verdict).toBe("malformed");
  });

  it("DNS resolver failure → not_applicable (never absent)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "unchecked" }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("not_applicable");
  });

  it("manifest-only observation → not_applicable (manifest cannot verify)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [] }),
    });
    expect(r.outcome).toBe("not_applicable");
  });

  it("manifest payTo outside the proof set → still not_applicable, NEVER mismatch", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_C), probes: [] }),
    });
    expect(r.outcome).toBe("not_applicable");
    const d = detail(r);
    expect(d.perAddress.every((a) => a.outcome !== "mismatch")).toBe(true);
    expect(d.perAddress[0]?.anomalies).toContain("manifest_hint_only");
  });

  it("divergent double-probe → partial, possible_per_payment_address (exempt)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(ADDR_A),
        probes: [probe(accepts(ADDR_A), { divergent: true, secondAccepts: accepts(ADDR_B) })],
      }),
    });
    expect(r.outcome).toBe("partial");
    const d = detail(r);
    expect(d.perAddress[0]?.outcome).toBe("possible_per_payment_address");
    expect(d.verdict).toBe("possible_per_payment_address");
  });

  it("second probe failed → not_applicable (unchecked, not mismatch)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({
        manifest: manifest(ADDR_C),
        probes: [probe(accepts(ADDR_C), { secondStatus: 0, secondAccepts: null })],
      }),
    });
    expect(r.outcome).toBe("not_applicable");
    const d = detail(r);
    expect(d.coverage.skip_reasons).toContain("second_probe_failed");
  });

  it("site-only proof → verified at site level", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(200, wellKnown([{ address: ADDR_A, issued: ISSUED }])),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("found");
    const addr = detail(r).perAddress.find((a) => a.outcome === "verified");
    expect(addr?.level).toBe("site");
  });

  it("DNS precedence: dns entry shadows well-known → live payTo matching only site is conflict", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(200, wellKnown([{ address: ADDR_B }])),
      x402: x402Snap({ manifest: manifest(ADDR_B), probes: [probe(accepts(ADDR_B))] }),
    });
    expect(r.outcome).toBe("conflict");
  });

  it("cached DNS result → no live re-check → unchecked, NOT conflict", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: txt(ADDR_A), ttl: 300 }],
        fromCache: true,
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_C))] }),
    });
    expect(r.outcome).toBe("not_applicable");
    const d = detail(r);
    expect(d.perAddress[0]?.anomalies).toContain("no_live_recheck");
  });

  it("invalid signature keeps verdict but drops level + reports sig invalid", () => {
    // 65-byte well-formed signature that cannot recover to ADDR_A.
    const badSig = `; s=0x${"ab".repeat(64)}1b`;
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: txt(ADDR_A, badSig), ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("found");
    const addr = detail(r).perAddress.find((a) => a.outcome === "verified");
    expect(addr?.level).toBe("dns"); // unsigned level — invalid sig never upgrades
    expect(addr?.signatureStatus).toBe("invalid");
  });

  it("issued in the future → anomaly + entry dropped (absent)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: `v=x402payto1; a=${ADDR_A}; d=2999-01-01`, ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("absent");
    expect(detail(r).anomalies.some((a) => a.startsWith("issued_in_future"))).toBe(true);
  });

  it("legacy bare-manifest x402 body tolerated (manifest hint path)", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap(manifest(ADDR_A)), // old shape: body IS the manifest
    });
    expect(r.outcome).toBe("not_applicable");
  });

  it("site without payments → not_applicable", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: { x402Version: 1, services: [] }, probes: [] }),
    });
    expect(r.outcome).toBe("not_applicable");
  });

  it("manifest confirming a live402 accept → verified via live tier only", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.outcome).toBe("found");
    // No second "manifest" row duplicating the same key.
    const d = detail(r);
    expect(d.perAddress.filter((a) => a.payTo === ADDR_A)).toHaveLength(1);
  });

  it("stable_across_probe_window wording, never 'permanent'", () => {
    const r = checkerX402PaytoProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402Snap({ manifest: manifest(ADDR_A), probes: [probe(accepts(ADDR_A))] }),
    });
    expect(r.detail).toContain("stable_across_probe_window");
    expect(r.detail).not.toContain("permanent");
  });
});
