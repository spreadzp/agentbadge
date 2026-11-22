// SLICE-258-11: e2e outcome matrix — AB-189 (MPP) + AB-190
// (offer-receipt) scenarios. Same harness, file-scoped mocks.
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
  sites, doh, mockFetch, dns, dohOk, x402Site, paid402, l402Mpp,
  accept, txt, scan, SIGNED_ADDR, ADDR_A,
} from "./e2e-matrix/harness";

process.env.CACHE_ENABLED = "false";

beforeEach(() => {
  sites.clear();
  doh.clear();
  resetPayToDnsCache();
  vi.stubGlobal("fetch", mockFetch);
});

describe("E2E outcome matrix — AB-189 / AB-190 (SLICE-258-11)", () => {
  it("MPP-only site with recipient proof → AB-189 VERIFIED, AB-188 N/A", async () => {
    const host = "mpp.example.com";
    dns(`_x402-payto.${host}`, dohOk({ data: txt(SIGNED_ADDR) }));
    x402Site(host, {
      manifest: false,
      l402: [l402Mpp(SIGNED_ADDR), l402Mpp(SIGNED_ADDR)],
    });
    const r = await scan(host);
    expect(r.assertion("AB-189").status).toBe("VERIFIED");
    expect(
      (r.detail("AB-189").perAddress as { evidence_tier?: string }[])[0]?.evidence_tier,
    ).toBe("live_mpp");
    expect(r.assertion("AB-188").status).toBe("NOT_APPLICABLE");
  });

  it("MPP site without proof → AB-189 GAP recommendation, not fail", async () => {
    const host = "mppbare.example.com";
    x402Site(host, { manifest: false, l402: [l402Mpp(ADDR_A), l402Mpp(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-189").status).toBe("GAP");
    const gaps = r.report.gaps.filter((g) => g.related_rules.includes("AB-189"));
    expect(gaps.length).toBe(1);
    expect(["LOW", "MEDIUM"]).toContain(gaps[0]!.priority);
  });

  it("offer-receipt declared in live 402 → AB-190 VERIFIED (presence only)", async () => {
    const host = "ofr.example.com";
    const offerExt = {
      "offer-receipt": {
        info: { offers: [{ format: "eip712", payload: { version: 1 }, signature: "0xabc" }] },
      },
    };
    const probes = [
      paid402([accept(ADDR_A)], { extensions: offerExt }),
      paid402([accept(ADDR_A)], { extensions: offerExt }),
    ];
    x402Site(host, { probes });
    const r = await scan(host);
    expect(r.assertion("AB-190").status).toBe("VERIFIED");
    const d = r.detail("AB-190");
    expect(d.extension_declared).toBe(true);
    expect(d.extension_signature_verified).toBe("not_implemented");
    expect(d.key_binding_verified).toBe("not_implemented");
    expect(d.declared_in).toEqual(["probe"]);
  });

  it("offer-receipt absent on a paying site → AB-190 GAP + fix", async () => {
    const host = "noofr.example.com";
    x402Site(host, { accepts: [accept(ADDR_A)] });
    const r = await scan(host);
    expect(r.assertion("AB-190").status).toBe("GAP");
    expect(String(r.detail("AB-190").fix)).toContain("offer-receipt");
  });
});
