import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";
import { Hono } from "hono";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...(await importOriginal()),
  didToAccountId: vi.fn(async () => "0.0.1234567"),
  isValidA2ADid: vi.fn(() => true),
}));

import {
  buildChallenge,
  hashBody,
  NonceStore,
  requireDidSignature,
  challengeHandler,
} from "../../src/server/middleware/did-auth";
import { didToAccountId } from "@agentbadge/hedera-core";

// ─── Challenge Builder ───────────────────────────────────────────

describe("SLICE-82-1: buildChallenge", () => {
  it("produces canonical string with all fields in deterministic order", () => {
    const challenge = buildChallenge({
      did: "did:hcs:0.0.123:1",
      method: "POST",
      path: "/market/tasks",
      body: '{"posterDid":"did:hcs:0.0.123:1"}',
      timestamp: 1700000000,
      nonce: "abc123def456",
    });

    const lines = challenge.split("\n");
    expect(lines[0]).toBe("agentbadge-action:v1");
    expect(lines[1]).toBe("did:did:hcs:0.0.123:1");
    expect(lines[2]).toBe("method:POST");
    expect(lines[3]).toBe("path:/market/tasks");
    expect(lines[4]).toMatch(/^body_sha256:[0-9a-f]{64}$/);
    expect(lines[5]).toBe("timestamp:1700000000");
    expect(lines[6]).toBe("nonce:abc123def456");
    expect(lines).toHaveLength(7);
  });

  it("same body → same challenge; different body → different challenge", () => {
    const base = {
      did: "did:hcs:0.0.123:1",
      method: "POST",
      path: "/market/tasks",
      body: '{"foo":"bar"}',
      timestamp: 1700000000,
      nonce: "abc123",
    };
    const c1 = buildChallenge(base);
    const c2 = buildChallenge({ ...base, body: '{"foo":"bar"}' });
    const c3 = buildChallenge({ ...base, body: '{"foo":"baz"}' });

    expect(c1).toBe(c2);
    expect(c1).not.toBe(c3);
  });

  it("empty body still produces valid sha256", () => {
    const challenge = buildChallenge({
      did: "did:hcs:0.0.123:1",
      method: "GET",
      path: "/auth/challenge",
      body: "",
      timestamp: 1700000000,
      nonce: "abc123",
    });

    expect(challenge).toMatch(/body_sha256:[0-9a-f]{64}/);
  });

  it("hashBody returns sha256 hex of body", () => {
    const hash = hashBody('{"test":true}');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    const emptyHash = hashBody("");
    expect(emptyHash).toHaveLength(64);
    expect(emptyHash).not.toBe(hash);
  });
});

// ─── NonceStore ──────────────────────────────────────────────────

