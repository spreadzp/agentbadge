import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
  return {
    ...actual,
    submitA2AMessage: vi.fn(),
    verifyA2ADid: vi.fn(),
    isValidA2ADid: actual.isValidA2ADid,
    getMessageDirection: actual.getMessageDirection,
    prepareA2ATopicMessage: vi.fn(),
    signTransactionBytes: vi.fn(),
    submitSignedTopicMessage: vi.fn(),
    didToAccountId: vi.fn(),
  };
});

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  a2aUpsert: vi.fn(),
  getMessagesByTo: vi.fn().mockReturnValue([]),
  getConversation: vi.fn().mockReturnValue([]),
  validatePagination: vi.fn().mockReturnValue({ limit: 20, offset: 0 }),
  paginate: vi.fn().mockReturnValue([]),
}));

import { submitA2AMessage, verifyA2ADid, didToAccountId } from "@agentbadge/hedera-core";
import { a2aUpsert as upsert } from "@agentbadge/passport";
import { a2aRoutes } from "../../src/server/routes/a2a";
import {
  configureDidAuthForTesting,
  NonceStore,
  type VerifySignatureFn,
} from "../../src/server/middleware/did-auth";

const mockedSubmit = vi.mocked(submitA2AMessage);
const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedUpsert = vi.mocked(upsert);

const SENDER_DID = "did:hcs:0.0.123:1";
const RECIPIENT_DID = "did:hcs:0.0.456:2";
const OTHER_DID = "did:hcs:0.0.999:3";

function makeAuthHeaders(did: string, nonce: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-AgentBadge-Did": did,
    "X-AgentBadge-Signature": "fake-sig",
    "X-AgentBadge-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-AgentBadge-Nonce": nonce,
  };
}

describe("A2A DID auth enforcement (SLICE-82-2)", () => {
  let app: Hono;
  let testNonceStore: NonceStore;
  const mockVerifier: VerifySignatureFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", a2aRoutes);

    testNonceStore = new NonceStore();
    configureDidAuthForTesting({ verifier: mockVerifier, nonceStore: testNonceStore });
    vi.mocked(mockVerifier).mockResolvedValue(true);

    mockedVerify.mockResolvedValue(true);
    mockedSubmit.mockResolvedValue({ txId: "0.0.111@1234567890.000000001", consensusTimestamp: null });
    mockedDidToAccountId.mockResolvedValue("0.0.123");
  });

  // ─── POST /a2a/send ──────────────────────────────────────────────

  describe("POST /a2a/send", () => {
    const validBody = {
      from: SENDER_DID,
      to: RECIPIENT_DID,
      body: "Hello world",
    };

    it("returns 401 when auth headers are missing", async () => {
      const res = await app.request("/a2a/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 when verified DID does not match body 'from'", async () => {
      const nonce = testNonceStore.issue();
      const res = await app.request("/a2a/send", {
        method: "POST",
        headers: makeAuthHeaders(OTHER_DID, nonce),
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("does not match");
    });

    it("succeeds with valid signature and matching DID", async () => {
      const nonce = testNonceStore.issue();
      const res = await app.request("/a2a/send", {
        method: "POST",
        headers: makeAuthHeaders(SENDER_DID, nonce),
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.txId).toBeDefined();
    });
  });

  // ─── POST /a2a/send-signed ───────────────────────────────────────

  describe("POST /a2a/send-signed", () => {
    const validBody = {
      from: SENDER_DID,
      to: RECIPIENT_DID,
      body: "Hello signed",
      txBytes: "base64-bytes",
      publicKey: "fake-key",
      signature: '["sig"]',
    };

    it("returns 401 when auth headers are missing", async () => {
      const res = await app.request("/a2a/send-signed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 when verified DID does not match body 'from'", async () => {
      const nonce = testNonceStore.issue();
      const res = await app.request("/a2a/send-signed", {
        method: "POST",
        headers: makeAuthHeaders(OTHER_DID, nonce),
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(403);
    });

    it("succeeds with valid signature and matching DID", async () => {
      const nonce = testNonceStore.issue();
      const res = await app.request("/a2a/send-signed", {
        method: "POST",
        headers: makeAuthHeaders(SENDER_DID, nonce),
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── GET endpoints remain open ───────────────────────────────────

  describe("GET /a2a/inbox (read-only, no auth required)", () => {
    it("returns 200 without auth headers", async () => {
      const res = await app.request("/a2a/inbox?did=did:hcs:0.0.123:1", {
        method: "GET",
      });
      expect(res.status).toBe(200);
    });
  });
});
