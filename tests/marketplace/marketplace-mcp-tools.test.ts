import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// MCP marketplace tools are thin HTTP clients — they call the REST API via fetch.
// Mock global.fetch instead of mocking service functions.

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(data: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

import {
  postTaskHandler,
  listTasksHandler,
  claimTaskHandler,
  deliverResultHandler,
  preparePaymentHandler,
  completeTaskHandler,
  registerMarketplaceTools,
} from "@agentbadge/mcp";

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.123:2";

describe("Marketplace MCP Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVER_URL = "http://localhost:4021";
  });

  afterEach(() => {
    delete process.env.SERVER_URL;
  });

  describe("post_task", () => {
    it("returns taskId and txId on valid input", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ taskId: "task-001", txId: "0.0.111@1234567890", timestamp: 1234567890 }),
      );

      const result = await postTaskHandler({
        posterDid: POSTER_DID,
        title: "Code review",
        description: "Review PR #42",
        priceHbar: 10,
        capabilities: ["code_review"],
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe("task-001");
      expect(parsed.txId).toBe("0.0.111@1234567890");
      expect(parsed.timestamp).toBe(1234567890);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:4021/market/tasks");
      expect(opts.method).toBe("POST");
    });

    it("returns MCP error when poster passport invalid", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Poster passport not found or revoked" }, 403));

      const result = await postTaskHandler({
        posterDid: POSTER_DID,
        title: "Code review",
        description: "Review PR",
        priceHbar: 10,
        capabilities: ["code_review"],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("passport");
    });

    it("returns validation error when title is missing", async () => {
      const result = await postTaskHandler({
        posterDid: POSTER_DID,
        description: "Review PR",
        priceHbar: 10,
        capabilities: ["code_review"],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns validation error when priceHbar is negative", async () => {
      const result = await postTaskHandler({
        posterDid: POSTER_DID,
        title: "Code review",
        description: "Review PR",
        priceHbar: -5,
        capabilities: ["code_review"],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns MCP error when HCS submission fails", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "HCS network error" }, 500));

      const result = await postTaskHandler({
        posterDid: POSTER_DID,
        title: "Code review",
        description: "Review PR",
        priceHbar: 10,
        capabilities: ["code_review"],
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("HCS network error");
    });
  });

  describe("list_tasks", () => {
    it("returns tasks on valid call", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ tasks: [{ taskId: "task-001" }], count: 1, total: 1, limit: 50, offset: 0 }),
      );

      const result = await listTasksHandler({});

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks).toHaveLength(1);
      expect(parsed.total).toBe(1);
    });

    it("filters by capability", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ tasks: [], count: 0, total: 0, limit: 50, offset: 0 }),
      );

      await listTasksHandler({ capability: "code_review" });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("capability=code_review");
    });

    it("applies pagination", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ tasks: [], count: 0, total: 10, limit: 3, offset: 2 }),
      );

      const result = await listTasksHandler({ limit: 3, offset: 2 });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.total).toBe(10);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("limit=3");
      expect(url).toContain("offset=2");
    });

    it("returns empty list when no tasks", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ tasks: [], count: 0, total: 0, limit: 50, offset: 0 }),
      );

      const result = await listTasksHandler({});

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tasks).toHaveLength(0);
      expect(parsed.total).toBe(0);
    });
  });

  describe("claim_task", () => {
    it("returns success on valid claim", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ taskId: "task-001", txId: "0.0.222@1234567890", timestamp: 1234567890 }),
      );

      const result = await claimTaskHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe("task-001");
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:4021/market/tasks/task-001/claim");
      expect(opts.method).toBe("POST");
    });

    it("returns MCP error when task not found", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Task not found" }, 404));

      const result = await claimTaskHandler({
        taskId: "nonexistent",
        claimerDid: CLAIMER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns MCP error when task already claimed", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Task is claimed, cannot claim" }, 409),
      );

      const result = await claimTaskHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("claimed");
    });

    it("returns MCP error when claimer passport invalid", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Claimer passport not found or revoked" }, 403),
      );

      const result = await claimTaskHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("passport");
    });

    it("returns validation error when taskId is missing", async () => {
      const result = await claimTaskHandler({ claimerDid: CLAIMER_DID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("deliver_result", () => {
    it("returns success on valid delivery", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ taskId: "task-001", txId: "0.0.333@1234567890", timestamp: 1234567890 }),
      );

      const result = await deliverResultHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
        resultBody: "Review complete, LGTM",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe("task-001");
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:4021/market/tasks/task-001/deliver");
    });

    it("returns MCP error when task not found", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Task not found" }, 404));

      const result = await deliverResultHandler({
        taskId: "nonexistent",
        claimerDid: CLAIMER_DID,
        resultBody: "result",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns MCP error when claimer does not match", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Only claimer can deliver" }, 403),
      );

      const result = await deliverResultHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
        resultBody: "result",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("claimer");
    });

    it("returns MCP error when task is not in claimed status", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Task is posted, cannot deliver" }, 409),
      );

      const result = await deliverResultHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
        resultBody: "result",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("cannot deliver");
    });

    it("returns validation error when resultBody exceeds 4KB", async () => {
      const bigBody = "x".repeat(4097);

      const result = await deliverResultHandler({
        taskId: "task-001",
        claimerDid: CLAIMER_DID,
        resultBody: bigBody,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("prepare_payment", () => {
    it("returns txBytes, txId, and account IDs on valid call", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          txBytes: "mock-tx-bytes-base64",
          txId: "0.0.123@1234567890.000000001",
          fromAccountId: "0.0.123",
          toAccountId: "0.0.456",
          amountHbar: 10,
        }),
      );

      const result = await preparePaymentHandler({
        taskId: "task-001",
        posterDid: POSTER_DID,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.txBytes).toBe("mock-tx-bytes-base64");
      expect(parsed.txId).toBe("0.0.123@1234567890.000000001");
      expect(parsed.fromAccountId).toBe("0.0.123");
      expect(parsed.toAccountId).toBe("0.0.456");
      expect(parsed.amountHbar).toBe(10);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:4021/market/tasks/task-001/prepare-payment");
      expect(opts.method).toBe("POST");
    });

    it("returns MCP error when task not found", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Task not found" }, 404));

      const result = await preparePaymentHandler({
        taskId: "nonexistent",
        posterDid: POSTER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns MCP error when caller is not the poster", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Only the task poster can prepare payment" }, 403),
      );

      const result = await preparePaymentHandler({
        taskId: "task-001",
        posterDid: "did:hcs:0.0.123:9",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("poster");
    });

    it("returns validation error when taskId is missing", async () => {
      const result = await preparePaymentHandler({ posterDid: POSTER_DID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns validation error when posterDid is missing", async () => {
      const result = await preparePaymentHandler({ taskId: "task-001" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("complete_task", () => {
    it("returns paymentTxId on valid completion", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ taskId: "task-001", paymentTxId: "0.0.999@1234567890", completedAt: 1234567890 }),
      );

      const result = await completeTaskHandler({
        taskId: "task-001",
        posterDid: POSTER_DID,
        posterPrivateKey: "test-private-key",
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe("task-001");
      expect(parsed.paymentTxId).toBe("0.0.999@1234567890");
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:4021/market/tasks/task-001/complete");
      expect(opts.method).toBe("POST");
    });

    it("sends signature-based payment fields when provided", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ taskId: "task-001", paymentTxId: "0.0.999@1234567890", completedAt: 1234567890 }),
      );

      await completeTaskHandler({
        taskId: "task-001",
        posterDid: POSTER_DID,
        txBytes: "base64-tx",
        publicKey: "302a300506032b6570",
        signature: "base64-sig",
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      expect(body.txBytes).toBe("base64-tx");
      expect(body.publicKey).toBe("302a300506032b6570");
      expect(body.signature).toBe("base64-sig");
      expect(body.posterPrivateKey).toBeUndefined();
    });

    it("returns MCP error when task not found", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Task not found" }, 404));

      const result = await completeTaskHandler({
        taskId: "nonexistent",
        posterDid: POSTER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });

    it("returns MCP error when poster is not the task owner", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Only the task poster can complete this task" }, 403),
      );

      const result = await completeTaskHandler({
        taskId: "task-001",
        posterDid: "did:hcs:0.0.123:9",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("poster");
    });

    it("returns MCP error when task is not in delivered status", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Task must be in delivered status, current: claimed" }, 400),
      );

      const result = await completeTaskHandler({
        taskId: "task-001",
        posterDid: POSTER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("delivered status");
    });

    it("returns validation error when taskId is missing", async () => {
      const result = await completeTaskHandler({ posterDid: POSTER_DID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("registerMarketplaceTools", () => {
    it("registers all 6 tools without throwing", () => {
      expect(() => registerMarketplaceTools()).not.toThrow();
    });
  });
});
