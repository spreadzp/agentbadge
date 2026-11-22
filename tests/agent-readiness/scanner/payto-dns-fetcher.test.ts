import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchPayToDns,
  paytoLookupNames,
  resetPayToDnsCache,
} from "../../../src/agent-readiness/scanner/fetchers/payto-dns-fetcher";

const PROOF_TXT =
  "v=x402payto1; a=0x9fB0d5a3F0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5; d=2026-01-01";

function dohOk(name: string, txts: string[], ttl = 300) {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: txts.map((data) => ({ name, type: 16, data, TTL: ttl })),
    }),
    { status: 200, headers: { "Content-Type": "application/dns-json" } },
  );
}
const dohNxdomain = () =>
  new Response(JSON.stringify({ Status: 3 }), { status: 200 });
const dohNoerror = () =>
  new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 });
const dohServfail = () =>
  new Response(JSON.stringify({ Status: 2 }), { status: 200 });

/** Build a fetch mock keyed by the `name=` DoH query param. */
function mockDoh(
  map: Record<string, () => Response>,
  fallback: () => Response = dohNxdomain,
) {
  return vi.fn().mockImplementation((url: string) => {
    const name = new URL(url).searchParams.get("name") ?? "";
    const host = new URL(url).hostname;
    const key = `${host}|${name}`;
    return Promise.resolve((map[key] ?? fallback)());
  });
}

const G = "dns.google";
const C = "cloudflare-dns.com";
const q = (d: string) => `_x402-payto.${d}`;

beforeEach(() => {
  resetPayToDnsCache();
  vi.unstubAllGlobals();
});

describe("paytoLookupNames", () => {
  it("walks host then parents, stopping before the registrable suffix", () => {
    expect(paytoLookupNames("api.pay.example.com")).toEqual([
      "api.pay.example.com",
      "pay.example.com",
      "example.com",
    ]);
  });
  it("stops at shared-hosting suffixes", () => {
    // Only the exact hostname — never the shared parent itself.
    expect(paytoLookupNames("myapp.onrender.com")).toEqual([
      "myapp.onrender.com",
    ]);
    expect(paytoLookupNames("api.myapp.onrender.com")).toEqual([
      "api.myapp.onrender.com",
      "myapp.onrender.com",
    ]);
  });
});

describe("fetchPayToDns", () => {
  it("direct hit returns records + hitName", async () => {
    const fetchMock = mockDoh({
      [`${G}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
      [`${C}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPayToDns("example.com");
    expect(r.status).toBe("hit");
    expect(r.hitName).toBe(q("example.com"));
    expect(r.records).toHaveLength(1);
    expect(r.records[0].ttl).toBe(300);
  });

  it("walks to a parent when the exact name is absent", async () => {
    const fetchMock = mockDoh({
      [`${G}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
      [`${C}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPayToDns("api.example.com");
    expect(r.status).toBe("hit");
    expect(r.hitName).toBe(q("example.com"));
  });

  it("absent everywhere -> absent", async () => {
    vi.stubGlobal("fetch", mockDoh({}));
    const r = await fetchPayToDns("nothing.example.com");
    expect(r.status).toBe("absent");
    expect(r.records).toEqual([]);
  });

  it("NOERROR-empty counts as absent too", async () => {
    vi.stubGlobal("fetch", mockDoh({}, dohNoerror));
    const r = await fetchPayToDns("empty.example.com");
    expect(r.status).toBe("absent");
  });

  it("does not accept a record on a shared-hosting parent", async () => {
    const fetchMock = mockDoh({
      // child has nothing; onrender.com itself HAS a record — must not count
      [`${G}|${q("onrender.com")}`]: () => dohOk(q("onrender.com"), [PROOF_TXT]),
      [`${C}|${q("onrender.com")}`]: () => dohOk(q("onrender.com"), [PROOF_TXT]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPayToDns("customer.onrender.com");
    expect(r.status).toBe("absent");
    expect(r.pslStopped).toBe(true);
  });

  it("SERVFAIL on both resolvers -> unchecked, not absent", async () => {
    vi.stubGlobal("fetch", mockDoh({}, dohServfail));
    const r = await fetchPayToDns("down.example.com");
    expect(r.status).toBe("unchecked");
  });

  it("transport failure on both resolvers -> unchecked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const r = await fetchPayToDns("dead.example.com");
    expect(r.status).toBe("unchecked");
  });

  it("stops the walk on resolver failure (does not treat as absent)", async () => {
    const fetchMock = mockDoh(
      {
        [`${G}|${q("api.example.com")}`]: dohServfail,
        [`${C}|${q("api.example.com")}`]: dohServfail,
      },
      () => dohOk("_x402-payto.example.com", [PROOF_TXT]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPayToDns("api.example.com");
    expect(r.status).toBe("unchecked");
  });

  it("resolver disagreement -> unchecked", async () => {
    const fetchMock = mockDoh({
      [`${G}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
      [`${C}|${q("example.com")}`]: () =>
        dohOk(q("example.com"), ["v=x402payto1; a=0xDIFFERENT"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPayToDns("example.com");
    expect(r.status).toBe("unchecked");
  });

  it("RFC-1035 quoting differences are not disagreement", async () => {
    // dns.google returns bare strings; cloudflare-dns returns the
    // quoted presentation form. Same value -> same record -> hit.
    // (Found dogfooding: our own _x402-payto record read `unchecked`.)
    const fetchMock = mockDoh({
      [`${G}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
      [`${C}|${q("example.com")}`]: () =>
        dohOk(q("example.com"), [`"${PROOF_TXT}"`]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPayToDns("example.com");
    expect(r.status).toBe("hit");
  });

  it("caches positive results — second call issues zero DoH requests", async () => {
    const fetchMock = mockDoh({
      [`${G}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
      [`${C}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchPayToDns("example.com");
    const calls = fetchMock.mock.calls.length;
    const r2 = await fetchPayToDns("example.com");
    expect(r2.fromCache).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("does not cache unchecked results", async () => {
    const fetchMock = mockDoh({}, dohServfail);
    vi.stubGlobal("fetch", fetchMock);
    await fetchPayToDns("flaky.example.com");
    const calls = fetchMock.mock.calls.length;
    const r2 = await fetchPayToDns("flaky.example.com");
    expect(r2.fromCache).toBe(false);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("rate-limits live rechecks to once per minute per domain", async () => {
    const fetchMock = mockDoh({
      [`${G}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
      [`${C}|${q("example.com")}`]: () => dohOk(q("example.com"), [PROOF_TXT]),
    });
    vi.stubGlobal("fetch", fetchMock);
    await fetchPayToDns("example.com");
    const calls = fetchMock.mock.calls.length;
    const r2 = await fetchPayToDns("example.com", { forceRecheck: true });
    expect(fetchMock.mock.calls.length).toBe(calls); // throttled
    expect(r2.fromCache).toBe(true);
  });
});