describe("SLICE-82-1: NonceStore", () => {
  it("issues unique 16-byte hex nonces (32 chars)", () => {
    const store = new NonceStore();
    const nonces = new Set<string>();
    for (let i = 0; i < 100; i++) {
      nonces.add(store.issue());
    }
    expect(nonces.size).toBe(100);
    for (const n of nonces) {
      expect(n).toHaveLength(32);
      expect(n).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it("consume returns true first time, false on reuse", () => {
    const store = new NonceStore();
    const nonce = store.issue();

    expect(store.consume(nonce)).toBe(true);
    expect(store.consume(nonce)).toBe(false);
  });

  it("consume returns false for unknown nonce", () => {
    const store = new NonceStore();
    expect(store.consume("deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
  });
});

// ─── requireDidSignature Middleware ──────────────────────────────

describe("SLICE-82-1: requireDidSignature middleware", () => {
  let app: Hono;
  let testWallet: ReturnType<typeof ethers.Wallet.createRandom>;
  let nonceStore: NonceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    testWallet = ethers.Wallet.createRandom();
    nonceStore = new NonceStore();

    vi.mocked(didToAccountId).mockResolvedValue("0.0.1234567");

    const verifySig = async (challenge: string, signature: string) => {
      try {
        const recovered = ethers.verifyMessage(challenge, signature);
        return recovered === testWallet.address;
      } catch {
        return false;
      }
    };

    app = new Hono();
    app.use(
      "/market/*",
      requireDidSignature({
        verifySignature: verifySig,
        nonceStore,
        maxSkewSeconds: 300,
      }),
    );
    app.post("/market/tasks", (c) => {
      const verifiedDid = (c as unknown as { get: (k: string) => string }).get("verifiedDid");
      return c.json({ ok: true, verifiedDid });
    });
    app.get("/market/tasks", (c) => c.json({ ok: true }));
  });

  it("returns 401 when X-AgentBadge-Signature header is missing", async () => {
    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Timestamp": String(Math.floor(Date.now() / 1000)),
        "X-AgentBadge-Nonce": nonceStore.issue(),
        "X-AgentBadge-Did": "did:hcs:0.0.123:1",
      },
      body: JSON.stringify({ posterDid: "did:hcs:0.0.123:1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 when X-AgentBadge-Timestamp header is missing", async () => {
    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": "0xfakesig",
        "X-AgentBadge-Nonce": nonceStore.issue(),
        "X-AgentBadge-Did": "did:hcs:0.0.123:1",
      },
      body: JSON.stringify({ posterDid: "did:hcs:0.0.123:1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 when X-AgentBadge-Did header is missing", async () => {
    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": "0xfakesig",
        "X-AgentBadge-Timestamp": String(Math.floor(Date.now() / 1000)),
        "X-AgentBadge-Nonce": nonceStore.issue(),
      },
      body: JSON.stringify({ posterDid: "did:hcs:0.0.123:1" }),
    });

    expect(res.status).toBe(401);
  });

  it("returns 401 when timestamp is stale (>300s skew)", async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 400;
    const did = "did:hcs:0.0.123:1";
    const body = JSON.stringify({ posterDid: did });
    const nonce = nonceStore.issue();

    const challenge = buildChallenge({
      did,
      method: "POST",
      path: "/market/tasks",
      body,
      timestamp: oldTs,
      nonce,
    });
    const sig = await testWallet.signMessage(challenge);

    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": sig,
        "X-AgentBadge-Timestamp": String(oldTs),
        "X-AgentBadge-Nonce": nonce,
        "X-AgentBadge-Did": did,
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when verified DID ≠ body actor DID (ownership mismatch)", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const signingDid = "did:hcs:0.0.123:1";
    const bodyDid = "did:hcs:0.0.999:1";
    const body = JSON.stringify({ posterDid: bodyDid });
    const nonce = nonceStore.issue();

    const challenge = buildChallenge({
      did: signingDid,
      method: "POST",
      path: "/market/tasks",
      body,
      timestamp: ts,
      nonce,
    });
    const sig = await testWallet.signMessage(challenge);

    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": sig,
        "X-AgentBadge-Timestamp": String(ts),
        "X-AgentBadge-Nonce": nonce,
        "X-AgentBadge-Did": signingDid,
      },
      body,
    });

    expect(res.status).toBe(403);
  });

  it("passes through and sets verifiedDid when signature is valid", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const did = "did:hcs:0.0.123:1";
    const body = JSON.stringify({ posterDid: did });
    const nonce = nonceStore.issue();

    const challenge = buildChallenge({
      did,
      method: "POST",
      path: "/market/tasks",
      body,
      timestamp: ts,
      nonce,
    });
    const sig = await testWallet.signMessage(challenge);

    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": sig,
        "X-AgentBadge-Timestamp": String(ts),
        "X-AgentBadge-Nonce": nonce,
        "X-AgentBadge-Did": did,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.verifiedDid).toBe(did);
  });

  it("returns 401 when nonce is reused", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const did = "did:hcs:0.0.123:1";
    const body = JSON.stringify({ posterDid: did });
    const nonce = nonceStore.issue();

    const challenge = buildChallenge({
      did,
      method: "POST",
      path: "/market/tasks",
      body,
      timestamp: ts,
      nonce,
    });
    const sig = await testWallet.signMessage(challenge);

    const headers = {
      "Content-Type": "application/json",
      "X-AgentBadge-Signature": sig,
      "X-AgentBadge-Timestamp": String(ts),
      "X-AgentBadge-Nonce": nonce,
      "X-AgentBadge-Did": did,
    };

    const res1 = await app.request("/market/tasks", { method: "POST", headers, body });
    expect(res1.status).toBe(200);

    const res2 = await app.request("/market/tasks", { method: "POST", headers, body });
    expect(res2.status).toBe(401);
  });

  it("returns 401 when signature is invalid (wrong key)", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const did = "did:hcs:0.0.123:1";
    const body = JSON.stringify({ posterDid: did });
    const nonce = nonceStore.issue();

    const challenge = buildChallenge({
      did,
      method: "POST",
      path: "/market/tasks",
      body,
      timestamp: ts,
      nonce,
    });
    const otherWallet = ethers.Wallet.createRandom();
    const sig = await otherWallet.signMessage(challenge);

    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": sig,
        "X-AgentBadge-Timestamp": String(ts),
        "X-AgentBadge-Nonce": nonce,
        "X-AgentBadge-Did": did,
      },
      body,
    });

    expect(res.status).toBe(401);
  });

  it("does not intercept GET requests", async () => {
    const res = await app.request("/market/tasks", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("returns 401 when DID does not resolve to an accountId", async () => {
    vi.mocked(didToAccountId).mockResolvedValue(null);

    const ts = Math.floor(Date.now() / 1000);
    const did = "did:hcs:0.0.999:1";
    const body = JSON.stringify({ posterDid: did });
    const nonce = nonceStore.issue();

    const challenge = buildChallenge({
      did,
      method: "POST",
      path: "/market/tasks",
      body,
      timestamp: ts,
      nonce,
    });
    const sig = await testWallet.signMessage(challenge);

    const res = await app.request("/market/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Signature": sig,
        "X-AgentBadge-Timestamp": String(ts),
        "X-AgentBadge-Nonce": nonce,
        "X-AgentBadge-Did": did,
      },
      body,
    });

    expect(res.status).toBe(401);
  });
});

