/**
 * SLICE-200-08 (EPIC-200, D-200-2): MCP abuse-guard — three layers on
 * /mcp + /mcp/:namespace:
 *   1. per-IP sliding-window bucket (JSON-RPC root paths were unlimited)
 *   2. keyed tier lanes (agentKeyAuth agentId → own bucket, wider cap)
 *   3. heavy-ops — dedicated stricter bucket + optional x402 gate seam
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { Hono, type Context, type Next, type MiddlewareHandler } from "hono";
import {
  mcpAbuseGuard,
  setMcpHeavyGate,
  DEFAULT_HEAVY_OPS,
} from "../src/server/middleware/mcp-abuse-guard";
import {
  armMcpHeavyGate,
  MCP_TIER_RPM,
  resolveMcpAbuseTier,
} from "../src/server/wiring/mcp-abuse";
import {
  upsert as dirUpsert,
  clear as dirClear,
} from "@agentbadge/passport";
import { resetConfigCache } from "../src/config/env";
import type { CirclePaymentsRuntime } from "../src/server/lib/circle-payments";

const IP = "203.0.113.7";
const rpcBody = (name?: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: name ? { name, arguments: {} } : {},
  });

function postJson(url: string, body: string, ip = IP) {
  return new Request(`http://t${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": ip },
    body,
  });
}

interface BuildOpts {
  anonMax?: number;
  keyedMax?: number;
  heavyMax?: number;
  heavyOps?: readonly string[];
  /** simulate agentKeyAuth enrichment for keyed-lane tests */
  agentId?: string;
  agentTier?: string;
}

function buildApp(o: BuildOpts = {}) {
  const app = new Hono();

  // Simulate agentKeyAuth enrichment — must run before the guard.
  if (o.agentId || o.agentTier) {
    const enrich = async (c: Context, next: Next) => {
      if (o.agentId) c.set("agentId", o.agentId);
      c.set("agentTier", o.agentTier ?? "anon");
      await next();
    };
    app.use("/mcp", enrich);
    app.use("/mcp/*", enrich);
  }

  const guard = mcpAbuseGuard({
    anonMax: o.anonMax,
    keyedMax: o.keyedMax,
    heavyMax: o.heavyMax,
    heavyOps: o.heavyOps,
  });
  app.use("/mcp", guard);
  app.use("/mcp/*", guard);

  const ok = (c: Context) => c.json({ ok: true });
  app.post("/mcp", ok);
  app.post("/mcp/tools/:name", ok);
  app.post("/mcp/audit/tools/:name", ok);
  app.get("/mcp", ok);
  app.get("/health", ok);
  return app;
}

afterEach(() => {
  setMcpHeavyGate(undefined);
});

