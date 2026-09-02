import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { PrivateKey } from "@hashgraph/sdk";

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
    prepareTopicMessageTransaction: vi.fn(),
    submitSignedTopicMessage: vi.fn(),
    signTransactionBytes: vi.fn(),
    createScheduledTransfer: vi.fn(),
    signScheduledTransaction: vi.fn(),
    deleteScheduledTransaction: vi.fn(),
  };
});

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  getTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  setEscrowStatus: vi.fn(),
  returnTaskToMarket: vi.fn(),
  updateTaskVerificationAttempts: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
}));

vi.mock("../src/verifiers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/verifiers")>();
  return {
    ...actual,
    runVerification: vi.fn(),
  };
});

import {
  submitTaskMessage,
  verifyA2ADid,
  didToAccountId,
  prepareTransferTransaction,
  transferHbarWithSignature,
  transferHbarWithKey,
  signTransactionBytes,
  signScheduledTransaction,
  deleteScheduledTransaction,
} from "@agentbadge/hedera-core";
import {
  getTaskById,
  updateTaskStatus,
  setEscrowStatus,
  returnTaskToMarket,
  updateTaskVerificationAttempts,
} from "@agentbadge/passport";
import { runVerification } from "../src/verifiers";
import { marketRoutes } from "../src/server/routes/market";

const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedReturnTaskToMarket = vi.mocked(returnTaskToMarket);
const mockedUpdateTaskVerificationAttempts = vi.mocked(updateTaskVerificationAttempts);
const mockedSubmitTaskMessage = vi.mocked(submitTaskMessage);
const mockedRunVerification = vi.mocked(runVerification);
const mockedSignScheduledTransaction = vi.mocked(signScheduledTransaction);
const mockedDeleteScheduledTransaction = vi.mocked(deleteScheduledTransaction);
const mockedPrepareTransfer = vi.mocked(prepareTransferTransaction);
const mockedTransferHbarWithSignature = vi.mocked(transferHbarWithSignature);
const mockedTransferHbarWithKey = vi.mocked(transferHbarWithKey);
const mockedSignTxBytes = vi.mocked(signTransactionBytes);

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.456:2";
const POSTER_PK = PrivateKey.generateED25519().toStringDer();
const FAKE_TX_BYTES = Buffer.from("fake-tx-bytes").toString("base64");
const FAKE_SIGNATURE = JSON.stringify(["fake-sig-base64"]);
const FAKE_PUBLIC_KEY = "fake-public-key-der";
const FAKE_SCHEDULE_ID = "0.0.888";

function makeApp(): Hono {
  return marketRoutes;
}

function mockDeliveredTask(overrides?: Record<string, unknown>) {
  return {
    taskId: "task-complete-001",
    posterDid: POSTER_DID,
    title: "Complete Test Task",
    description: "Test verification gate",
    priceHbar: 10,
    capabilities: ["data_analysis"],
    status: "delivered" as const,
    txId: "0.0.111@posted-tx",
    consensusTimestamp: "2026-01-01T00:00:00Z",
    createdAt: 1000000,
    claimerDid: CLAIMER_DID,
    claimTxId: "0.0.456@claim-tx",
    deliverTxId: "0.0.456@deliver-tx",
    resultBody: "analysis complete",
    ...overrides,
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
  mockedRunVerification.mockResolvedValue({
    passed: true,
    attempts: 1,
    shouldReturnToMarket: false,
    result: { passed: true, report: "ok" },
  });
  mockedSignScheduledTransaction.mockResolvedValue({ txId: "0.0.999@schedule-sign", executed: true });
  mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: FAKE_SCHEDULE_ID, deleted: true });
  mockedPrepareTransfer.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.777@prepare" });
  mockedSignTxBytes.mockReturnValue({ signature: FAKE_SIGNATURE, publicKey: FAKE_PUBLIC_KEY });
  mockedTransferHbarWithSignature.mockResolvedValue("0.0.999@transfer");
  mockedTransferHbarWithKey.mockResolvedValue("0.0.999@transfer-key");
  mockedUpdateTaskStatus.mockReturnValue(true);
  mockedSetEscrowStatus.mockReturnValue(true);
  mockedReturnTaskToMarket.mockReturnValue(true);
  mockedUpdateTaskVerificationAttempts.mockReturnValue(true);
});

