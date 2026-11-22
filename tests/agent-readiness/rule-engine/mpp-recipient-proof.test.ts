// SLICE-258-5: AB-189 MPP recipient proof — fixture matrix mirroring
// AB-188 (schema.md mapping). Quoted-set = `recipient`/accepts.payTo
// decoded from WWW-Authenticate: Payment challenges on l402/x402
// snapshots; proof set is the shared x402_payto_dns/site tier.
import { describe, it, expect } from "vitest";
import { checkerMppRecipientProof } from "../../../src/agent-readiness/rule-engine/semantic-checkers/mpp-recipient-proof";
import { checkerX402PaytoProof } from "../../../src/agent-readiness/rule-engine/semantic-checkers/x402-payto-proof";
import type { Snapshots } from "../../../src/agent-readiness/rule-engine/semantic-checkers/helpers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const DOMAIN = "example.com";
const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const ADDR_B = "0x1111222233334444555566667777888899990000";
const ADDR_C = "0x9999888877776666555544443333222211110000";
const NOW = "2026-11-22T12:00:00.000Z";
const ISSUED = "2026-11-01";

const txt = (a: string, extra = "") => `v=x402payto1; a=${a}; d=${ISSUED}${extra}`;

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64");
const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const stripeReq = (recipient: string) => b64url({ amount: "10", currency: "usd", recipient });
const tempoReq = (payTo: string, network = "eip155:8453", asset = "USDC") =>
  b64({ x402Version: 1, accepts: [{ scheme: "exact", network, asset, payTo }] });

/** Header the l402 double-probe snapshot carries for attempt 1. */
const mppWwwAuth = (
  quotes: { method: "stripe" | "tempo"; payTo: string; network?: string; asset?: string }[],
) =>
  quotes
    .map((q) =>
      q.method === "stripe"
        ? `Payment method="stripe", request="${stripeReq(q.payTo)}"`
        : `Payment method="tempo", request="${tempoReq(q.payTo, q.network, q.asset)}"`,
    )
    .join(", ");

// ─── Snapshot builders ─────────────────────────────────────────────────────

function snap(
  url: string,
  status: number,
  body: string | null,
  headers: Record<string, string> = {},
): ResponseSnapshot {
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
    headers,
  };
}

