// EPIC-262 (SLICE-262-4 corpus): audit-259 declaration-consistency
// checkers ported into the intel engine — well-known doc parsing,
// kid-unification, placeholder digests, advertised-URL fan-out,
// declared-vs-served prices (R-023…R-027).
import { describe, it, expect } from "vitest";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import {
  runScanJob,
  SCAN_PLAN,
  type ScanJob,
  type ScanFetch,
  type ScanObservation,
} from "../../src/server/lib/intel/scan";
import {
  wellKnownFacts,
  collectAdvertisedUrls,
  paidAccepts,
  fannedToSubmissions,
} from "../../src/server/lib/intel/scan/declarations";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import type { CanonicalEnvelope } from "../../src/server/lib/intel/evidence/envelope";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const canned = (
  status = 200,
  body = "ok",
  headers: Record<string, string> = {},
): ScanObservation => ({
  status,
  headers,
  bodyText: body,
  resolvedIp: "203.0.113.5",
});

// ─── a site with a full, consistent declaration surface ───────────
const DID = JSON.stringify({
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: "did:web:site.test",
  verificationMethod: [
    {
      id: "did:web:site.test#owner",
      type: "Ed25519VerificationKey2020",
      publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "KEY_AAA" },
    },
  ],
});
const JWKS = JSON.stringify({
  keys: [{ kid: "did:web:site.test#owner", kty: "OKP", x: "KEY_AAA" }],
});
const CARD = JSON.stringify({
  endpoints: {
    api: "https://site.test/api",
    paid: "https://site.test/paid",
  },
});
const WBA = JSON.stringify({
  keys: [{ kid: "did:web:site.test#owner", x: "KEY_AAA" }],
});
const PRICING = JSON.stringify({
  offers: [{ price: "100", asset: "USDC" }],
});
const PAID_402 = JSON.stringify({
  accepts: [{ maxAmountRequired: "100", asset: "USDC" }],
});

const BASE_URL = "https://site.test";

const declFetch = (over: Record<string, ScanObservation | Error>): ScanFetch =>
  async (url) => {
    const path = new URL(url).pathname;
    for (const [suffix, v] of Object.entries(over)) {
      if (path.endsWith(suffix)) {
        if (v instanceof Error) throw v;
        return v;
      }
    }
    if (path.endsWith("/did.json")) return canned(200, DID, CT_JSON);
    if (path.endsWith("/jwks.json")) return canned(200, JWKS, CT_JSON);
    if (path.endsWith("/agent-card.json")) return canned(200, CARD, CT_JSON);
    if (path.endsWith("/http-message-signatures-directory"))
      return canned(200, WBA, CT_JSON);
    if (path.endsWith("/agent-start.json")) return canned(200, "{}", CT_JSON);
    if (path.endsWith("/x402-payto.json"))
      return canned(200, JSON.stringify({ version: 1, payTo: [] }), CT_JSON);
    if (path.endsWith("/agent.json")) return canned(200, "{}", CT_JSON);
    if (path.endsWith("/pricing.json")) return canned(200, PRICING, CT_JSON);
    if (path.endsWith("/paid"))
      return canned(402, PAID_402, CT_JSON);
    if (path.endsWith("/api")) return canned(200, "{}", CT_JSON);
    return canned(404);
  };
const CT_JSON = { "content-type": "application/json" };

function mkJob(over: Partial<ScanJob> = {}): ScanJob {
  return {
    id: "job_d1",
    siteId: "site_d",
    tenantId: "tnt_d",
    scanId: "scan_d1",
    correlationId: null,
    status: "queued",
    baseUrl: BASE_URL,
    probeFailures: 0,
    probeTotal: SCAN_PLAN.length,
    error: null,
    reportId: null,
    report: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    finishedAt: null,
    ...over,
  };
}

const NOW = new Date("2026-11-20T10:00:00Z");
const depsFor = (fetch: ScanFetch) => ({
  fetch,
  evidence: createMemoryIntelEvidenceStore(),
  jobs: createMemoryScanJobStore(),
  key,
  ruleset: INTEL_WP_PROFILE_V1,
  now: () => NOW,
});
const finding = (job: ScanJob, id: string) =>
  job.report!.findings.find((f) => f.rule_id === id);

// ─── parsers ──────────────────────────────────────────────────────
describe("wellKnownFacts", () => {
  it("unparseable doc → parse_ok:false, nothing else claimed", () => {
    expect(wellKnownFacts("{not json")).toEqual({ parse_ok: false });
  });
  it("did.json verificationMethod → kid↔x pair", () => {
    const f = wellKnownFacts(DID);
    expect(f.parse_ok).toBe(true);
    expect(f.key_pairs).toEqual([
      { kid: "did:web:site.test#owner", x: "KEY_AAA" },
    ]);
  });
  it("jwks keys[] → kid↔x pair", () => {
    const f = wellKnownFacts(JWKS);
    expect(f.key_pairs).toEqual([
      { kid: "did:web:site.test#owner", x: "KEY_AAA" },
    ]);
  });
  it("all-zeros sha256 → placeholder digest path", () => {
    const f = wellKnownFacts(
      JSON.stringify({ signature: { sha256: "0".repeat(64) } }),
    );
    expect(f.placeholder_digests).toEqual(["signature.sha256"]);
  });
  it("real digest ≠ placeholder", () => {
    const f = wellKnownFacts(
      JSON.stringify({ sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }),
    );
    expect(f.placeholder_digests).toEqual([]);
  });
  it("urls + prices harvested, capped", () => {
    const f = wellKnownFacts(CARD);
    expect(f.advertised_urls).toContain("https://site.test/api");
    const p = wellKnownFacts(PRICING);
    expect(p.declared_prices).toEqual([{ amount: "100", asset: "USDC" }]);
  });
});

