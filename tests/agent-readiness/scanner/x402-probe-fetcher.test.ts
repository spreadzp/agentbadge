// SLICE-258-4: x402 fetcher double-probe (D-258-Q12, C5) + manifest parsing.
// Pure helpers + injected probe transport — no live network in tests.
import { describe, it, expect } from "vitest";
import {
  pickProbeCandidates,
  acceptsFromPaymentPayload,
  probePayTosDivergent,
  fetchX402Discovery,
} from "../../../src/agent-readiness/scanner/fetchers/x402-fetcher";

const ADDR_A = "0xaaaabbbbccccddddeeeeffff0000111122223333";
const ADDR_B = "0x1111222233334444555566667777888899990000";

const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64");

describe("pickProbeCandidates", () => {
  it("extracts path+method from manifest services", () => {
    const m = { services: [{ method: "POST", path: "/api/pay" }, { path: "/api/other" }] };
    expect(pickProbeCandidates(m)).toEqual([
      { path: "/api/pay", method: "POST" },
      { path: "/api/other", method: "GET" },
    ]);
  });

  it("rejects absolute URLs and non-/ paths (manifest is hostile input)", () => {
    const m = {
      services: [
        { method: "GET", path: "https://evil.example/x" },
        { method: "GET", path: "//evil.example/x" },
        { method: "GET", path: "api/no-slash" },
        { method: "GET", path: "/api/ok" },
      ],
    };
    expect(pickProbeCandidates(m)).toEqual([{ path: "/api/ok", method: "GET" }]);
  });

  it("allows only GET/POST methods", () => {
    const m = { services: [
      { method: "DELETE", path: "/a" },
      { method: "post", path: "/b" },
    ] };
    expect(pickProbeCandidates(m)).toEqual([{ path: "/b", method: "POST" }]);
  });

  it("caps candidates and dedups", () => {
    const m = { services: [
      { method: "GET", path: "/a" },
      { method: "GET", path: "/a" },
      { method: "GET", path: "/b" },
      { method: "GET", path: "/c" },
      { method: "GET", path: "/d" },
    ] };
    const c = pickProbeCandidates(m);
    expect(c).toHaveLength(3);
    expect(new Set(c.map((x) => x.path)).size).toBe(c.length);
  });

  it("returns [] for non-object / missing services", () => {
    expect(pickProbeCandidates(null)).toEqual([]);
    expect(pickProbeCandidates({})).toEqual([]);
    expect(pickProbeCandidates({ services: "nope" })).toEqual([]);
  });
});

describe("acceptsFromPaymentPayload", () => {
  const acc = [{ scheme: "exact", network: "eip155:8453", asset: "USDC", payTo: ADDR_A }];

  it("decodes accepts[] from PAYMENT-REQUIRED header (base64)", () => {
    const headers = { "payment-required": b64({ accepts: acc }) };
    expect(acceptsFromPaymentPayload(headers, null)).toEqual(acc);
  });

  it("decodes accepts[] from WWW-Authenticate request= param", () => {
    const headers = { "www-authenticate": `Payment request="${b64({ accepts: acc })}"` };
    expect(acceptsFromPaymentPayload(headers, null)).toEqual(acc);
  });

  it("falls back to JSON body accepts[]", () => {
    expect(acceptsFromPaymentPayload({}, JSON.stringify({ x402Version: 1, accepts: acc }))).toEqual(acc);
  });

  it("returns null when nothing decodable", () => {
    expect(acceptsFromPaymentPayload({}, null)).toBeNull();
    expect(acceptsFromPaymentPayload({}, "not json")).toBeNull();
    expect(acceptsFromPaymentPayload({ "payment-required": "!!!notb64" }, null)).toBeNull();
  });
});

describe("probePayTosDivergent", () => {
  it("identical payTo sets → not divergent", () => {
    const a = { status: 402, observedAt: "t", accepts: [{ payTo: ADDR_A, asset: "USDC" }] };
    const b = { status: 402, observedAt: "t", accepts: [{ payTo: ADDR_A.toUpperCase().replace("0X", "0x"), asset: "USDC" }] };
    expect(probePayTosDivergent(a, b)).toBe(false);
  });

  it("different payTo sets → divergent (possible per-payment)", () => {
    const a = { status: 402, observedAt: "t", accepts: [{ payTo: ADDR_A }] };
    const b = { status: 402, observedAt: "t", accepts: [{ payTo: ADDR_B }] };
    expect(probePayTosDivergent(a, b)).toBe(true);
  });

  it("missing/failed second probe → not divergent", () => {
    const a = { status: 402, observedAt: "t", accepts: [{ payTo: ADDR_A }] };
    const b = { status: 0, observedAt: "t", accepts: null };
    expect(probePayTosDivergent(a, b)).toBe(false);
  });
});

describe("fetchX402Discovery — probe orchestration", () => {
  it("manifest without services → no probes, manifest parsed", async () => {
    const r = await fetchX402Discovery("http://localhost:1", {
      probeFn: async () => ({ status: 0, observedAt: "", accepts: null }),
      manifestResult: {
        status: 200,
        body: JSON.stringify({ x402Version: 1, payTo: ADDR_A, services: [] }),
        resolvedIp: null,
      },
    });
    expect(r.manifest).toEqual({ x402Version: 1, payTo: ADDR_A, services: [] });
    expect(r.probes).toEqual([]);
  });

  it("first 402 candidate gets a double-probe; non-402 candidates skipped", async () => {
    const calls: string[] = [];
    const r = await fetchX402Discovery("http://localhost:1", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({
          payTo: ADDR_A,
          services: [
            { method: "GET", path: "/free" },
            { method: "GET", path: "/paid" },
          ],
        }),
        resolvedIp: null,
      },
      probeFn: async (_base, path) => {
        calls.push(path);
        if (path === "/paid") {
          return { status: 402, observedAt: "t", accepts: [{ payTo: ADDR_A, network: "eip155:1" }] };
        }
        return { status: 200, observedAt: "t", accepts: null };
      },
    });
    // /free → one attempt (not 402, skipped); /paid → two attempts
    expect(calls).toEqual(["/free", "/paid", "/paid"]);
    expect(r.probes).toHaveLength(1);
    expect(r.probes[0].endpoint).toBe("/paid");
    expect(r.probes[0].divergent).toBe(false);
    expect(r.probes[0].attempts).toHaveLength(2);
  });

  it("divergent second probe is flagged", async () => {
    let n = 0;
    const r = await fetchX402Discovery("http://localhost:1", {
      manifestResult: {
        status: 200,
        body: JSON.stringify({ services: [{ method: "GET", path: "/paid" }] }),
        resolvedIp: null,
      },
      probeFn: async () => ({
        status: 402,
        observedAt: "t",
        accepts: [{ payTo: ++n === 1 ? ADDR_A : ADDR_B }],
      }),
    });
    expect(r.probes[0].divergent).toBe(true);
  });
});
