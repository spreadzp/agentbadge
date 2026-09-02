import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentgate-hedera/hedera-core")>();
  return {
    ...actual,
    submitTaskMessage: vi.fn(),
    verifyA2ADid: vi.fn(),
    didToAccountId: vi.fn(),
    createScheduledTransfer: vi.fn(),
    deleteScheduledTransaction: vi.fn(),
  };
});

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  getTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  setEscrowStatus: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
}));

import {
  submitTaskMessage,
  verifyA2ADid,
  didToAccountId,
  createScheduledTransfer,
  deleteScheduledTransaction,
} from "@agentgate-hedera/hedera-core";
import {
  getTaskById,
  updateTaskStatus,
  setEscrowStatus,
} from "@agentgate-hedera/passport";
import { marketRoutes } from "../src/server/routes/market";

const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedSubmitTaskMessage = vi.mocked(submitTaskMessage);
const mockedCreateScheduledTransfer = vi.mocked(createScheduledTransfer);
const mockedDeleteScheduledTransaction = vi.mocked(deleteScheduledTransaction);

const POSTER_DID = "did:hcs:0.0.123:1";
const OTHER_DID = "did:hcs:0.0.999:3";
const CLAIMER_DID = "did:hcs:0.0.456:2";

function makeApp(): Hono {
  const app = new Hono();
  app.route("/", marketRoutes);
  return app;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    posterDid: POSTER_DID,
    title: "Test task",
    description: "Test description",
    priceHbar: 10,
    capabilities: ["data_provide"],
    status: "posted" as const,
    createdAt: Math.floor(Date.now() / 1000),
    txId: "0.0.777@initial",
    consensusTimestamp: new Date().toISOString(),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerify.mockResolvedValue(true);
  mockedDidToAccountId.mockResolvedValue("0.0.123");
  mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.777@hcs-tx", consensusTimestamp: null });
  mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: "0.0.555", deleted: true });
  mockedCreateScheduledTransfer.mockResolvedValue({
    scheduleId: "0.0.888",
    scheduleTxId: "0.0.888@schedule",
  });
  mockedUpdateTaskStatus.mockReturnValue(true);
  mockedSetEscrowStatus.mockReturnValue(true);
});

// ─── POST /market/tasks/:taskId/cancel ───────────────────────────

describe("POST /market/tasks/:taskId/cancel", () => {
  it("cancels a posted task without escrow", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "posted" }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBe("task-1");
    expect(data.hbarReturned).toBe(0);
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith("task-1", "cancelled");
    expect(mockedSubmitTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "task_cancelled", taskId: "task-1" }),
    );
    expect(mockedDeleteScheduledTransaction).not.toHaveBeenCalled();
  });

  it("cancels a claimed task with escrow and deletes schedule", async () => {
    mockedGetTaskById.mockReturnValue(
      makeTask({ status: "claimed", scheduleId: "0.0.555", claimerDid: CLAIMER_DID, priceHbar: 10 }),
    );

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hbarReturned).toBe(10);
    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith("0.0.555");
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-1", "cancelled");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith("task-1", "cancelled");
  });

  it("returns 403 if caller is not the poster", async () => {
    mockedGetTaskById.mockReturnValue(makeTask());

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: OTHER_DID }),
      },
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 if task not found", async () => {
    mockedGetTaskById.mockReturnValue(null);

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      },
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 if task is already completed", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "completed" }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      },
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 if posterDid is missing", async () => {
    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/cancel",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(400);
  });
});

// ─── POST /market/tasks/:taskId/increase-reward ──────────────────

describe("POST /market/tasks/:taskId/increase-reward", () => {
  it("increases reward for a posted task without existing escrow", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "posted", priceHbar: 10 }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, newPriceHbar: 20 }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBe("task-1");
    expect(data.newPriceHbar).toBe(20);
    expect(data.newScheduleId).toBe("0.0.888");
    expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
      "0.0.123",
      "",
      20,
      { memo: "escrow:task-1:20" },
    );
    expect(mockedDeleteScheduledTransaction).not.toHaveBeenCalled();
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-1", "pending", expect.objectContaining({
      priceHbar: 20,
      scheduleId: "0.0.888",
    }));
    expect(mockedSubmitTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task_reward_increased",
        oldPriceHbar: 10,
        newPriceHbar: 20,
        newScheduleId: "0.0.888",
      }),
    );
  });

  it("increases reward for a claimed task and deletes old escrow", async () => {
    mockedGetTaskById.mockReturnValue(
      makeTask({ status: "claimed", priceHbar: 10, scheduleId: "0.0.555", claimerDid: CLAIMER_DID }),
    );

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, newPriceHbar: 25 }),
      },
    );

    expect(res.status).toBe(200);
    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith("0.0.555");
    expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
      "0.0.123",
      CLAIMER_DID,
      25,
      { memo: "escrow:task-1:25" },
    );
  });

  it("returns 400 if newPriceHbar is not greater than current", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "posted", priceHbar: 10 }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, newPriceHbar: 5 }),
      },
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 if task is delivered (not posted/claimed)", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "delivered" }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, newPriceHbar: 20 }),
      },
    );

    expect(res.status).toBe(400);
  });

  it("returns 403 if caller is not the poster", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "posted" }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: OTHER_DID, newPriceHbar: 20 }),
      },
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 if task not found", async () => {
    mockedGetTaskById.mockReturnValue(null);

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, newPriceHbar: 20 }),
      },
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 if newPriceHbar is missing", async () => {
    mockedGetTaskById.mockReturnValue(makeTask({ status: "posted" }));

    const app = makeApp();
    const res = await app.request(
      "/market/tasks/task-1/increase-reward",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      },
    );

    expect(res.status).toBe(400);
  });
});