describe("collectAdvertisedUrls", () => {
  const envOf = (urls: string[]): CanonicalEnvelope =>
    ({
      payload: {
        type: "document_fact",
        doc_type: "well_known",
        url: "https://site.test/x.json",
        facts: { advertised_urls: urls },
      },
    }) as unknown as CanonicalEnvelope;
  it("same-origin only, deduped, capped at 8", () => {
    const urls = [
      "https://site.test/a",
      "https://site.test/a",
      "https://evil.test/b",
      "not-a-url",
      ...Array.from({ length: 10 }, (_, i) => `https://site.test/u${i}`),
    ];
    const got = collectAdvertisedUrls([envOf(urls)], BASE_URL);
    expect(got[0]).toBe("https://site.test/a");
    expect(got.every((u) => u.startsWith(BASE_URL))).toBe(true);
    expect(got.length).toBeLessThanOrEqual(8);
  });
});

describe("paidAccepts + fannedToSubmissions", () => {
  it("402 accepts[] → demanded prices", () => {
    expect(paidAccepts(PAID_402)).toEqual([
      { amount: "100", asset: "USDC" },
    ]);
    expect(paidAccepts("{bad")).toEqual([]);
  });
  it("transport failure → docFact reachable:false, no http obs", () => {
    const subs = fannedToSubmissions({
      siteId: "s",
      scanId: "sc",
      collectorId: "c",
      collectedAt: "t",
      url: "https://site.test/gone",
      obs: null,
    });
    expect(subs).toHaveLength(1);
    expect(subs[0].payload.type).toBe("document_fact");
    if (subs[0].payload.type === "document_fact") {
      expect(subs[0].payload.facts.reachable).toBe(false);
    }
  });
  it("402 obs → paid_accepts carried into the docFact", () => {
    const subs = fannedToSubmissions({
      siteId: "s",
      scanId: "sc",
      collectorId: "c",
      collectedAt: "t",
      url: "https://site.test/paid",
      obs: canned(402, PAID_402, CT_JSON),
    });
    expect(subs).toHaveLength(2);
    const df = subs.find((s) => s.payload.type === "document_fact")!;
    if (df.payload.type === "document_fact") {
      expect(df.payload.facts.paid_accepts).toEqual([
        { amount: "100", asset: "USDC" },
      ]);
      expect(df.payload.facts.reachable).toBe(true);
    }
  });
});

// ─── rules end-to-end via the runner ──────────────────────────────
describe("declaration-consistency rules (R-023…R-027)", () => {
  it("consistent site → all five pass", async () => {
    const job = await runScanJob(mkJob(), depsFor(declFetch({})));
    expect(job.status).toBe("complete");
    for (const id of ["023", "024", "025", "026", "027"]) {
      expect(finding(job, `AB-INTEL-R-${id}`)!.status).toBe("pass");
    }
  });

  it("unparseable well-known doc → R-023 fail", async () => {
    const job = await runScanJob(
      mkJob(),
      depsFor(declFetch({ "agent-card.json": canned(200, "{broken") })),
    );
    expect(finding(job, "AB-INTEL-R-023")!.status).toBe("fail");
  });

  it("same key under different kids → R-024 fail", async () => {
    const job = await runScanJob(
      mkJob(),
      depsFor(
        declFetch({
          "jwks.json": canned(
            200,
            JSON.stringify({ keys: [{ kid: "OTHER", x: "KEY_AAA" }] }),
            CT_JSON,
          ),
        }),
      ),
    );
    expect(finding(job, "AB-INTEL-R-024")!.status).toBe("fail");
  });

  it("all-zero sha256 in a doc → R-025 fail", async () => {
    const job = await runScanJob(
      mkJob(),
      depsFor(
        declFetch({
          "agent-start.json": canned(
            200,
            JSON.stringify({ manifest: { sha256: "0".repeat(64) } }),
            CT_JSON,
          ),
        }),
      ),
    );
    expect(finding(job, "AB-INTEL-R-025")!.status).toBe("fail");
  });

  it("advertised url 404 → R-026 fail", async () => {
    const job = await runScanJob(
      mkJob(),
      depsFor(
        declFetch({
          "agent-card.json": canned(
            200,
            JSON.stringify({
              endpoints: { gone: "https://site.test/gone" },
            }),
            CT_JSON,
          ),
          gone: canned(404),
        }),
      ),
    );
    const f = finding(job, "AB-INTEL-R-026")!;
    expect(f.status).toBe("fail");
    expect(f.reason).toContain("/gone");
  });

  it("served 402 price absent from declarations → R-027 fail", async () => {
    const job = await runScanJob(
      mkJob(),
      depsFor(
        declFetch({
          paid: canned(
            402,
            JSON.stringify({
              accepts: [{ maxAmountRequired: "999", asset: "USDC" }],
            }),
            CT_JSON,
          ),
        }),
      ),
    );
    expect(finding(job, "AB-INTEL-R-027")!.status).toBe("fail");
  });

  it("no declaration docs at all → corpus rules unknown, not pass", async () => {
    const bare: ScanFetch = async () => canned(404); // 404 = answered, not a transport failure
    const job = await runScanJob(mkJob(), depsFor(bare));
    expect(job.status).toBe("complete");
    for (const id of ["023", "024", "025", "026", "027"]) {
      expect(finding(job, `AB-INTEL-R-${id}`)!.status).toBe("unknown");
    }
  });
});
