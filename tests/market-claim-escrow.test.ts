import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { PrivateKey } from "@hashgraph/sdk";

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
    prepareTopicMessageTransaction: vi.fn(),
    submitSignedTopicMessage: vi.fn(),
    signTransactionBytes: vi.fn(),
    createScheduledTransfer: vi.fn(),
  };
});

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  getTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  setEscrowStatus: vi.fn(),
  returnTaskToMarket: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
}));

import {
  submitTaskMessage,
  verifyA2ADid,
  didToAccountId,
  prepareTopicMessageTransaction,
  submitSignedTopicMessage,
  signTransactionBytes,
  createScheduledTransfer,
} from "@agentgate-hedera/hedera-core";
import {
  getTaskById,
  updateTaskStatus,
  setEscrowStatus,
  returnTaskToMarket,
} from "@agentgate-hedera/passport";
import { marketRoutes } from "../src/server/routes/market";

const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedPrepareTopic = vi.mocked(prepareTopicMessageTransaction);
const mockedSubmitSigned = vi.mocked(submitSignedTopicMessage);
const mockedSignTxBytes = vi.mocked(signTransactionBytes);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedReturnTaskToMarket = vi.mocked(returnTaskToMarket);
const mockedSubmitTaskMessage = vi.mocked(submitTaskMessage);
const mockedCreateScheduledTransfer = vi.mocked(createScheduledTransfer);

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.456:2";
const CLAIMER_PK = PrivateKey.generateED25519().toStringDer();
const FAKE_TX_BYTES = Buffer.from("fake-tx-bytes").toString("base64");
const FAKE_SIGNATURE = JSON.stringify(["fake-sig-base64"]);
const FAKE_PUBLIC_KEY = "fake-public-key-der";
const FAKE_SCHEDULE_ID = "0.0.999";
const FAKE_SCHEDULE_TX_ID = "0.0.123@schedule-tx";

function makeApp(): Hono {
  return marketRoutes;
}

function mockPostedTask() {
  return {
    taskId: "task-escrow-001",
    posterDid: POSTER_DID,
    title: "Escrow Test Task",
    description: "Test escrow creation at claim",
    priceHbar: 10,
    capabilities: ["data_analysis"],
    status: "posted" as const,
    txId: "0.0.111@posted-tx",
    consensusTimestamp: "2026-01-01T00:00:00Z",
    createdAt: 1000000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerify.mockResolvedValue(true);
  mockedDidToAccountId.mockImplementation(async (did: string) => {
    if (did === POSTER_DID) return "0.0.123";
    if (did === CLAIMER_DID) return "0.0.456";
    return null;
  });
  mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@hcs-tx", consensusTimestamp: null });
  mockedCreateScheduledTransfer.mockResolvedValue({
    scheduleId: FAKE_SCHEDULE_ID,
    scheduleTxId: FAKE_SCHEDULE_TX_ID,
  });
  mockedPrepareTopic.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.999@prepare" });
  mockedSubmitSigned.mockResolvedValue({ txId: "0.0.999@signed-submit", consensusTimestamp: null });
  mockedSignTxBytes.mockReturnValue({ signature: FAKE_SIGNATURE, publicKey: FAKE_PUBLIC_KEY });
  mockedUpdateTaskStatus.mockReturnValue(true);
  mockedSetEscrowStatus.mockReturnValue(true);
  mockedReturnTaskToMarket.mockReturnValue(true);
});

describe("SLICE-24-8: POST /market/tasks/:taskId/claim — escrow creation", () => {
  it("creates scheduled transfer after claim and returns scheduleId", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimerDid: CLAIMER_DID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBe("task-escrow-001");
    expect(data.txId).toBeDefined();
    expect(data.scheduleId).toBe(FAKE_SCHEDULE_ID);

    // Verify createScheduledTransfer was called with correct params
    expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
      "0.0.123",
      "0.0.456",
      10,
      { memo: "escrow:task-escrow-001:did:hcs:0.0.456:2" },
    );

    // Verify setEscrowStatus was called with scheduleId
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith(
      "task-escrow-001",
      "pending",
      { scheduleId: FAKE_SCHEDULE_ID, scheduleTxId: FAKE_SCHEDULE_TX_ID },
    );

    // Verify task_escrow_created HCS message was submitted
    expect(mockedSubmitTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task_escrow_created",
        taskId: "task-escrow-001",
        scheduleId: FAKE_SCHEDULE_ID,
        amountHbar: 10,
      }),
    );
  });

  it("reverts task to posted if createScheduledTransfer fails", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);
    mockedCreateScheduledTransfer.mockRejectedValue(new Error("Hedera network error"));

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimerDid: CLAIMER_DID }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("escrow creation failed");

    // Verify returnTaskToMarket was called to revert
    expect(mockedReturnTaskToMarket).toHaveBeenCalledWith("task-escrow-001");
  });

  it("returns 400 if poster DID cannot be resolved to account ID", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);
    mockedDidToAccountId.mockImplementation(async (did: string) => {
      if (did === CLAIMER_DID) return "0.0.456";
      return null;
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimerDid: CLAIMER_DID }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Could not resolve DID to account ID");
  });

  it("still works with 409 for non-posted task", async () => {
    mockedGetTaskById.mockReturnValue({ ...mockPostedTask(), status: "claimed" } as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimerDid: CLAIMER_DID }),
    });

    expect(res.status).toBe(409);
    expect(mockedCreateScheduledTransfer).not.toHaveBeenCalled();
  });
});

describe("SLICE-24-8: POST /market/tasks/:taskId/claim-with-key — escrow creation", () => {
  it("creates scheduled transfer after agent-signed claim and returns scheduleId", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        claimerPrivateKey: CLAIMER_PK,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBe("task-escrow-001");
    expect(data.txId).toBeDefined();
    expect(data.scheduleId).toBe(FAKE_SCHEDULE_ID);

    // Verify createScheduledTransfer was called (poster → claimer)
    expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
      "0.0.123",
      "0.0.456",
      10,
      { memo: "escrow:task-escrow-001:did:hcs:0.0.456:2" },
    );

    // Verify setEscrowStatus was called
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith(
      "task-escrow-001",
      "pending",
      { scheduleId: FAKE_SCHEDULE_ID, scheduleTxId: FAKE_SCHEDULE_TX_ID },
    );

    // Verify task_escrow_created HCS message
    expect(mockedSubmitTaskMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task_escrow_created",
        taskId: "task-escrow-001",
        scheduleId: FAKE_SCHEDULE_ID,
        amountHbar: 10,
      }),
    );
  });

  it("reverts task to posted if escrow creation fails (claim-with-key)", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);
    mockedCreateScheduledTransfer.mockRejectedValue(new Error("Schedule creation failed"));

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        claimerPrivateKey: CLAIMER_PK,
      }),
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("escrow creation failed");

    expect(mockedReturnTaskToMarket).toHaveBeenCalledWith("task-escrow-001");
  });

  it("returns 400 if poster DID cannot be resolved (claim-with-key)", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);
    mockedDidToAccountId.mockImplementation(async (did: string) => {
      if (did === CLAIMER_DID) return "0.0.456";
      return null;
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        claimerPrivateKey: CLAIMER_PK,
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Could not resolve poster DID");
  });
});
