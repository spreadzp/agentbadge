// SLICE-258-11: e2e outcome matrix — AB-188 scenarios through the real
// pipeline (see harness.ts for the virtual transports). Mock wiring is
// file-scoped: dns + pinned-fetch here, global fetch via stubGlobal.
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
  sites, doh, mockFetch, dns, dohOk, DOH_NXDOMAIN, x402Site, paid402,
  manifestBody, accept, signedTxt, txt, scan,
  SIGNED_ADDR, ADDR_A, ADDR_B, ADDR_C, ADDR_SOL,
} from "./e2e-matrix/harness";

process.env.CACHE_ENABLED = "false";

beforeEach(() => {
  sites.clear();
  doh.clear();
  resetPayToDnsCache();
  vi.stubGlobal("fetch", mockFetch);
});

describe("E2E outcome matrix — AB-188 (SLICE-258-11)", () => {
  it("DNS proof matching live payTo → VERIFIED dns_signed", async () => {
    const host = "verified.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: await signedTxt(host, SIGNED_ADDR, "2026-11-20") }));
    x402Site(host, { accepts: [accept(SIGNED_ADDR)] });

    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    const d = r.detail("AB-188");
    expect(d.verdict).toBe("verified");
    const addr = (d.perAddress as { level?: string; signatureStatus: string }[])[0]!;
    expect(addr.level).toBe("dns_signed");
    expect(addr.signatureStatus).toBe("valid");
  });

  it("well-known proof only → VERIFIED site level", async () => {
    const host = "wk.example.com";
    x402Site(host, {
      accepts: [accept(ADDR_A)],
      paytoWellKnown: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1, domain: host, payTo: [ADDR_A] }),
      },
    });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    expect((r.detail("AB-188").perAddress as { level?: string }[])[0]?.level).toBe("site");
  });

  it("DNS + file diverge → DNS wins", async () => {
    const host = "shadow.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(SIGNED_ADDR) }));
    x402Site(host, {
      accepts: [accept(SIGNED_ADDR)],
      paytoWellKnown: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 1, domain: host, payTo: [ADDR_B] }),
      },
    });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    expect((r.detail("AB-188").perAddress as { level?: string }[])[0]?.level).toBe("dns");
  });

  it("proof exists, payTo outside the set → CONFLICT + readable quoted/proven", async () => {
    const host = "conflict.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_B)] });

    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("CONFLICT");
    const d = r.detail("AB-188");
    expect(d.verdict).toBe("conflict");
    expect(String(d.summary)).toContain(ADDR_B.toLowerCase());
    const pa = (d.perAddress as { outcome: string; payTo: string }[])[0]!;
    expect(pa.outcome).toBe("mismatch");
    expect(pa.payTo).toBe(ADDR_B.toLowerCase());
    const gaps = r.report.gaps.filter((g) => g.related_rules.includes("AB-188"));
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.type).toBe("evidence");
  });

  it("no proof anywhere → GAP low + fix hint, gap-engine recommendation", async () => {
    const host = "bare.example.com";
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("GAP");
    const d = r.detail("AB-188");
    expect(d.verdict).toBe("absent");
    expect(String(d.fix)).toContain("_x402-payto");
    const gaps = r.report.gaps.filter((g) => g.related_rules.includes("AB-188"));
    expect(gaps.length).toBe(1);
    expect(["LOW", "MEDIUM"]).toContain(gaps[0]!.priority);
  });

  it("malformed TXT (missing a=) → absent-semantics + malformed verdict", async () => {
    const host = "bad.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: "v=x402payto1; d=2026-11-01; s=0xabc" }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("GAP");
    expect(r.detail("AB-188").verdict).toBe("malformed");
  });

  it("DoH SERVFAIL/unreachable → unchecked, NOT absent", async () => {
    const host = "down.example.com";
    dns(`_x402-payto.${host}`, { google: "error", cf: "error" });
    dns("_x402-payto.example.com", { google: "error", cf: "error" });
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
    expect(r.detail("AB-188").verdict).toBe("unchecked");
  });

  it("site without payments → NOT_APPLICABLE for all three rules", async () => {
    const host = "static.example.com";
    sites.set(host, new Map([["/", [{ status: 200, body: "<html>hi</html>" }]]]));
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
    expect(r.detail("AB-188").verdict).toBe("no_payments");
    expect(r.assertion("AB-189").status).toBe("NOT_APPLICABLE");
    expect(r.assertion("AB-190").status).toBe("NOT_APPLICABLE");
  });

  it("subdomain ← parent-domain proof → VERIFIED by parent (C8)", async () => {
    const host = "sub.api.example.com";
    dns(`_x402-payto.${host}`, DOH_NXDOMAIN);
    dns("_x402-payto.api.example.com", DOH_NXDOMAIN);
    dns("_x402-payto.example.com", dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
  });

  it("proof at shared-hosting parent (onrender.com) → NOT accepted", async () => {
    const host = "foo.onrender.com";
    dns("_x402-payto.onrender.com", dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("GAP");
    expect(r.detail("AB-188").verdict).toBe("absent");
  });

  it("multi-accepts 2/3 proven + 1 mismatch → CONFLICT w/ per-address rows", async () => {
    const host = "multi.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }, { data: txt(ADDR_SOL) }));
    x402Site(host, {
      accepts: [
        accept(ADDR_A, "eip155:5042", "USDC"),
        accept(ADDR_B, "eip155:8453", "USDC"),
        accept(ADDR_SOL, "solana:mainnet", "USDC"),
      ],
    });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("CONFLICT");
    const d = r.detail("AB-188");
    const per = d.perAddress as { outcome: string }[];
    expect(per.filter((a) => a.outcome === "verified")).toHaveLength(2);
    expect(per.filter((a) => a.outcome === "mismatch")).toHaveLength(1);
    expect((d.coverage as { accepts_found: number }).accepts_found).toBe(3);
  });

  it("double-probe divergent payTo → possible_per_payment → INFERRED, no mismatch", async () => {
    const host = "perpay.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { probes: [paid402([accept(ADDR_A)]), paid402([accept(ADDR_B)])] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("INFERRED");
    expect(r.detail("AB-188").verdict).toBe("possible_per_payment_address");
  });

  it("second probe fails → unchecked, never a mismatch", async () => {
    const host = "flaky.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { probes: [paid402([accept(ADDR_B)]), { status: 500, body: "err" }] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
    const d = r.detail("AB-188");
    expect(d.verdict).toBe("unchecked");
    expect((d.coverage as { skip_reasons: string[] }).skip_reasons).toContain("second_probe_failed");
  });

  it("manifest-only hint never causes a mismatch → unchecked", async () => {
    const host = "hint.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, {
      manifest: manifestBody([{ method: "GET", path: "/gone" }], ADDR_B),
      probes: [{ status: 500, body: "err" }, { status: 500, body: "err" }],
      path: "/gone",
    });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
    expect(r.detail("AB-188").verdict).toBe("unchecked");
  });

  it("invalid sig on a matching record → VERIFIED unsigned + sig:invalid (C1/C9)", async () => {
    const host = "badsig.example.com";
    const badSig = `0x${"ab".repeat(64)}1b`;
    dns(`_x402-payto.${host}`, dohOk({ data: `${txt(ADDR_A)}; s=${badSig}` }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    const pa = (r.detail("AB-188").perAddress as { level?: string; signatureStatus: string }[])[0]!;
    expect(pa.level).toBe("dns");
    expect(pa.signatureStatus).toBe("invalid");
  });

  it("record without s= → VERIFIED + sig:none (distinct from invalid, C9)", async () => {
    const host = "nosig.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    expect((r.detail("AB-188").perAddress as { signatureStatus: string }[])[0]!.signatureStatus).toBe("none");
  });

  it("old issued → still VERIFIED, issued visible in detail (D-258-Q13)", async () => {
    const host = "old.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: `v=x402payto1; a=${ADDR_A}; d=2020-01-01` }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    expect((r.detail("AB-188").perAddress as { issued?: string }[])[0]!.issued).toBe("2020-01-01");
  });

  // SLICE-258-17: freshness surface — stale issued informs, never warns.
  it("stale-issued proof (>30d) → VERIFIED + stale_issued + note in detail", async () => {
    const host = "stale.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: `v=x402payto1; a=${ADDR_A}; d=2020-01-01` }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    const d = r.detail("AB-188");
    const a = (d.perAddress as {
      outcome: string;
      stale_issued?: boolean;
      issued_age_days?: number | null;
      observed_at?: string;
      probe_id?: string;
      observer?: string;
    }[])[0]!;
    expect(a.outcome).toBe("verified");
    expect(a.stale_issued).toBe(true);
    expect(a.issued_age_days).toBeGreaterThan(30);
    expect(a.observed_at).toBeTruthy();
    expect(Date.parse(a.observed_at!)).not.toBeNaN();
    expect(a.probe_id).toMatch(/#1$/);
    expect(a.observer).toBe("x402-double-probe");
    expect(d.freshness).toBe("computed");
    expect(String((d.notes as string[]).join(" "))).toContain("days ago");
  });

  it("double-probe → each evidence row keeps its own probe_id + observed_at", async () => {
    const host = "twoprobes.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }, { data: txt(ADDR_B) }));
    x402Site(host, { probes: [paid402([accept(ADDR_A)]), paid402([accept(ADDR_B)])] });
    const r = await scan(host);
    const rows = r.detail("AB-188").perAddress as {
      probe_id?: string;
      observed_at?: string;
    }[];
    // Divergent probe surfaces both attempts — each with own probe id.
    expect(new Set(rows.map((x) => x.probe_id)).size).toBe(rows.length);
    expect(rows.every((x) => Date.parse(x.observed_at ?? "") > 0)).toBe(true);
  });

  it("old proof + mismatch → CONFLICT — age never softens (D-258-Q13)", async () => {
    const host = "oldconflict.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: `v=x402payto1; a=${ADDR_A}; d=2020-01-01` }));
    x402Site(host, { accepts: [accept(ADDR_B)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("CONFLICT");
  });

  it("DoH resolvers disagree → unchecked, never pick a side (D-258-Q9)", async () => {
    const host = "split.example.com";
    dns(`_x402-payto.${host}`, { google: dohOk({ data: txt(ADDR_A) }), cf: dohOk({ data: txt(ADDR_B) }) });
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
    expect(r.detail("AB-188").verdict).toBe("unchecked");
  });

  it("sibling proof never applies (C8)", async () => {
    const host = "b.example.com";
    dns("_x402-payto.a.example.com", dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("GAP");
  });

  it("own record wins over differing parent (nearest wins, D-258-Q18)", async () => {
    const host = "api.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_C) }));
    dns("_x402-payto.example.com", dohOk({ data: txt(ADDR_B) }));
    x402Site(host, { accepts: [accept(ADDR_B)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("CONFLICT");
  });

  it("malformed own + valid parent → malformed, parent not consulted", async () => {
    const host = "api2.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: "v=x402payto1; d=2026-11-01; s=0xabc" }));
    dns("_x402-payto.example.com", dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("GAP");
    expect(r.detail("AB-188").verdict).toBe("malformed");
  });

  it("direct record on shared-hosting name → VERIFIED + scope flag (D-258-Q19)", async () => {
    const host = "site.onrender.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    expect(r.detail("AB-188").scope).toBe("shared_hosting_name");
  });

  it("composite: PSL-tenant proof + parent record + partial match → CONFLICT (D-258-Q17/18/19)", async () => {
    const host = "tenant.onrender.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(ADDR_A) }));
    dns("_x402-payto.onrender.com", dohOk({ data: txt(ADDR_B) }));
    x402Site(host, { accepts: [accept(ADDR_A), accept(ADDR_B, "eip155:8453")] });
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("CONFLICT");
    const d = r.detail("AB-188");
    const per = d.perAddress as { outcome: string }[];
    expect(per.filter((p) => p.outcome === "verified")).toHaveLength(1);
    expect(per.filter((p) => p.outcome === "mismatch")).toHaveLength(1);
    expect(d.scope).toBe("shared_hosting_name");
  });
});
