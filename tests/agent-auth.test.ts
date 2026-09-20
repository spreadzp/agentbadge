import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import {
  buildAccessChallenge,
  requireAccessPass,
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
  CLASS_MEDIUM,
  CLASS_HEAVY,
  type AgentAuthVariables,
} from "../src/server/middleware/agent-auth";

/**
 * SLICE-137-3: agentAuth middleware tests.
 *
 * Real EOA signatures via viem privateKeyToAccount + local verifyMessage
 * (pure ecrecover — no RPC). hasAccess is stubbed via test override.
 * ERC-1271/6492 paths covered in SLICE-137-6 with mock wallets.
 */

// Hardhat account #0 — well-known test key, never holds real funds
const AGENT_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const agent = privateKeyToAccount(AGENT_KEY);
const other = privateKeyToAccount(OTHER_KEY);

const PATH = "/api/total-scan";

function makeApp(cls = CLASS_MEDIUM) {
  const app = new Hono<{ Variables: AgentAuthVariables }>();
  app.post(PATH, requireAccessPass(cls), (c) =>
    c.json({ ok: true, wallet: c.get("agentWallet") }),
  );
  return app;
}

async function signFor(
  account: typeof agent,
  opts: { method?: string; path?: string; timestamp?: number; wallet?: string } = {},
) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const wallet = opts.wallet ?? account.address;
  const message = buildAccessChallenge({
    wallet,
    method: opts.method ?? "POST",
    path: opts.path ?? PATH,
    timestamp,
  });
  const signature = await account.signMessage({ message });
  return { signature, timestamp, wallet };
}

function post(app: ReturnType<typeof makeApp>, headers: Record<string, string>) {
  return app.request(PATH, { method: "POST", headers });
}

describe("SLICE-137-3: agentAuth middleware", () => {
  let hasAccessSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    hasAccessSpy = vi.fn().mockResolvedValue(true);
    configureAgentAuthForTesting({
      // Real local EOA verification (ecrecover) — no RPC needed
      verifier: (wallet: string, message: string, signature: string) =>
        verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` }),
      hasAccess: hasAccessSpy,
      cacheTtlMs: 60_000,
    });
  });

  afterEach(() => resetAgentAuthForTesting());

  describe("header validation", () => {
    it("401 MISSING_FIELDS when X-Wallet absent", async () => {
      const res = await post(makeApp(), { "x-sig": "0x1234", "x-timestamp": "1" });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("MISSING_FIELDS");
    });

    it("401 MISSING_FIELDS when X-Sig absent", async () => {
      const res = await post(makeApp(), { "x-wallet": agent.address, "x-timestamp": "1" });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("MISSING_FIELDS");
    });

    it("401 on malformed wallet address", async () => {
      const res = await post(makeApp(), {
        "x-wallet": "not-an-address",
        "x-sig": "0x1234",
        "x-timestamp": String(Math.floor(Date.now() / 1000)),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("timestamp skew", () => {
    it("401 when timestamp too old", async () => {
      const stale = Math.floor(Date.now() / 1000) - 600; // 10min ago
      const { signature, timestamp, wallet } = await signFor(agent, { timestamp: stale });
      const res = await post(makeApp(), {
        "x-wallet": wallet,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(401);
    });

    it("401 when timestamp in the future beyond skew", async () => {
      const future = Math.floor(Date.now() / 1000) + 600;
      const { signature, timestamp, wallet } = await signFor(agent, { timestamp: future });
      const res = await post(makeApp(), {
        "x-wallet": wallet,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("signature verification", () => {
    it("401 INVALID_INPUT on bad signature", async () => {
      const res = await post(makeApp(), {
        "x-wallet": agent.address,
        "x-sig": "0xdeadbeef",
        "x-timestamp": String(Math.floor(Date.now() / 1000)),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("INVALID_INPUT");
    });

    it("401 when signature was made by a different wallet", async () => {
      // other signs, but claims agent's wallet
      const { signature, timestamp } = await signFor(other, { wallet: agent.address });
      const res = await post(makeApp(), {
        "x-wallet": agent.address,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(401);
    });

    it("401 when signature covers a different path (replay across routes)", async () => {
      const { signature, timestamp, wallet } = await signFor(agent, { path: "/api/other" });
      const res = await post(makeApp(), {
        "x-wallet": wallet,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("hasAccess gate", () => {
    it("200 + agentWallet set when signature valid and pass active", async () => {
      const { signature, timestamp, wallet } = await signFor(agent);
      const res = await post(makeApp(), {
        "x-wallet": wallet,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.wallet.toLowerCase()).toBe(agent.address.toLowerCase());
      expect(hasAccessSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^0x/i),
        CLASS_MEDIUM,
      );
    });

    it("402 PAYMENT_REQUIRED when wallet has no valid pass", async () => {
      hasAccessSpy.mockResolvedValue(false);
      const { signature, timestamp, wallet } = await signFor(agent);
      const res = await post(makeApp(), {
        "x-wallet": wallet,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(402);
      expect((await res.json()).code).toBe("PAYMENT_REQUIRED");
    });

    it("queries the class bit the middleware was configured with", async () => {
      const { signature, timestamp, wallet } = await signFor(agent);
      const res = await post(makeApp(CLASS_HEAVY), {
        "x-wallet": wallet,
        "x-sig": signature,
        "x-timestamp": String(timestamp),
      });
      expect(res.status).toBe(200);
      expect(hasAccessSpy).toHaveBeenCalledWith(expect.anything(), CLASS_HEAVY);
    });
  });

  describe("hasAccess cache", () => {
    it("caches positive result — second request skips chain call", async () => {
      const app = makeApp();
      const s1 = await signFor(agent);
      const s2 = await signFor(agent);
      await post(app, { "x-wallet": s1.wallet, "x-sig": s1.signature, "x-timestamp": String(s1.timestamp) });
      await post(app, { "x-wallet": s2.wallet, "x-sig": s2.signature, "x-timestamp": String(s2.timestamp) });
      expect(hasAccessSpy).toHaveBeenCalledTimes(1);
    });

    it("different wallets cached independently", async () => {
      const app = makeApp();
      const s1 = await signFor(agent);
      const s2 = await signFor(other);
      await post(app, { "x-wallet": s1.wallet, "x-sig": s1.signature, "x-timestamp": String(s1.timestamp) });
      await post(app, { "x-wallet": s2.wallet, "x-sig": s2.signature, "x-timestamp": String(s2.timestamp) });
      expect(hasAccessSpy).toHaveBeenCalledTimes(2);
    });
  });
});
