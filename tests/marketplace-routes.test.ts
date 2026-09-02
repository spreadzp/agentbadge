import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
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
  };
});

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  getTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
  setEscrowStatus: vi.fn(),
  returnTaskToMarket: vi.fn(),
}));

import { submitTaskMessage, verifyA2ADid, transferHbar, transferHbarWithKey, prepareTransferTransaction, transferHbarWithSignature, createScheduledTransfer } from "@agentbadge/hedera-core";
import { didToAccountId } from "@agentbadge/hedera-core";
import { marketUpsert as upsert, marketGet as get, getTaskById, updateTaskStatus, listTasks, setEscrowStatus, returnTaskToMarket } from "@agentbadge/passport";
import { marketRoutes } from "../src/server/routes/market";

const mockedSubmit = vi.mocked(submitTaskMessage);
const mockedVerify = vi.mocked(verifyA2ADid);
const mockedTransferHbar = vi.mocked(transferHbar);
const mockedTransferHbarWithKey = vi.mocked(transferHbarWithKey);
const mockedPrepareTransfer = vi.mocked(prepareTransferTransaction);
const mockedTransferWithSignature = vi.mocked(transferHbarWithSignature);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedCreateScheduledTransfer = vi.mocked(createScheduledTransfer);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedReturnTaskToMarket = vi.mocked(returnTaskToMarket);
const mockedUpsert = vi.mocked(upsert);
const mockedGet = vi.mocked(get);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedListTasks = vi.mocked(listTasks);

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.456:2";

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

const mockClaimedTask = {
  ...mockTask,
  status: "claimed" as const,
  claimerDid: CLAIMER_DID,
};

