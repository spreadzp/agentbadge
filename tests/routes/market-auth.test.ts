import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentgate-hedera/hedera-core")>();
  return {
    ...actual,
    submitTaskMessage: vi.fn(),
    verifyA2ADid: vi.fn(),
    transferHbar: vi.fn(),
    transferHbarWithKey: vi.fn(),
    prepareTransferTransaction: vi.fn(),
    transferHbarWithSignature: vi.fn(),
    didToAccountId: vi.fn(),
    createScheduledTransfer: vi.fn(),
    signScheduledTransaction: vi.fn(),
    deleteScheduledTransaction: vi.fn(),
    prepareTopicMessageTransaction: vi.fn(),
    submitSignedTopicMessage: vi.fn(),
    signTransactionBytes: vi.fn(),
  };
});

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  getTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  listTasks: vi.fn().mockReturnValue({ tasks: [], total: 0 }),
  validatePagination: vi.fn().mockReturnValue({ limit: 20, offset: 0 }),
  paginate: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
  setEscrowStatus: vi.fn(),
  returnTaskToMarket: vi.fn(),
  updateTaskVerificationAttempts: vi.fn(),
}));

import { submitTaskMessage, verifyA2ADid, didToAccountId, createScheduledTransfer } from "@agentgate-hedera/hedera-core";
import { getTaskById, updateTaskStatus, setEscrowStatus, marketUpsert as upsert } from "@agentgate-hedera/passport";
import { marketRoutes } from "../../src/server/routes/market";
import {
  configureDidAuthForTesting,
  NonceStore,
  type VerifySignatureFn,
} from "../../src/server/middleware/did-auth";

const mockedSubmit = vi.mocked(submitTaskMessage);
const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedCreateScheduledTransfer = vi.mocked(createScheduledTransfer);
const mockedUpsert = vi.mocked(upsert);

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.456:2";
const OTHER_DID = "did:hcs:0.0.999:3";

const mockTask = {
  taskId: "task-001",
  posterDid: POSTER_DID,
  title: "Data Analysis",
  description: "Analyze dataset",
  priceHbar: 10,
  capabilities: ["data_analysis"],
  status: "posted" as const,
  txId: "0.0.111@1234567890",
  consensusTimestamp: "2026-01-01T00:00:00Z",
  createdAt: 1000000,
};

function makeAuthHeaders(did: string, nonce: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-AgentBadge-Did": did,
    "X-AgentBadge-Signature": "fake-sig",
    "X-AgentBadge-Timestamp": String(Math.floor(Date.now() / 1000)),
    "X-AgentBadge-Nonce": nonce,
  };
}

describe("Marketplace DID auth enforcement (SLICE-82-2)", () => {
  let app: Hono;
  let testNonceStore: NonceStore;
  const mockVerifier: VerifySignatureFn = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", marketRoutes);

    testNonceStore = new NonceStore();
    configureDidAuthForTesting({ verifier: mockVerifier, nonceStore: testNonceStore });
    vi.mocked(mockVerifier).mockResolvedValue(true);

    // Default mocks
    mockedVerify.mockResolvedValue(true);
    mockedSubmit.mockResolvedValue("0.0.111@1234567890.000000001");
    mockedDidToAccountId.mockResolvedValue("0.0.123");
    mockedCreateScheduledTransfer.mockResolvedValue({
      scheduleId: "0.0.555",
      scheduleTxId: "0.0.555@1234567890",
    });
  });

  // ─── POST /market/tasks ──────────────────────────────────────────

  describe("POST /market/tasks", () => {
    const validBody = {
      posterDid: POSTER_DID,
      title: "Test Task",
      description: "Test description",
      priceHbar: 10,
      capabilities: ["data_analysis"],
    };

    it("returns 401 when auth headers are missing", async () => {
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 when verified DID does not match body posterDid", async () => {
      const nonce = testNonceStore.issue();
      const res = await app.request("/market/tasks", {
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
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: makeAuthHeaders(POSTER_DID, nonce),
        body: JSON.stringify(validBody),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.txId).toBeDefined();
    });
  });

  // ─── POST /market/tasks/:taskId/claim ────────────────────────────

  describe("POST /market/tasks/:taskId/claim", () => {
    it("returns 401 when auth headers are missing", async () => {
      mockedGetTaskById.mockReturnValue(mockTask);
      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 when verified DID does not match body claimerDid", async () => {
      mockedGetTaskById.mockReturnValue(mockTask);
      const nonce = testNonceStore.issue();
      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: makeAuthHeaders(OTHER_DID, nonce),
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });
      expect(res.status).toBe(403);
    });

    it("succeeds with valid signature and matching DID", async () => {
      mockedGetTaskById.mockReturnValue(mockTask);
      const nonce = testNonceStore.issue();
      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: makeAuthHeaders(CLAIMER_DID, nonce),
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── POST /market/tasks/:taskId/cancel ───────────────────────────

  describe("POST /market/tasks/:taskId/cancel", () => {
    it("returns 401 when auth headers are missing", async () => {
      mockedGetTaskById.mockReturnValue(mockTask);
      const res = await app.request("/market/tasks/task-001/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 403 when verified DID does not match body posterDid", async () => {
      mockedGetTaskById.mockReturnValue(mockTask);
      const nonce = testNonceStore.issue();
      const res = await app.request("/market/tasks/task-001/cancel", {
        method: "POST",
        headers: makeAuthHeaders(OTHER_DID, nonce),
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });
      expect(res.status).toBe(403);
    });

    it("succeeds with valid signature and matching DID", async () => {
      mockedGetTaskById.mockReturnValue(mockTask);
      const nonce = testNonceStore.issue();
      const res = await app.request("/market/tasks/task-001/cancel", {
        method: "POST",
        headers: makeAuthHeaders(POSTER_DID, nonce),
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── GET endpoints remain open ───────────────────────────────────

  describe("GET /market/tasks (read-only, no auth required)", () => {
    it("returns 200 without auth headers", async () => {
      const res = await app.request("/market/tasks", {
        method: "GET",
      });
      expect(res.status).toBe(200);
    });
  });
});
