import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getEscrowStatusHandler,
  cancelEscrowHandler,
  increaseRewardHandler,
  verifyResultHandler,
  registerEscrowTools,
} from "@agentbadge/mcp";

const POSTER_DID = "did:hcs:0.0.123:1";
const TASK_ID = "task-1700000000-abc123";

describe("Escrow MCP Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SERVER_URL = "http://localhost:4021";
  });

  afterEach(() => {
    delete process.env.SERVER_URL;
  });

  describe("get_escrow_status", () => {
    it("returns escrow info on valid task", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          taskId: TASK_ID,
          scheduleId: "0.0.999",
          escrowStatus: "scheduled",
          verificationAttempts: 0,
          verifierType: "noop",
          priceHbar: 5,
        }),
      );

      const result = await getEscrowStatusHandler({ taskId: TASK_ID });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe(TASK_ID);
      expect(parsed.scheduleId).toBe("0.0.999");
      expect(parsed.escrowStatus).toBe("scheduled");
      expect(parsed.priceHbar).toBe(5);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:4021/market/tasks/${TASK_ID}/escrow-status`);
    });

    it("returns error when task not found", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Task not found" }, 404));

      const result = await getEscrowStatusHandler({ taskId: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Task not found");
    });

    it("returns validation error when taskId is missing", async () => {
      const result = await getEscrowStatusHandler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });

    it("returns validation error when taskId is empty", async () => {
      const result = await getEscrowStatusHandler({ taskId: "" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });
  });

  describe("cancel_escrow", () => {
    it("cancels task successfully", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          taskId: TASK_ID,
          cancelledAt: 1700000001,
          hbarReturned: 5,
        }),
      );

      const result = await cancelEscrowHandler({ taskId: TASK_ID, posterDid: POSTER_DID });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe(TASK_ID);
      expect(parsed.cancelledAt).toBe(1700000001);
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:4021/market/tasks/${TASK_ID}/cancel`);
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.posterDid).toBe(POSTER_DID);
    });

    it("returns error when ownership mismatch", async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: "Only the poster can cancel" }, 403));

      const result = await cancelEscrowHandler({ taskId: TASK_ID, posterDid: POSTER_DID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Only the poster");
    });

    it("returns validation error when posterDid is missing", async () => {
      const result = await cancelEscrowHandler({ taskId: TASK_ID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });

    it("returns validation error when taskId is missing", async () => {
      const result = await cancelEscrowHandler({ posterDid: POSTER_DID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });
  });

  describe("increase_reward", () => {
    it("increases reward successfully", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          taskId: TASK_ID,
          newScheduleId: "0.0.888",
          newPriceHbar: 10,
          hcsTxId: "0.0.111@1700000002",
        }),
      );

      const result = await increaseRewardHandler({
        taskId: TASK_ID,
        posterDid: POSTER_DID,
        newPriceHbar: 10,
      });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe(TASK_ID);
      expect(parsed.newPriceHbar).toBe(10);
      expect(parsed.newScheduleId).toBe("0.0.888");
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:4021/market/tasks/${TASK_ID}/increase-reward`);
      expect(opts.method).toBe("POST");
      const body = JSON.parse(opts.body);
      expect(body.posterDid).toBe(POSTER_DID);
      expect(body.newPriceHbar).toBe(10);
    });

    it("returns error when new price is not greater than current", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "New price must be greater than current price" }, 400),
      );

      const result = await increaseRewardHandler({
        taskId: TASK_ID,
        posterDid: POSTER_DID,
        newPriceHbar: 3,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("greater than current");
    });

    it("returns validation error when newPriceHbar is missing", async () => {
      const result = await increaseRewardHandler({
        taskId: TASK_ID,
        posterDid: POSTER_DID,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });

    it("returns validation error when newPriceHbar is not positive", async () => {
      const result = await increaseRewardHandler({
        taskId: TASK_ID,
        posterDid: POSTER_DID,
        newPriceHbar: -5,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });

    it("returns validation error when newPriceHbar is zero", async () => {
      const result = await increaseRewardHandler({
        taskId: TASK_ID,
        posterDid: POSTER_DID,
        newPriceHbar: 0,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });
  });

  describe("verify_result", () => {
    it("returns verification result on valid task", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          taskId: TASK_ID,
          passed: true,
          attempts: 1,
          shouldReturnToMarket: false,
          report: "All checks passed",
        }),
      );

      const result = await verifyResultHandler({ taskId: TASK_ID });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.taskId).toBe(TASK_ID);
      expect(parsed.passed).toBe(true);
      expect(parsed.attempts).toBe(1);
      expect(parsed.report).toBe("All checks passed");
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe(`http://localhost:4021/market/tasks/${TASK_ID}/verify`);
      expect(opts.method).toBe("POST");
    });

    it("returns result when verification fails", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          taskId: TASK_ID,
          passed: false,
          attempts: 3,
          shouldReturnToMarket: true,
          report: "Verification failed: data mismatch",
        }),
      );

      const result = await verifyResultHandler({ taskId: TASK_ID });

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.passed).toBe(false);
      expect(parsed.shouldReturnToMarket).toBe(true);
    });

    it("returns error when task not in delivered status", async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ error: "Verification requires delivered or claimed status" }, 400),
      );

      const result = await verifyResultHandler({ taskId: TASK_ID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("delivered or claimed");
    });

    it("returns validation error when taskId is missing", async () => {
      const result = await verifyResultHandler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Validation error");
    });
  });

  describe("registerEscrowTools", () => {
    it("registers without throwing", () => {
      expect(() => registerEscrowTools()).not.toThrow();
    });
  });
});
