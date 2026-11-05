/**
 * SLICE-206-15 (EPIC-206): demo micro-paywall scan-lite.
 *
 * Contracts:
 * - no payment rail → gate stub answers 402 before the route runs;
 * - settled payment (passthrough middleware) → 200 mini-scan result;
 * - missing/invalid/private-host url → 400, never reaches the fetcher;
 * - SSRF guard post-audit: redirects are re-validated per hop, DNS is
 *   resolved+checked before connect, numeric IP literals (which URL()
 *   normalizes to dotted), trailing dots, IPv6-mapped and CGNAT
 *   ranges are all refused;
 * - SKU registry advertises the endpoint at the env-derived price —
 *   /pricing.json stays the single source of truth (206-9).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { wireDemoX402 } from "../src/server/wiring/demo-x402";
import { demoApiRoutes } from "../src/server/routes/demo-api";
import { scanSkus } from "../src/server/lib/service-catalog/entries/scan";
import {
  demoScanPriceTag,
  demoScanPriceUsd,
  isPrivateAddress,
  runScanLite,
  validateTarget,
  type DnsLookupFn,
} from "../src/server/lib/demo-scan";
import type {
  CirclePaymentsRuntime,
  PaymentForOpts,
} from "../src/server/lib/circle-payments";

const PAGE = `<!doctype html><html><head>
<title>Agent-ready shop</title>
<meta property="og:title" content="Shop">
<meta property="og:description" content="We sell to agents">
<meta name="robots" content="index,follow">
<link rel="alternate" type="text/plain" href="/llms.txt">
<script type="application/ld+json">{"@type":"Organization"}</script>
</head><body></body></html>`;

const fakeFetch = vi.fn(async () =>
  new Response(PAGE, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  }),
);

/** Public lookup — pretend every host resolves somewhere public. */
const publicLookup: DnsLookupFn = async () => [{ address: "93.184.216.34" }];
/** Public literal — DNS guard skips IP literals entirely (no real DNS). */
const PUBLIC_URL = "https://93.184.216.34/";

/** Runtime whose gate is a stub 402 (payment not provided). */
function gatingRuntime(calls: { price?: unknown } = {}) {
  return {
    paymentForPrice(price: unknown, _opts?: PaymentForOpts) {
      calls.price = price;
      return async () =>
        new Response(JSON.stringify({ x402: true }), { status: 402 });
    },
  } as unknown as CirclePaymentsRuntime;
}

/** Runtime whose gate is transparent (payment already settled). */
function passingRuntime() {
  return {
    paymentForPrice(_p: unknown, _o?: PaymentForOpts) {
      return async (_c: unknown, next: () => Promise<void>) => next();
    },
  } as unknown as CirclePaymentsRuntime;
}