describe("SLICE-24-9: POST /market/tasks/:taskId/complete — verification gate + escrow", () => {
  it("passes verification with noop verifier → signs scheduled tx → completed", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask({ scheduleId: FAKE_SCHEDULE_ID }) as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.taskId).toBe("task-complete-001");
    expect(data.paymentTxId).toBe("0.0.999@schedule-sign");

    expect(mockedRunVerification).toHaveBeenCalledOnce();
    expect(mockedSignScheduledTransaction).toHaveBeenCalledWith(FAKE_SCHEDULE_ID, POSTER_PK);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-complete-001", "released");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-complete-001",
      "completed",
      expect.objectContaining({ paymentTxId: "0.0.999@schedule-sign" }),
    );
  });

  it("verification fails attempt 1 → 422, task stays delivered", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask({ scheduleId: FAKE_SCHEDULE_ID }) as any);
    mockedRunVerification.mockResolvedValue({
      passed: false,
      attempts: 1,
      shouldReturnToMarket: false,
      result: { passed: false, report: "Data mismatch" },
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("attempt 1/3");

    expect(mockedUpdateTaskVerificationAttempts).toHaveBeenCalledWith("task-complete-001", 1);
    expect(mockedReturnTaskToMarket).not.toHaveBeenCalled();
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
  });

  it("verification fails 3x → escrow cancelled, task returned to market", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask({ scheduleId: FAKE_SCHEDULE_ID, verificationAttempts: 2 }) as any);
    mockedRunVerification.mockResolvedValue({
      passed: false,
      attempts: 3,
      shouldReturnToMarket: true,
      result: { passed: false, report: "Critical failure" },
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("returned to marketplace");

    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(FAKE_SCHEDULE_ID);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-complete-001", "cancelled");
    expect(mockedReturnTaskToMarket).toHaveBeenCalledWith("task-complete-001");
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
  });

  it("no scheduleId → fallback to direct transfer (backward compat)", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paymentTxId).toBe("0.0.999@transfer-key");

    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    expect(mockedTransferHbarWithKey).toHaveBeenCalled();
  });

  it("no scheduleId → signature-based payment also works", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        txBytes: FAKE_TX_BYTES,
        publicKey: FAKE_PUBLIC_KEY,
        signature: FAKE_SIGNATURE,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockedTransferHbarWithSignature).toHaveBeenCalled();
  });
});

describe("SLICE-24-9: POST /market/tasks/:taskId/complete-with-key — verification gate + escrow", () => {
  it("passes verification → signs scheduled tx → completed", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask({ scheduleId: FAKE_SCHEDULE_ID }) as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paymentTxId).toBe("0.0.999@schedule-sign");

    expect(mockedRunVerification).toHaveBeenCalledOnce();
    expect(mockedSignScheduledTransaction).toHaveBeenCalledWith(FAKE_SCHEDULE_ID, POSTER_PK);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-complete-001", "released");
  });

  it("verification fails 3x → escrow cancelled, task returned", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask({ scheduleId: FAKE_SCHEDULE_ID, verificationAttempts: 2 }) as any);
    mockedRunVerification.mockResolvedValue({
      passed: false,
      attempts: 3,
      shouldReturnToMarket: true,
      result: { passed: false, report: "Failed all attempts" },
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(422);
    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(FAKE_SCHEDULE_ID);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-complete-001", "cancelled");
    expect(mockedReturnTaskToMarket).toHaveBeenCalledWith("task-complete-001");
  });

  it("no scheduleId → fallback to direct transfer", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(200);
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    expect(mockedPrepareTransfer).toHaveBeenCalled();
    expect(mockedTransferHbarWithSignature).toHaveBeenCalled();
  });

  it("verification fails attempt 1 → 422, task stays delivered", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask({ scheduleId: FAKE_SCHEDULE_ID }) as any);
    mockedRunVerification.mockResolvedValue({
      passed: false,
      attempts: 1,
      shouldReturnToMarket: false,
      result: { passed: false, report: "Not good enough" },
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-complete-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(422);
    expect(mockedUpdateTaskVerificationAttempts).toHaveBeenCalledWith("task-complete-001", 1);
    expect(mockedReturnTaskToMarket).not.toHaveBeenCalled();
  });
});