describe("mcpAbuseGuard — layer 1: per-IP bucket", () => {
  it("allows up to anonMax requests then 429s on the JSON-RPC root", async () => {
    const app = buildApp({ anonMax: 2 });
    expect((await app.request(postJson("/mcp", rpcBody("ping")))).status).toBe(200);
    expect((await app.request(postJson("/mcp", rpcBody("ping")))).status).toBe(200);
    const res = await app.request(postJson("/mcp", rpcBody("ping")));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("RATE_LIMITED");
  });

  it("covers namespace JSON-RPC roots (/mcp/:ns) — previously unlimited", async () => {
    const app = buildApp({ anonMax: 1 });
    const r1 = await app.request(postJson("/mcp/audit/tools/get_audit_trail", "{}"));
    expect(r1.status).toBe(200);
    const r2 = await app.request(postJson("/mcp/audit/tools/get_audit_trail", "{}"));
    expect(r2.status).toBe(429);
  });

  it("covers GET /mcp SSE endpoint", async () => {
    const app = buildApp({ anonMax: 1 });
    const mk = () =>
      new Request("http://t/mcp", {
        headers: { "fly-client-ip": IP, accept: "text/event-stream" },
      });
    expect((await app.request(mk())).status).toBe(200);
    expect((await app.request(mk())).status).toBe(429);
  });

  it("sets X-RateLimit-* headers on allowed requests", async () => {
    const app = buildApp({ anonMax: 3 });
    const res = await app.request(postJson("/mcp", rpcBody("ping")));
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("2");
    expect(res.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("buckets per IP — a second IP gets its own allowance", async () => {
    const app = buildApp({ anonMax: 1 });
    expect((await app.request(postJson("/mcp", rpcBody(), IP))).status).toBe(200);
    expect((await app.request(postJson("/mcp", rpcBody(), IP))).status).toBe(429);
    expect(
      (await app.request(postJson("/mcp", rpcBody(), "198.51.100.9"))).status,
    ).toBe(200);
  });

  it("does not touch non-/mcp routes", async () => {
    const app = buildApp({ anonMax: 1 });
    const mk = () => new Request("http://t/health", { headers: { "fly-client-ip": IP } });
    for (let i = 0; i < 5; i++) {
      expect((await app.request(mk())).status).toBe(200);
    }
  });
});

describe("mcpAbuseGuard — layer 2: keyed tier lane", () => {
  it("keyed agent gets its own bucket with the wider cap", async () => {
    const app = buildApp({ anonMax: 1, keyedMax: 3, agentId: "agent-1", agentTier: "observer" });
    // 3 keyed calls pass even though anonMax=1
    for (let i = 0; i < 3; i++) {
      expect((await app.request(postJson("/mcp", rpcBody("ping")))).status).toBe(200);
    }
    expect((await app.request(postJson("/mcp", rpcBody("ping")))).status).toBe(429);
  });

  it("keyed lane does not consume the caller's IP bucket", async () => {
    // Two apps sharing scenario: keyed app + anon app same IP — build one app
    // that flips identity per request via query flag.
    const app = new Hono();
    const flip = async (c: Context, next: Next) => {
      if (c.req.query("keyed")) {
        c.set("agentId", "agent-9");
        c.set("agentTier", "observer");
      } else {
        c.set("agentTier", "anon");
      }
      await next();
    };
    app.use("/mcp", flip);
    app.use("/mcp/*", flip);
    const guard = mcpAbuseGuard({ anonMax: 1, keyedMax: 2 });
    app.use("/mcp", guard);
    app.use("/mcp/*", guard);
    app.post("/mcp", (c) => c.json({ ok: true }));

    const mk = (keyed: boolean) =>
      new Request(`http://t/mcp${keyed ? "?keyed=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json", "fly-client-ip": IP },
        body: rpcBody("ping"),
      });

    expect((await app.request(mk(false))).status).toBe(200);
    expect((await app.request(mk(false))).status).toBe(429); // anon lane full
    // keyed lane still has capacity for the same IP
    expect((await app.request(mk(true))).status).toBe(200);
    expect((await app.request(mk(true))).status).toBe(200);
    expect((await app.request(mk(true))).status).toBe(429); // keyed lane full
  });
});

describe("mcpAbuseGuard — layer 3: heavy-ops", () => {
  it("default heavy list includes future arc_send_raw_tx + mutating ops", () => {
    expect(DEFAULT_HEAVY_OPS).toContain("arc_send_raw_tx");
    expect(DEFAULT_HEAVY_OPS).toContain("request_passport");
    expect(DEFAULT_HEAVY_OPS).toContain("sign_transaction");
  });

  it("REST /mcp/tools/<heavy> hits the heavy bucket", async () => {
    const app = buildApp({ anonMax: 100, heavyMax: 1 });
    const mk = () => postJson("/mcp/tools/request_passport", "{}");
    expect((await app.request(mk())).status).toBe(200);
    expect((await app.request(mk())).status).toBe(429);
  });

  it("JSON-RPC tools/call <heavy> hits the heavy bucket without breaking the body", async () => {
    const app = new Hono();
    const guard = mcpAbuseGuard({ anonMax: 100, heavyMax: 1 });
    app.use("/mcp", guard);
    app.use("/mcp/*", guard);
    app.post("/mcp", async (c) => {
      // downstream must still be able to read the body
      const body = await c.req.json();
      return c.json({ ok: true, sawName: body?.params?.name });
    });

    const call = rpcBody("sign_transaction");
    const r1 = await app.request(postJson("/mcp", call));
    expect(r1.status).toBe(200);
    expect((await r1.json()).sawName).toBe("sign_transaction");
    const r2 = await app.request(postJson("/mcp", call));
    expect(r2.status).toBe(429);
  });

  it("heavy bucket is separate — light tools still pass when heavy is exhausted", async () => {
    const app = buildApp({ anonMax: 100, heavyMax: 1 });
    await app.request(postJson("/mcp/tools/request_passport", "{}"));
    expect((await app.request(postJson("/mcp/tools/request_passport", "{}"))).status).toBe(429);
    // light tool still fine
    expect((await app.request(postJson("/mcp/tools/get_guide", "{}"))).status).toBe(200);
  });

  it("heavyGate delegates when set (x402 seam)", async () => {
    const gate: MiddlewareHandler = async (c) => c.json({ error: "payment required" }, 402);
    setMcpHeavyGate(gate);
    const app = buildApp({ anonMax: 100, heavyMax: 100 });
    const res = await app.request(postJson("/mcp/tools/arc_send_raw_tx", "{}"));
    expect(res.status).toBe(402);
    // light tool bypasses the gate
    expect((await app.request(postJson("/mcp/tools/get_guide", "{}"))).status).toBe(200);
  });

  it("custom heavyOps list replaces the default", async () => {
    const app = buildApp({ anonMax: 100, heavyMax: 1, heavyOps: ["get_guide"] });
    expect((await app.request(postJson("/mcp/tools/request_passport", "{}"))).status).toBe(200);
    expect((await app.request(postJson("/mcp/tools/request_passport", "{}"))).status).toBe(200);
    expect((await app.request(postJson("/mcp/tools/get_guide", "{}"))).status).toBe(200);
    expect((await app.request(postJson("/mcp/tools/get_guide", "{}"))).status).toBe(429);
  });
});

// ─── Layer 2b: verified-DID passport-tier lanes ──────────
// verifiedDid is set ONLY by did-auth's signature check — this is the
// trusted channel that elevates a request to its passport tier lane.

const DID_A = "did:hedera:testnet:0.0.71001";
const DID_B = "did:hedera:testnet:0.0.71002";

function seedDir(did: string, tier: "bronze" | "silver" | "gold" | "platinum") {
  dirUpsert({
    did,
    tokenId: "0.0.999",
    serial: 1,
    accountId: did.split(":").pop() ?? "0.0.0",
    name: "test-agent",
    capabilities: [],
    endpoint: "",
    tier,
    timestamp: Date.now(),
  });
}

function buildDidApp(opts: {
  verifiedDid?: string;
  keyedMax?: number;
  tierMax?: Record<string, number>;
} = {}) {
  const app = new Hono();
  const setDid = async (c: Context, next: Next) => {
    if (opts.verifiedDid) c.set("verifiedDid", opts.verifiedDid);
    await next();
  };
  app.use("/mcp", setDid);
  app.use("/mcp/*", setDid);
  app.use(
    "/mcp",
    mcpAbuseGuard({
      anonMax: 2,
      keyedMax: opts.keyedMax ?? 3,
      tierMax: opts.tierMax ?? MCP_TIER_RPM,
      resolveTier: resolveMcpAbuseTier,
    }),
  );
  app.use(
    "/mcp/*",
    mcpAbuseGuard({
      anonMax: 2,
      keyedMax: opts.keyedMax ?? 3,
      tierMax: opts.tierMax ?? MCP_TIER_RPM,
      resolveTier: resolveMcpAbuseTier,
    }),
  );
  app.post("/mcp", (c) => c.json({ ok: true }));
  app.get("/mcp", (c) => c.json({ ok: true }));
  return app;
}

afterEach(() => dirClear());

describe("mcpAbuseGuard — layer 2b: verified-DID passport tiers", () => {
  it("resolveMcpAbuseTier returns directory tier for a known DID", async () => {
    seedDir(DID_A, "platinum");
    const app = buildDidApp({ verifiedDid: DID_A });
    const res = await app.request(postJson("/mcp", rpcBody("ping")));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe(String(MCP_TIER_RPM.platinum));
  });

  it("verified DID unknown to the directory falls back to keyedMax", async () => {
    const app = buildDidApp({ verifiedDid: DID_A, keyedMax: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await app.request(postJson("/mcp", rpcBody("ping")))).status).toBe(200);
    }
    expect((await app.request(postJson("/mcp", rpcBody("ping")))).status).toBe(429);
  });

  it("did:<did> lanes are isolated — same IP, two DIDs, own buckets", async () => {
    seedDir(DID_A, "bronze");
    seedDir(DID_B, "bronze");
    const appA = buildDidApp({ verifiedDid: DID_A, keyedMax: 1 });
    const appB = buildDidApp({ verifiedDid: DID_B, keyedMax: 1 });
    // Note: two apps = two stores; assert lane keys differ via shared app instead
    const shared = new Hono();
    const pickDid = async (c: Context, next: Next) => {
      const did = c.req.header("x-test-did");
      if (did) c.set("verifiedDid", did);
      await next();
    };
    shared.use("/mcp", pickDid);
    shared.use("/mcp/*", pickDid);
    const guard = mcpAbuseGuard({
      anonMax: 1,
      keyedMax: 1,
      // tiny tier caps so 429 arrives quickly — tierMax legitimately
      // overrides keyedMax for tier-resolved DID lanes
      tierMax: { bronze: 1 },
      resolveTier: resolveMcpAbuseTier,
    });
    shared.use("/mcp", guard);
    shared.use("/mcp/*", guard);
    shared.post("/mcp", (c) => c.json({ ok: true }));
    void appA;
    void appB;
    const withDid = (did: string) =>
      new Request("http://t/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "fly-client-ip": IP,
          "x-test-did": did,
        },
        body: rpcBody("ping"),
      });
    expect((await shared.request(withDid(DID_A))).status).toBe(200);
    expect((await shared.request(withDid(DID_A))).status).toBe(429);
    // Different DID — own lane, still allowed on the same IP
    expect((await shared.request(withDid(DID_B))).status).toBe(200);
  });

  it("no verifiedDid → anonymous IP lane even when the DID exists in the directory", async () => {
    seedDir(DID_A, "platinum");
    const app = buildDidApp(); // verifiedDid never set
    const res = await app.request(postJson("/mcp", rpcBody("ping")));
    expect(res.headers.get("X-RateLimit-Limit")).toBe("2"); // anonMax, not platinum
  });
});

// ─── armMcpHeavyGate — x402 seam e2e ─────────────────────

const ENV_KEYS = ["MCP_HEAVY_X402_PRICE", "MCP_HEAVY_X402_PAYTO"] as const;
const envBak: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBak[k] === undefined) delete process.env[k];
    else process.env[k] = envBak[k];
    delete envBak[k];
  }
  resetConfigCache();
});

function stubRuntime(gate: MiddlewareHandler): CirclePaymentsRuntime {
  return {
    paymentForPrice: vi.fn(() => gate),
  } as unknown as CirclePaymentsRuntime;
}

describe("armMcpHeavyGate — x402 heavy-op gate", () => {
  it("arms paymentForPrice with configured price/payTo → heavy op returns 402", async () => {
    envBak.MCP_HEAVY_X402_PRICE = process.env.MCP_HEAVY_X402_PRICE;
    envBak.MCP_HEAVY_X402_PAYTO = process.env.MCP_HEAVY_X402_PAYTO;
    process.env.MCP_HEAVY_X402_PRICE = "$0.05";
    process.env.MCP_HEAVY_X402_PAYTO = "0xDEADBEEF";
    resetConfigCache();

    const gate: MiddlewareHandler = async (c) =>
      c.json({ x402Version: 1, error: "payment required" }, 402);
    const runtime = stubRuntime(gate);
    armMcpHeavyGate(runtime);

    expect(runtime.paymentForPrice).toHaveBeenCalledWith(
      "$0.05",
      expect.objectContaining({ payTo: "0xDEADBEEF", methods: ["POST"] }),
    );

    const app = buildApp({ anonMax: 100, heavyMax: 100 });
    expect((await app.request(postJson("/mcp/tools/arc_send_raw_tx", "{}"))).status).toBe(402);
    // light tools bypass the armed gate
    expect((await app.request(postJson("/mcp/tools/get_guide", "{}"))).status).toBe(200);
  });

  it("no-ops when price/payTo are unset — guard stays free", async () => {
    envBak.MCP_HEAVY_X402_PRICE = process.env.MCP_HEAVY_X402_PRICE;
    envBak.MCP_HEAVY_X402_PAYTO = process.env.MCP_HEAVY_X402_PAYTO;
    delete process.env.MCP_HEAVY_X402_PRICE;
    delete process.env.MCP_HEAVY_X402_PAYTO;
    resetConfigCache();

    const runtime = stubRuntime(async (c) => c.json({ err: 1 }, 402));
    armMcpHeavyGate(runtime);
    expect(runtime.paymentForPrice).not.toHaveBeenCalled();

    const app = buildApp({ anonMax: 100, heavyMax: 100 });
    expect((await app.request(postJson("/mcp/tools/arc_send_raw_tx", "{}"))).status).toBe(200);
  });

  it("no-ops when circle runtime is undefined", () => {
    envBak.MCP_HEAVY_X402_PRICE = process.env.MCP_HEAVY_X402_PRICE;
    envBak.MCP_HEAVY_X402_PAYTO = process.env.MCP_HEAVY_X402_PAYTO;
    process.env.MCP_HEAVY_X402_PRICE = "$0.05";
    process.env.MCP_HEAVY_X402_PAYTO = "0xDEADBEEF";
    resetConfigCache();
    expect(() => armMcpHeavyGate(undefined)).not.toThrow();
  });
});