describe("GET /api/v1/demo/scan-lite", () => {
  beforeEach(() => fakeFetch.mockClear());

  it("402 before the route when the x402 gate is up", async () => {
    const app = new Hono();
    wireDemoX402(app, { runtime: gatingRuntime() });
    const res = await app.request(`/api/v1/demo/scan-lite?url=${PUBLIC_URL}`);
    expect(res.status).toBe(402);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("gate receives the env-derived price tag ($0.001 default)", async () => {
    const calls: { price?: unknown } = {};
    const app = new Hono();
    wireDemoX402(app, { runtime: gatingRuntime(calls) });
    await app.request(`/api/v1/demo/scan-lite?url=${PUBLIC_URL}`);
    expect(calls.price).toBe(demoScanPriceTag());
    expect(demoScanPriceUsd()).toBe("0.001");
  });

  it("no runtime → route not mounted (fail closed)", async () => {
    const app = new Hono();
    wireDemoX402(app, {});
    const res = await app.request(`/api/v1/demo/scan-lite?url=${PUBLIC_URL}`);
    expect(res.status).toBe(404);
  });

  it("200 with scan result once payment passed", async () => {
    const app = new Hono();
    wireDemoX402(app, { runtime: passingRuntime() });
    vi.stubGlobal("fetch", fakeFetch);
    const res = await app.request(`/api/v1/demo/scan-lite?url=${PUBLIC_URL}`);
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.price_usdc).toBe("0.001");
    expect(body.agent_ready_hint).toBe("likely");
    const signals = body.signals as Record<string, boolean>;
    expect(signals.has_llms_txt_link).toBe(true);
    expect(signals.has_json_ld).toBe(true);
    expect(body.upgrade).toBeDefined();
  });

  it("missing url → 400", async () => {
    const app = new Hono();
    app.route("/", demoApiRoutes);
    const res = await app.request("/api/v1/demo/scan-lite");
    expect(res.status).toBe(400);
  });

  it("private/loopback urls are refused before any fetch", async () => {
    for (const bad of [
      "http://localhost/x",
      "http://localhost./x",
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "ftp://example.com",
      "not-a-url",
    ]) {
      expect(validateTarget(bad)).not.toBeInstanceOf(URL);
    }
    const app = new Hono();
    app.route("/", demoApiRoutes);
    const res = await app.request(
      `/api/v1/demo/scan-lite?url=${encodeURIComponent("http://169.254.169.254/")}`,
    );
    expect(res.status).toBe(400);
  });
});

describe("isPrivateAddress / numeric-literal SSRF guard", () => {
  it("private v4 ranges + unspecified + benchmark + multicast", () => {
    for (const ip of [
      "0.0.0.0", "10.0.0.5", "127.0.0.1", "169.254.1.1",
      "172.16.0.1", "172.31.255.255", "192.168.0.1",
      "100.64.0.1", "100.127.255.255", "198.18.0.1",
      "224.0.0.1", "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });
  it("public v4 + hostname-shaped input pass", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("example.com")).toBe(false);
  });
  it("URL() normalizes decimal/hex/octal literals → guard catches", () => {
    for (const bad of [
      "http://2130706433/", // 127.0.0.1
      "http://0x7f000001/",
      "http://0177.0.0.1/",
      "http://127.1/",
    ]) {
      const r = validateTarget(bad);
      // Either URL() normalized it to 127.0.0.1 (blocked) or kept it —
      // either way it must NOT come back as a usable URL.
      expect(r instanceof URL && !isPrivateAddress(r.hostname)).toBe(false);
    }
  });
});

describe("runScanLite — fetch guards (post-audit)", () => {
  const pub = new URL("https://93.184.216.34/");

  it("extracts og + signals from html", async () => {
    const r = await runScanLite(pub, { fetchFn: fakeFetch });
    expect(typeof r).not.toBe("string");
    if (typeof r === "string") return;
    expect(r.og.title).toBe("Shop");
    expect(r.signals.has_json_ld).toBe(true);
    expect(r.agent_ready_hint).toBe("likely");
  });

  it("not_html on non-html content-type", async () => {
    const bin = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    expect(await runScanLite(pub, { fetchFn: bin })).toBe("not_html");
  });

  it("redirect to a private host is refused at the hop", async () => {
    const bounce = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" },
      }),
    );
    expect(await runScanLite(pub, { fetchFn: bounce })).toBe("blocked_host");
  });

  it("hostname resolving to a private A record → dns_private", async () => {
    fakeFetch.mockClear();
    const evilLookup: DnsLookupFn = async () => [{ address: "10.0.0.9" }];
    const hostname = new URL("https://rebind.example/");
    expect(
      await runScanLite(hostname, {
        fetchFn: fakeFetch,
        lookupFn: evilLookup,
      }),
    ).toBe("dns_private");
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("redirect loop → too_many_redirects", async () => {
    const loop = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://93.184.216.34/" },
      }),
    );
    expect(await runScanLite(pub, { fetchFn: loop })).toBe("too_many_redirects");
    expect(loop).toHaveBeenCalledTimes(4); // initial + 3 hops
  });

  it("good redirect chain is followed and succeeds", async () => {
    let n = 0;
    const hop = vi.fn(async () =>
      n++ === 0
        ? new Response(null, {
            status: 301,
            headers: { location: "https://93.184.216.34/ok" },
          })
        : new Response(PAGE, {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
    );
    const r = await runScanLite(pub, { fetchFn: hop });
    expect(typeof r).not.toBe("string");
    expect(hop).toHaveBeenCalledTimes(2);
  });

  it("public hostname resolves public → fetch proceeds", async () => {
    const r = await runScanLite(new URL("https://x.example/"), {
      fetchFn: fakeFetch,
      lookupFn: publicLookup,
    });
    expect(typeof r).not.toBe("string");
  });
});

describe("catalog SKU (pricing.json SoT)", () => {
  it("scan:demo-scan-lite exists at the env price", () => {
    const skus = scanSkus({
      bundles: [],
      full_scan_usd: "9.00",
      enabled: true,
    });
    const demo = skus.find((s) => s.sku_id === "scan:demo-scan-lite");
    expect(demo).toBeDefined();
    expect(demo!.price_usd).toBe(demoScanPriceUsd());
    expect(demo!.endpoint.path).toBe("/api/v1/demo/scan-lite");
    expect(demo!.auth).toBe("x402");
  });
});
