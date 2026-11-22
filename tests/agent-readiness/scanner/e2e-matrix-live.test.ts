// SLICE-258-11: live-domain rows replayed from recorded fixtures
// (fixtures/e2e-matrix/, recorded 2026-11-22 — no live network in CI).
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
  sites, doh, mockFetch, dns, dohOk, scan,
  LIVE_DNS, AB_MANIFEST, AB_CHALLENGE_HEADERS, SW_PAYMENT_REQUIRED,
  type RouteResp,
} from "./e2e-matrix/harness";

process.env.CACHE_ENABLED = "false";

beforeEach(() => {
  sites.clear();
  doh.clear();
  resetPayToDnsCache();
  vi.stubGlobal("fetch", mockFetch);
});

describe("E2E outcome matrix — live-domain replay (SLICE-258-11)", () => {
  it("agentbadge.xyz — VERIFIED dns_signed across the whole pipeline", async () => {
    const host = "agentbadge.xyz";
    dns(`_x402-payto.${host}`, dohOk({
      data: LIVE_DNS.records[`_x402-payto.${host}`]!.data,
      ttl: LIVE_DNS.records[`_x402-payto.${host}`]!.ttl,
    }));
    const headers: Record<string, string> = {};
    for (const line of AB_CHALLENGE_HEADERS.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    sites.set(
      host,
      new Map<string, RouteResp[]>([
        ["/.well-known/x402.json", [
          { status: 200, headers: { "content-type": "application/json" }, body: AB_MANIFEST },
        ]],
        ["GET /api/v1/demo/scan-lite", [
          { status: 402, headers: { "content-type": "application/json", ...headers }, body: "" },
          { status: 402, headers: { "content-type": "application/json", ...headers }, body: "" },
        ]],
      ]),
    );
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("VERIFIED");
    expect(r.detail("AB-188").verdict).toBe("verified");
    const pa = r.detail("AB-188").perAddress as { level?: string; signatureStatus: string }[];
    expect(pa.some((a) => a.level === "dns_signed" && a.signatureStatus === "valid")).toBe(true);
    // Same challenge carries an MPP rail — AB-189 sees it too.
    expect(r.assertion("AB-189").status).toBe("VERIFIED");
    // bazaar extension only — no offer-receipt declaration on this endpoint.
    expect(r.assertion("AB-190").status).toBe("GAP");
  });

  it("api.settlewatch.com — proof live, but no discoverable manifest → N/A", async () => {
    // Recorded reality (2026-11-22): DNS proof exists and /v1/check quotes
    // it, but the site serves no /.well-known/x402.json so the scanner has
    // no probe path. Documented ecosystem finding — see slice notes.
    const host = "api.settlewatch.com";
    dns(`_x402-payto.${host}`, dohOk({ data: LIVE_DNS.records[`_x402-payto.${host}`]!.data }));
    sites.set(
      host,
      new Map<string, RouteResp[]>([
        ["GET /v1/check", [{ status: 402, headers: { "payment-required": SW_PAYMENT_REQUIRED }, body: "" }]],
      ]),
    );
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
  });

  it("madebydevx.com — proof published, no x402 endpoints found → N/A", async () => {
    const host = "madebydevx.com";
    dns(`_x402-payto.${host}`, dohOk({ data: LIVE_DNS.records[`_x402-payto.${host}`]!.data }));
    sites.set(
      host,
      new Map<string, RouteResp[]>([
        ["/", [{ status: 200, headers: { "content-type": "text/html" }, body: "<html></html>" }]],
      ]),
    );
    const r = await scan(host);
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
  });
});
