/**
 * SLICE-82-4: DID Auth rollout modes — off / warn / enforce.
 *
 * Tests the three-mode behavior controlled by DID_AUTH_MODE env var:
 * - off:      passthrough, no verification, no warnings
 * - warn:     verify when headers present (log failures), never reject;
 *             emit X-AgentBadge-Auth-Warn header on unsigned mutations
 * - enforce:  reject unsigned/invalid mutations with 401 (current behavior)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agentbadge/hedera-core")>()),
  didToAccountId: vi.fn(async () => "0.0.1234567"),
}));

import {
  requireDidSignature,
  configureDidAuthForTesting,
  NonceStore,
  buildChallenge,
  type VerifySignatureFn,
} from "../../src/server/middleware/did-auth";

// ─── Helpers ───────────────────────────────────────────────────────

const TEST_DID = "did:hcs:0.0.12345:1";

const mockVerifier: VerifySignatureFn = vi.fn(async () => true);

/** Nonce store that always accepts any nonce (for testing signed requests) */
class AcceptAllNonceStore extends NonceStore {
  consume(): boolean {
    return true;
  }
}

function makeApp(): Hono {
  const app = new Hono();
  app.use("/market/*", requireDidSignature());
  app.post("/market/tasks", (c) => c.json({ ok: true }));
  return app;
}

function signHeaders(opts: {
  did?: string;
  method?: string;
  path?: string;
  body?: string;
  timestamp?: number;
  nonce?: string;
}): Record<string, string> {
  const did = opts.did ?? TEST_DID;
  const method = opts.method ?? "POST";
  const path = opts.path ?? "/market/tasks";
  const body = opts.body ?? "{}";
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? "abcdef0123456789abcdef0123456789";
  const challenge = buildChallenge({ did, method, path, body, timestamp, nonce });
  void challenge; // mock verifier doesn't check challenge
  return {
    "X-AgentBadge-Signature": "0xdeadbeef",
    "X-AgentBadge-Timestamp": String(timestamp),
    "X-AgentBadge-Nonce": nonce,
    "X-AgentBadge-Did": did,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("SLICE-82-4: DID_AUTH_MODE rollout modes", () => {
  const originalEnv = process.env.DID_AUTH_MODE;

  beforeEach(() => {
    configureDidAuthForTesting({
      verifier: mockVerifier,
      nonceStore: new AcceptAllNonceStore(),
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DID_AUTH_MODE;
    } else {
      process.env.DID_AUTH_MODE = originalEnv;
    }
  });

  // ─── Mode: off ─────────────────────────────────────────────────

  describe("mode=off", () => {
    beforeEach(() => {
      process.env.DID_AUTH_MODE = "off";
    });

    it("passes through unsigned mutations with 200", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(200);
    });

    it("does not emit warning header", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.headers.get("X-AgentBadge-Auth-Warn")).toBeNull();
    });
  });

  // ─── Mode: warn ────────────────────────────────────────────────

  describe("mode=warn", () => {
    beforeEach(() => {
      process.env.DID_AUTH_MODE = "warn";
    });

    it("allows unsigned mutations with 200", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(200);
    });

    it("emits X-AgentBadge-Auth-Warn header on unsigned mutations", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.headers.get("X-AgentBadge-Auth-Warn")).not.toBeNull();
      expect(res.headers.get("X-AgentBadge-Auth-Warn")).toContain("required-after");
    });

    it("passes through signed mutations without warning header", async () => {
      const app = makeApp();
      const headers = signHeaders({});
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-AgentBadge-Auth-Warn")).toBeNull();
    });

    it("allows invalid signatures (does not reject)", async () => {
      const app = makeApp();
      // Override verifier to return false
      configureDidAuthForTesting({
        verifier: vi.fn(async () => false),
        nonceStore: new AcceptAllNonceStore(),
      });
      const headers = signHeaders({});
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── Mode: enforce ─────────────────────────────────────────────

  describe("mode=enforce", () => {
    beforeEach(() => {
      process.env.DID_AUTH_MODE = "enforce";
    });

    it("rejects unsigned mutations with 401", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(401);
    });

    it("accepts valid signed mutations with 200", async () => {
      const app = makeApp();
      const headers = signHeaders({});
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(200);
    });

    it("rejects invalid signatures with 401", async () => {
      const app = makeApp();
      configureDidAuthForTesting({
        verifier: vi.fn(async () => false),
        nonceStore: new AcceptAllNonceStore(),
      });
      const headers = signHeaders({});
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Default mode ──────────────────────────────────────────────

  describe("default (no DID_AUTH_MODE set)", () => {
    beforeEach(() => {
      delete process.env.DID_AUTH_MODE;
    });

    it("defaults to enforce behavior (401 on unsigned)", async () => {
      const app = makeApp();
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: TEST_DID }),
      });
      expect(res.status).toBe(401);
    });
  });
});