// ─── Challenge Endpoint ──────────────────────────────────────────

describe("SLICE-82-1: GET /auth/challenge endpoint", () => {
  it("returns nonce + canonical challenge string", async () => {
    const nonceStore = new NonceStore();
    const app = new Hono();
    app.get("/auth/challenge", challengeHandler({ nonceStore }));

    const res = await app.request(
      "/auth/challenge?did=did:hcs:0.0.123:1&method=POST&path=/market/tasks",
      { method: "GET" },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nonce).toHaveLength(32);
    expect(json.timestamp).toBeTypeOf("number");
    expect(json.challenge).toContain("agentbadge-action:v1");
    expect(json.challenge).toContain("did:did:hcs:0.0.123:1");
    expect(json.challenge).toContain("method:POST");
    expect(json.challenge).toContain("path:/market/tasks");
  });

  it("returns 400 when did parameter is missing", async () => {
    const nonceStore = new NonceStore();
    const app = new Hono();
    app.get("/auth/challenge", challengeHandler({ nonceStore }));

    const res = await app.request(
      "/auth/challenge?method=POST&path=/market/tasks",
      { method: "GET" },
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when method parameter is missing", async () => {
    const nonceStore = new NonceStore();
    const app = new Hono();
    app.get("/auth/challenge", challengeHandler({ nonceStore }));

    const res = await app.request(
      "/auth/challenge?did=did:hcs:0.0.123:1&path=/market/tasks",
      { method: "GET" },
    );

    expect(res.status).toBe(400);
  });

  it("issued nonce is consumable by middleware (same store)", async () => {
    const nonceStore = new NonceStore();
    const app = new Hono();
    app.get("/auth/challenge", challengeHandler({ nonceStore }));

    const res = await app.request(
      "/auth/challenge?did=did:hcs:0.0.123:1&method=POST&path=/market/tasks",
      { method: "GET" },
    );
    const json = await res.json();
    const nonce = json.nonce as string;

    expect(nonceStore.consume(nonce)).toBe(true);
    expect(nonceStore.consume(nonce)).toBe(false);
  });
});