describe("Marketplace REST API", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route("/", marketRoutes);
  });

  describe("POST /market/tasks", () => {
    it("returns 200 with txId and taskId on valid input", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@1234567890.000000001", consensusTimestamp: null });

      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          title: "Data Analysis",
          description: "Analyze dataset",
          priceHbar: 10,
          capabilities: ["data_analysis"],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.txId).toBe("0.0.111@1234567890.000000001");
      expect(data.taskId).toBeTypeOf("string");
      expect(data.timestamp).toBeTypeOf("number");
      expect(mockedVerify).toHaveBeenCalledWith(POSTER_DID);
      expect(mockedSubmit).toHaveBeenCalledOnce();
      expect(mockedUpsert).toHaveBeenCalledOnce();
    });

    it("returns 400 on missing required fields", async () => {
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Missing required fields");
    });

    it("returns 400 on invalid DID format", async () => {
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: "invalid-did",
          title: "Test",
          description: "Test",
          priceHbar: 10,
          capabilities: ["api_call"],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid posterDid format");
    });

    it("returns 400 on empty capabilities array", async () => {
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          title: "Test",
          description: "Test",
          priceHbar: 10,
          capabilities: [],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("capabilities");
    });

    it("returns 400 on non-positive priceHbar", async () => {
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          title: "Test",
          description: "Test",
          priceHbar: 0,
          capabilities: ["api_call"],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("priceHbar");
    });

    it("returns 403 when poster passport is invalid", async () => {
      mockedVerify.mockResolvedValue(false);

      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          title: "Test",
          description: "Test",
          priceHbar: 10,
          capabilities: ["api_call"],
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("passport");
    });

    it("returns 500 on HCS submission failure", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedSubmit.mockRejectedValue(new Error("HCS network error"));

      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          title: "Test",
          description: "Test",
          priceHbar: 10,
          capabilities: ["api_call"],
        }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("HCS network error");
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON body");
    });
  });

  describe("GET /market/tasks", () => {
    it("returns 200 with tasks list", async () => {
      mockedListTasks.mockReturnValue({ tasks: [mockTask], total: 1 });

      const res = await app.request("/market/tasks");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tasks).toHaveLength(1);
      expect(data.total).toBe(1);
      expect(data.count).toBe(1);
    });

    it("passes capability filter to listTasks", async () => {
      mockedListTasks.mockReturnValue({ tasks: [], total: 0 });

      await app.request("/market/tasks?capability=data_analysis");

      expect(mockedListTasks).toHaveBeenCalledWith(
        expect.objectContaining({ capability: "data_analysis" }),
      );
    });

    it("passes pagination params to listTasks", async () => {
      mockedListTasks.mockReturnValue({ tasks: [], total: 0 });

      await app.request("/market/tasks?limit=5&offset=10");

      expect(mockedListTasks).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, offset: 10 }),
      );
    });

    it("returns empty list when no tasks", async () => {
      mockedListTasks.mockReturnValue({ tasks: [], total: 0 });

      const res = await app.request("/market/tasks");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tasks).toHaveLength(0);
      expect(data.total).toBe(0);
    });
  });

  describe("GET /market/tasks/:taskId", () => {
    it("returns 200 with task details", async () => {
      mockedGet.mockReturnValue(mockTask);

      const res = await app.request("/market/tasks/task-001");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.task.taskId).toBe("task-001");
      expect(data.task.title).toBe("Data Analysis");
    });

    it("returns 404 for missing task", async () => {
      mockedGet.mockReturnValue(undefined);

      const res = await app.request("/market/tasks/nonexistent");

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });
  });

  describe("POST /market/tasks/:taskId/claim", () => {
    it("returns 200 with taskId and txId on valid claim", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockTask);
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@1234567890.000000001", consensusTimestamp: null });
      mockedUpdateTaskStatus.mockReturnValue(true);
      mockedDidToAccountId.mockImplementation(async (did: string) => {
        if (did === POSTER_DID) return "0.0.123";
        if (did === CLAIMER_DID) return "0.0.456";
        return null;
      });
      mockedCreateScheduledTransfer.mockResolvedValue({ scheduleId: "0.0.888@123", scheduleTxId: "0.0.999@456" });

      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.taskId).toBe("task-001");
      expect(data.txId).toBe("0.0.111@1234567890.000000001");
      expect(data.timestamp).toBeTypeOf("number");
      expect(mockedVerify).toHaveBeenCalledWith(CLAIMER_DID);
      expect(mockedSubmit).toHaveBeenCalledTimes(2);
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith("task-001", "claimed", { claimerDid: CLAIMER_DID, claimTxId: "0.0.111@1234567890.000000001" });
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON body");
    });

    it("returns 400 on invalid claimerDid format", async () => {
      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: "invalid-did" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid claimerDid");
    });

    it("returns 403 when claimer passport is invalid", async () => {
      mockedVerify.mockResolvedValue(false);

      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("passport");
    });

    it("returns 404 when task not found", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(null);

      const res = await app.request("/market/tasks/nonexistent/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 409 when task is already claimed", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockClaimedTask);

      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("claimed");
    });

    it("returns 500 on HCS submission failure", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockTask);
      mockedSubmit.mockRejectedValue(new Error("HCS network error"));

      const res = await app.request("/market/tasks/task-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("HCS network error");
    });
  });

  describe("POST /market/tasks/:taskId/deliver", () => {
    it("returns 200 with taskId and txId on valid delivery", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockClaimedTask);
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@1234567890.000000002", consensusTimestamp: null });
      mockedUpdateTaskStatus.mockReturnValue(true);

      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID, resultBody: "Task completed successfully" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.taskId).toBe("task-001");
      expect(data.txId).toBe("0.0.111@1234567890.000000002");
      expect(data.timestamp).toBeTypeOf("number");
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
        "task-001",
        "delivered",
        { resultIpfs: undefined, resultBody: "Task completed successfully", deliverTxId: "0.0.111@1234567890.000000002" },
      );
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON body");
    });

    it("returns 400 when neither resultIpfs nor resultBody provided", async () => {
      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Either resultIpfs or resultBody");
    });

    it("returns 400 when resultBody exceeds 4KB", async () => {
      const largeBody = "x".repeat(4097);

      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID, resultBody: largeBody }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("too large");
    });

    it("returns 403 when claimer does not match", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockClaimedTask);

      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: "did:hcs:0.0.999:3", resultBody: "result" }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Only claimer");
    });

    it("returns 404 when task not found", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(null);

      const res = await app.request("/market/tasks/nonexistent/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID, resultBody: "result" }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 409 when task is not in claimed status", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockTask);

      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID, resultBody: "result" }),
      });

      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("posted");
    });

    it("returns 500 on HCS submission failure", async () => {
      mockedVerify.mockResolvedValue(true);
      mockedGetTaskById.mockReturnValue(mockClaimedTask);
      mockedSubmit.mockRejectedValue(new Error("HCS network error"));

      const res = await app.request("/market/tasks/task-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID, resultBody: "result" }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("HCS network error");
    });
  });

  describe("POST /market/tasks/:taskId/prepare-payment", () => {
    const mockDeliveredTask = {
      ...mockTask,
      status: "delivered" as const,
      claimerDid: CLAIMER_DID,
    };

    beforeEach(() => {
      mockedGetTaskById.mockReturnValue(mockDeliveredTask);
      mockedVerify.mockResolvedValue(true);
      mockedDidToAccountId.mockImplementation(async (did: string) => {
        if (did === POSTER_DID) return "0.0.123";
        if (did === CLAIMER_DID) return "0.0.456";
        throw new Error(`Unknown DID: ${did}`);
      });
      mockedPrepareTransfer.mockResolvedValue({
        txBytes: "base64-tx-bytes",
        txId: "0.0.123@1234567890.000000001",
      });
    });

    it("returns 200 with txBytes, txId, and account IDs on success", async () => {
      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.txBytes).toBe("base64-tx-bytes");
      expect(data.txId).toBe("0.0.123@1234567890.000000001");
      expect(data.fromAccountId).toBe("0.0.123");
      expect(data.toAccountId).toBe("0.0.456");
      expect(data.amountHbar).toBe(10);
    });

    it("calls prepareTransferTransaction with correct parameters", async () => {
      await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(mockedPrepareTransfer).toHaveBeenCalledWith("0.0.123", "0.0.456", 10);
    });

    it("returns 400 on missing posterDid", async () => {
      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("posterDid");
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });

    it("returns 404 for non-existent task", async () => {
      mockedGetTaskById.mockReturnValue(null);

      const res = await app.request("/market/tasks/nonexistent/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 403 when caller is not the task poster", async () => {
      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: "did:hcs:0.0.999:3" }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("poster");
    });

    it("returns 403 when poster passport is revoked", async () => {
      mockedVerify.mockResolvedValue(false);

      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("passport");
    });

    it("returns 400 when task is not in delivered status", async () => {
      mockedGetTaskById.mockReturnValue({
        ...mockTask,
        status: "claimed" as const,
        claimerDid: CLAIMER_DID,
      });

      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("delivered");
    });

    it("returns 400 when task has no claimer", async () => {
      mockedGetTaskById.mockReturnValue({
        ...mockTask,
        status: "delivered" as const,
        claimerDid: undefined,
      });

      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("claimer");
    });

    it("returns 500 on prepareTransferTransaction failure", async () => {
      mockedPrepareTransfer.mockRejectedValue(new Error("Network error"));

      const res = await app.request("/market/tasks/task-001/prepare-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Network error");
    });
  });

  describe("POST /market/tasks/:taskId/complete", () => {
    const mockDeliveredTask = {
      ...mockTask,
      status: "delivered" as const,
      claimerDid: CLAIMER_DID,
    };

    beforeEach(() => {
      mockedGetTaskById.mockReturnValue(mockDeliveredTask);
      mockedVerify.mockResolvedValue(true);
      mockedDidToAccountId.mockImplementation(async (did: string) => {
        if (did === POSTER_DID) return "0.0.123";
        if (did === CLAIMER_DID) return "0.0.456";
        throw new Error(`Unknown DID: ${did}`);
      });
      mockedTransferHbar.mockResolvedValue("0.0.999@1234567890.000000001");
      mockedTransferHbarWithKey.mockResolvedValue("0.0.999@1234567890.000000001");
      mockedTransferWithSignature.mockResolvedValue("0.0.999@1234567890.000000001");
      mockedPrepareTransfer.mockResolvedValue({
        txBytes: "base64-tx-bytes",
        txId: "0.0.123@1234567890.000000001",
      });
      mockedSubmit.mockResolvedValue({ txId: "0.0.888@1234567890.000000001", consensusTimestamp: null });
      mockedUpdateTaskStatus.mockReturnValue(true);
    });

    it("returns 200 with paymentTxId on successful completion (legacy private key)", async () => {
      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.taskId).toBe("task-001");
      expect(data.paymentTxId).toBe("0.0.999@1234567890.000000001");
      expect(data.completedAt).toBeTypeOf("number");
    });

    it("calls transferHbarWithKey with correct account IDs and amount (legacy)", async () => {
      await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(mockedTransferHbarWithKey).toHaveBeenCalledWith("0.0.123", "test-key", "0.0.456", 10);
    });

    it("returns 200 with paymentTxId on signature-based completion", async () => {
      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          txBytes: "base64-tx-bytes",
          publicKey: "302a300506032b6570032100deadbeef",
          signature: JSON.stringify(["base64-signature"]),
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.taskId).toBe("task-001");
      expect(data.paymentTxId).toBe("0.0.999@1234567890.000000001");
    });

    it("calls transferHbarWithSignature with correct parameters", async () => {
      await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          txBytes: "base64-tx-bytes",
          publicKey: "302a300506032b6570032100deadbeef",
          signature: JSON.stringify(["base64-signature"]),
        }),
      });

      expect(mockedTransferWithSignature).toHaveBeenCalledWith(
        "base64-tx-bytes",
        "302a300506032b6570032100deadbeef",
        [expect.any(Uint8Array)],
      );
    });

    it("returns 400 when no payment method provided (no signature, no private key)", async () => {
      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Payment method required");
    });

    it("submits HCS task_completed message after transfer", async () => {
      await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(mockedSubmit).toHaveBeenCalledOnce();
      const submittedMsg = mockedSubmit.mock.calls[0][0] as {
        type: string;
        taskId: string;
        paymentTxId: string;
      };
      expect(submittedMsg.type).toBe("task_completed");
      expect(submittedMsg.taskId).toBe("task-001");
      expect(submittedMsg.paymentTxId).toBe("0.0.999@1234567890.000000001");
    });

    it("updates cache to completed status", async () => {
      await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
        "task-001",
        "completed",
        expect.objectContaining({ paymentTxId: "0.0.999@1234567890.000000001" }),
      );
    });

    it("returns 404 for non-existent task", async () => {
      mockedGetTaskById.mockReturnValue(null);

      const res = await app.request("/market/tasks/nonexistent/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 400 when task is not in delivered status", async () => {
      mockedGetTaskById.mockReturnValue({ ...mockTask, status: "posted" as const });

      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("delivered");
    });

    it("returns 403 when caller is not the task poster", async () => {
      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: "did:hcs:0.0.999:3" }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("poster");
    });

    it("returns 403 when poster passport is revoked", async () => {
      mockedVerify.mockResolvedValue(false);

      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("passport");
    });

    it("returns 400 when task has no claimer", async () => {
      mockedGetTaskById.mockReturnValue({
        ...mockTask,
        status: "delivered" as const,
        claimerDid: undefined,
      });

      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("claimer");
    });

    it("returns 400 on missing posterDid", async () => {
      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("posterDid");
    });

    it("returns 400 on invalid JSON body", async () => {
      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid JSON");
    });

    it("returns 500 on transferHbarWithKey failure", async () => {
      mockedTransferHbarWithKey.mockRejectedValue(new Error("Insufficient balance"));

      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("Insufficient balance");
    });

    it("returns 500 on HCS submission failure after transfer", async () => {
      mockedSubmit.mockRejectedValue(new Error("HCS network error"));

      const res = await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toContain("HCS network error");
    });

    it("does not submit HCS message when transfer fails", async () => {
      mockedTransferHbarWithKey.mockRejectedValue(new Error("Transfer failed"));

      await app.request("/market/tasks/task-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(mockedSubmit).not.toHaveBeenCalled();
    });
  });

  describe("Full REST API lifecycle: post → claim → deliver → complete", () => {
    it("Agent A posts 'What is 2+2?' → Agent B finds, claims, delivers '4' → Agent A completes + pays", async () => {
      // ─── Step 1: Agent A posts a paid task ───
      mockedVerify.mockResolvedValue(true);
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@post-tx", consensusTimestamp: null });

      const postRes = await app.request("/market/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posterDid: POSTER_DID,
          title: "What is 2+2?",
          description: "Simple arithmetic question",
          priceHbar: 5,
          capabilities: ["api_call"],
        }),
      });

      expect(postRes.status).toBe(200);
      const postData = await postRes.json();
      expect(postData).toHaveProperty("taskId");
      expect(postData).toHaveProperty("txId");
      const taskId = postData.taskId;

      // ─── Step 2: Agent B discovers the task via GET /market/tasks ───
      const postedTask = {
        ...mockTask,
        taskId,
        title: "What is 2+2?",
        description: "Simple arithmetic question",
        priceHbar: 5,
        capabilities: ["api_call"],
        status: "posted" as const,
      };
      mockedListTasks.mockReturnValue({ tasks: [postedTask], total: 1 });

      const listRes = await app.request("/market/tasks?capability=api_call");

      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      expect(listData.tasks).toHaveLength(1);
      expect(listData.tasks[0].taskId).toBe(taskId);
      expect(listData.tasks[0].title).toBe("What is 2+2?");
      expect(listData.tasks[0].priceHbar).toBe(5);

      // ─── Step 3: Agent B claims the task ───
      mockedGetTaskById.mockReturnValue(postedTask);
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@claim-tx", consensusTimestamp: null });
      mockedDidToAccountId.mockImplementation(async (did: string) => {
        if (did === POSTER_DID) return "0.0.123";
        if (did === CLAIMER_DID) return "0.0.456";
        return null;
      });
      mockedCreateScheduledTransfer.mockResolvedValue({ scheduleId: "0.0.888@123", scheduleTxId: "0.0.999@456" });

      const claimRes = await app.request(`/market/tasks/${taskId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(claimRes.status).toBe(200);
      const claimData = await claimRes.json();
      expect(claimData).toHaveProperty("txId");
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(taskId, "claimed", { claimerDid: CLAIMER_DID, claimTxId: claimData.txId });

      // ─── Step 4: Agent B delivers the result ───
      const claimedTask = { ...postedTask, status: "claimed" as const, claimerDid: CLAIMER_DID };
      mockedGetTaskById.mockReturnValue(claimedTask);
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@deliver-tx", consensusTimestamp: null });

      const deliverRes = await app.request(`/market/tasks/${taskId}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimerDid: CLAIMER_DID,
          resultBody: "4",
        }),
      });

      expect(deliverRes.status).toBe(200);
      const deliverData = await deliverRes.json();
      expect(deliverData).toHaveProperty("txId");
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(taskId, "delivered", {
        resultIpfs: undefined,
        resultBody: "4",
        deliverTxId: deliverData.txId,
      });

      // ─── Step 5: Agent A completes the task and pays Agent B ───
      const deliveredTask = {
        ...claimedTask,
        status: "delivered" as const,
        resultBody: "4",
      };
      mockedGetTaskById.mockReturnValue(deliveredTask);
      mockedDidToAccountId.mockResolvedValue("0.0.123");
      mockedTransferHbarWithKey.mockResolvedValue("0.0.111@payment-tx");
      mockedSubmit.mockResolvedValue({ txId: "0.0.111@complete-tx", consensusTimestamp: null });

      const completeRes = await app.request(`/market/tasks/${taskId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: "test-key" }),
      });

      expect(completeRes.status).toBe(200);
      const completeData = await completeRes.json();
      expect(completeData).toHaveProperty("paymentTxId");
      expect(completeData.paymentTxId).toBe("0.0.111@payment-tx");
      expect(mockedTransferHbarWithKey).toHaveBeenCalledWith("0.0.123", "test-key", "0.0.123", 5);
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(taskId, "completed", {
        paymentTxId: "0.0.111@payment-tx",
        completedTxId: "0.0.111@complete-tx",
      });

      // ─── Verify full lifecycle: 5 HCS messages submitted (post, claim, escrow_created, deliver, complete) ───
      expect(mockedSubmit).toHaveBeenCalledTimes(5);
      expect(mockedVerify).toHaveBeenCalled();
    });
  });
});