function dnsSnap(over: {
  domain?: string;
  status?: "hit" | "absent" | "unchecked";
  records?: { data: string; ttl: number }[];
  fromCache?: boolean;
} = {}): ResponseSnapshot {
  const domain = over.domain ?? DOMAIN;
  const r = {
    domain,
    hitName: over.status === "hit" ? `_x402-payto.${domain}` : null,
    queryNames: [`_x402-payto.${domain}`],
    records: over.records ?? [],
    status: over.status ?? "absent",
    pslStopped: false,
    fromCache: over.fromCache ?? false,
    fetchTime: 9,
  };
  return snap(
    `_x402-payto.${domain}`,
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

/** l402 snapshot — the double-probe contract emitted by the handler:
 *  attempt-1 headers verbatim + x-agentbadge-probe2-* for attempt 2. */
function l402Snap(over: {
  status?: number;
  wwwAuth1?: string;
  probe2Status?: number | null; // null = legacy single-probe snapshot
  wwwAuth2?: string;
} = {}): ResponseSnapshot {
  const headers: Record<string, string> = {};
  if (over.wwwAuth1) headers["www-authenticate"] = over.wwwAuth1;
  if (over.probe2Status !== null) {
    headers["x-agentbadge-probe2-status"] = String(over.probe2Status ?? 402);
    if (over.wwwAuth2) headers["x-agentbadge-probe2-www-authenticate"] = over.wwwAuth2;
  }
  return snap(
    "https://example.com/passport/request",
    over.status ?? 402,
    JSON.stringify({ x402Version: 1 }),
    headers,
  );
}

/** x402 snapshot with probes carrying mppQuotes (mixed-protocol). */
function x402SnapWithMpp(over: {
  mppQuotes?: { method: string; payTo: string; network?: string; asset?: string }[] | null;
  secondMpp?: typeof over extends { mppQuotes?: infer T } ? T : never;
  mppDivergent?: boolean;
  acceptsPayTo?: string;
} = {}): ResponseSnapshot {
  const q = over.mppQuotes === undefined ? null : over.mppQuotes;
  const q2 = over.secondMpp === undefined ? q : over.secondMpp;
  return snap(
    "https://example.com/.well-known/x402.json",
    200,
    JSON.stringify({
      manifest: { services: [{ method: "GET", path: "/paid" }] },
      probes: [
        {
          endpoint: "/paid",
          method: "GET",
          attempts: [
            { status: 402, observedAt: NOW, accepts: [{ payTo: over.acceptsPayTo ?? ADDR_A }], mppQuotes: q },
            { status: 402, observedAt: "2026-11-22T12:00:01.000Z", accepts: [{ payTo: over.acceptsPayTo ?? ADDR_A }], mppQuotes: q2 },
          ],
          divergent: false,
          mppDivergent: over.mppDivergent ?? false,
        },
      ],
    }),
  );
}

const detail = (r: { outcome: string; detail: string }) =>
  JSON.parse(r.detail) as {
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
      evidence_tier?: string;
      signatureStatus: string;
      anomalies: string[];
    }[];
    anomalies: string[];
  };

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("checkerMppRecipientProof — AB-189", () => {
  it("no_source when every snapshot is missing", () => {
    expect(checkerMppRecipientProof({} as Snapshots).outcome).toBe("no_source");
  });

  it("stripe recipient matches DNS proof → found", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
    });
    expect(r.outcome).toBe("found");
    const d = detail(r);
    const a = d.perAddress.find((x) => x.outcome === "verified");
    expect(a?.payTo).toBe(ADDR_A);
    expect(a?.level).toBe("dns");
    expect(a?.evidence_tier).toBe("live_mpp");
    expect(d.coverage.verified).toBe(1);
  });

  it("tempo challenge accepts[].payTo verified too", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "tempo", payTo: ADDR_A, network: "eip155:8453" }]),
        wwwAuth2: mppWwwAuth([{ method: "tempo", payTo: ADDR_A, network: "eip155:8453" }]),
      }),
    });
    expect(r.outcome).toBe("found");
    expect(detail(r).perAddress[0]?.outcome).toBe("verified");
  });

  it("one of two recipients covered → partial + per-address breakdown", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: txt(ADDR_A), ttl: 300 }],
        fromCache: true, // cached → the uncovered one stays unchecked
      }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([
          { method: "stripe", payTo: ADDR_A },
          { method: "stripe", payTo: ADDR_B },
        ]),
        wwwAuth2: mppWwwAuth([
          { method: "stripe", payTo: ADDR_A },
          { method: "stripe", payTo: ADDR_B },
        ]),
      }),
    });
    expect(r.outcome).toBe("partial");
    const d = detail(r);
    expect(d.coverage.verified).toBe(1);
    expect(d.coverage.absent_or_unchecked).toBe(1);
  });

  it("recipient outside the proof set → conflict (fresh DNS)", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_C }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_C }]),
      }),
    });
    expect(r.outcome).toBe("conflict");
    expect(detail(r).coverage.mismatch).toBe(1);
  });

  it("cached DNS + non-match → not_applicable, never mismatch", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: txt(ADDR_A), ttl: 300 }],
        fromCache: true,
      }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_C }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_C }]),
      }),
    });
    expect(r.outcome).toBe("not_applicable");
    expect(detail(r).perAddress[0]?.anomalies).toContain("no_live_recheck");
  });

  it("no proofs anywhere → absent (informational GAP)", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
    });
    expect(r.outcome).toBe("absent");
  });

  it("malformed DNS record → absent + malformed verdict + fix hint", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({
        status: "hit",
        records: [{ data: "v=x402payto1; d=2026-11-01; s=0xabc", ttl: 300 }],
      }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
    });
    expect(r.outcome).toBe("absent");
    expect(detail(r).verdict).toBe("malformed");
  });

  it("DNS resolver failure → not_applicable", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "unchecked" }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
    });
    expect(r.outcome).toBe("not_applicable");
  });

  it("divergent recipients across the two probes → possible_per_payment (exempt)", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_B }]),
      }),
    });
    expect(r.outcome).toBe("partial");
    const d = detail(r);
    expect(d.verdict).toBe("possible_per_payment_address");
    expect(
      d.perAddress.every((a) => a.outcome === "possible_per_payment_address"),
    ).toBe(true);
  });

  it("second probe returned no Payment challenge → unchecked, not mismatch", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_C }]),
        probe2Status: 200, // second attempt ran but came back unpaid
      }),
    });
    expect(r.outcome).toBe("not_applicable");
    expect(detail(r).coverage.skip_reasons).toContain("second_probe_failed");
  });

  it("site without MPP (no Payment challenge, no x402 quotes) → not_applicable", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "absent" }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({ status: 200 }),
    });
    expect(r.outcome).toBe("not_applicable");
    expect(detail(r).verdict).toBe("no_payments");
  });

  it("MPP-only site (no x402 source) → rule applies; AB-188 stays not_applicable", () => {
    const sources: Snapshots = {
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
    };
    expect(checkerMppRecipientProof(sources).outcome).toBe("found");
    // The x402 rule sees no x402 evidence on the same snapshot set.
    expect(checkerX402PaytoProof(sources).outcome).toBe("not_applicable");
  });

  it("x402 probe mppQuotes feed the same check (mixed-protocol site)", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402SnapWithMpp({
        mppQuotes: [{ method: "stripe", payTo: ADDR_A }],
      }),
    });
    expect(r.outcome).toBe("found");
    const a = detail(r).perAddress.find((x) => x.outcome === "verified");
    expect(a?.evidence_tier).toBe("live_mpp");
  });

  it("x402 probe mppDivergent → possible_per_payment exempt", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      x402: x402SnapWithMpp({
        mppQuotes: [{ method: "stripe", payTo: ADDR_A }],
        secondMpp: [{ method: "stripe", payTo: ADDR_B }],
        mppDivergent: true,
      }),
    });
    expect(r.outcome).toBe("partial");
    expect(detail(r).perAddress[0]?.outcome).toBe("possible_per_payment_address");
  });

  it("same recipient from l402 and x402 dedups to one perAddress row", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
      x402: x402SnapWithMpp({ mppQuotes: [{ method: "stripe", payTo: ADDR_A }] }),
    });
    expect(r.outcome).toBe("found");
    const rows = detail(r).perAddress.filter((a) => a.payTo === ADDR_A);
    expect(rows).toHaveLength(1);
  });

  it("stable_across_probe_window wording, never 'permanent'", () => {
    const r = checkerMppRecipientProof({
      x402_payto_dns: dnsSnap({ status: "hit", records: [{ data: txt(ADDR_A), ttl: 300 }] }),
      x402_payto_site: siteSnap(404),
      l402: l402Snap({
        wwwAuth1: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
        wwwAuth2: mppWwwAuth([{ method: "stripe", payTo: ADDR_A }]),
      }),
    });
    expect(r.detail).toContain("stable_across_probe_window");
    expect(r.detail).not.toContain("permanent");
  });
});
