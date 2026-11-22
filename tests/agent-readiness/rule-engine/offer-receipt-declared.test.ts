// SLICE-258-9: AB-190 — offer-and-receipt extension declaration.
// Presence-detection rule (D-258-Q15, C9): the check only proves the
// extension is DECLARED in the 402 challenge / x402 manifest — it does
// NOT verify signatures, signer authorization, or receipt delivery.
// Honest detail fields: extension_declared vs
// extension_signature_verified: "not_implemented".
import { describe, it, expect } from "vitest";
import { checkerOfferReceiptDeclared } from "../../../src/agent-readiness/rule-engine/semantic-checkers/offer-receipt-declared";
import type { Snapshots } from "../../../src/agent-readiness/rule-engine/semantic-checkers/helpers";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

const NOW = "2026-11-22T12:00:00.000Z";

function snap(body: string | null): ResponseSnapshot {
  return {
    url: "https://example.com/.well-known/x402.json",
    status: 200,
    bodyHash: "deadbeef",
    bodySize: body?.length ?? 0,
    contentType: "application/json",
    resolvedIp: "93.184.216.34",
    fetchedAt: NOW,
    fetchTimeMs: 12,
    redirectChain: [],
    body,
    headers: {},
  };
}

const x402 = (manifest: unknown, probes: unknown[] = []): Snapshots => ({
  x402: snap(JSON.stringify({ manifest, probes })),
});

const probe = (
  offerReceipt?: { declared: boolean; offers: number; formats: string[]; malformed?: boolean },
  endpoint = "/paid",
) => ({
  endpoint,
  method: "GET",
  divergent: false,
  mppDivergent: false,
  attempts: [
    { status: 402, observedAt: NOW, accepts: [{ payTo: "0xPAY" }], mppQuotes: [], offerReceipt },
    { status: 402, observedAt: NOW, accepts: [{ payTo: "0xPAY" }], mppQuotes: [], offerReceipt },
  ],
});

const manifestExt = (offers: unknown[]) => ({
  services: [{ method: "GET", path: "/paid" }],
  extensions: {
    "offer-receipt": {
      info: {
        offers,
      },
    },
  },
});

const goodOffer = { format: "eip712", payload: { version: 1 }, signature: "0xabc" };

function detail(r: { detail: string }) {
  return JSON.parse(r.detail) as Record<string, unknown>;
}

describe("checkerOfferReceiptDeclared", () => {
  it("no_source without an x402 snapshot", () => {
    expect(checkerOfferReceiptDeclared({}).outcome).toBe("no_source");
  });

  it("not_applicable when the site advertises no x402 at all", () => {
    const r = checkerOfferReceiptDeclared(x402(null, []));
    expect(r.outcome).toBe("not_applicable");
    expect(detail(r).verdict).toBe("not_applicable");
  });

  it("absent when x402 runs but nothing declares the extension", () => {
    const r = checkerOfferReceiptDeclared(
      x402({ services: [{ method: "GET", path: "/paid" }] }, [probe()]),
    );
    expect(r.outcome).toBe("absent");
    const d = detail(r);
    expect(d.verdict).toBe("absent");
    expect(d.extension_declared).toBe(false);
    expect(d.fix).toMatch(/offer-receipt/);
  });

  it("found when a live probe declares the extension", () => {
    const r = checkerOfferReceiptDeclared(
      x402({ services: [{ method: "GET", path: "/paid" }] }, [
        probe({ declared: true, offers: 1, formats: ["eip712"] }),
      ]),
    );
    expect(r.outcome).toBe("found");
    const d = detail(r);
    expect(d.verdict).toBe("extension_declared");
    expect(d.extension_declared).toBe(true);
    expect(d.declared_in).toEqual(["probe"]);
    expect(d.offers).toBe(1);
    expect(d.formats).toEqual(["eip712"]);
    expect(d.endpoints).toEqual(["/paid"]);
  });

  it("found when only the manifest declares the extension", () => {
    const r = checkerOfferReceiptDeclared(x402(manifestExt([goodOffer]), []));
    expect(r.outcome).toBe("found");
    const d = detail(r);
    expect(d.declared_in).toEqual(["manifest"]);
  });

  it("merges declarations from manifest and probe", () => {
    const r = checkerOfferReceiptDeclared(
      x402(manifestExt([goodOffer]), [
        probe({ declared: true, offers: 2, formats: ["eip712", "jws"] }, "/checkout"),
      ]),
    );
    expect(r.outcome).toBe("found");
    const d = detail(r);
    expect(d.declared_in).toEqual(["manifest", "probe"]);
    expect(d.formats).toEqual(expect.arrayContaining(["eip712", "jws"]));
    expect(d.offers).toBe(3);
  });

  it("absent + malformed when the only declaration is broken", () => {
    const r = checkerOfferReceiptDeclared(
      x402({ services: [{ method: "GET", path: "/paid" }] }, [
        probe({ declared: true, offers: 0, formats: [], malformed: true }),
      ]),
    );
    expect(r.outcome).toBe("absent");
    const d = detail(r);
    expect(d.verdict).toBe("malformed");
    expect(d.extension_declared).toBe(true); // key seen, content unusable
    expect(d.fix).toMatch(/offer-receipt/);
  });

  it("a valid declaration wins over a malformed one elsewhere", () => {
    const badManifest = { services: [], extensions: { "offer-receipt": { info: { offers: [] } } } };
    const r = checkerOfferReceiptDeclared(
      x402(badManifest, [probe({ declared: true, offers: 1, formats: ["jws"] })]),
    );
    expect(r.outcome).toBe("found");
    const d = detail(r);
    expect(d.verdict).toBe("extension_declared");
  });

  it("honest framing: signature verification and key binding are NOT claimed", () => {
    const r = checkerOfferReceiptDeclared(
      x402(manifestExt([goodOffer]), [
        probe({ declared: true, offers: 1, formats: ["eip712"] }),
      ]),
    );
    const d = detail(r);
    expect(d.extension_signature_verified).toBe("not_implemented");
    expect(d.key_binding_verified).toBe("not_implemented");
    expect(String(d.summary)).toMatch(/declared/i);
    expect(String(d.summary)).not.toMatch(/signature (verified|valid)/i);
  });

  it("absent when the manifest parses but carries no extension and no probes ran", () => {
    const r = checkerOfferReceiptDeclared(x402({ services: [] }, []));
    expect(r.outcome).toBe("absent");
  });
});
