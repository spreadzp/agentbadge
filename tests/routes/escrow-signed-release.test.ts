import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { PrivateKey } from "@hashgraph/sdk";

// Bypass DID auth middleware for unit tests
process.env.DID_AUTH_MODE = "off";

vi.mock("../../src/server/middleware/did-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/middleware/did-auth")>();
  return {
    ...actual,
    requireDidSignature: () => async (_c: unknown, next: () => Promise<void>) => { await next(); },
    assertSameActor: () => null,
  };
});

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
    signScheduledTransaction: vi.fn(),
    signScheduledTransactionWithSignature: vi.fn(),
    deleteScheduledTransaction: vi.fn(),
    getScheduleInfo: vi.fn(),
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
  updateTaskVerificationAttempts: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
}));

vi.mock("../../src/verifiers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/verifiers")>();
  return {
    ...actual,
    runVerification: vi.fn(),
  };
});

import {
  submitTaskMessage,
  verifyA2ADid,
  didToAccountId,
  signScheduledTransaction,
  signScheduledTransactionWithSignature,
  deleteScheduledTransaction,
  getScheduleInfo,
} from "@agentgate-hedera/hedera-core";
import {
  getTaskById,
  updateTaskStatus,
  setEscrowStatus,
} from "@agentgate-hedera/passport";
import { runVerification } from "../../src/verifiers";
import { marketRoutes } from "../../src/server/routes/market";

const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedSubmitTaskMessage = vi.mocked(submitTaskMessage);
const mockedRunVerification = vi.mocked(runVerification);
const mockedSignScheduledTransaction = vi.mocked(signScheduledTransaction);
const mockedDeleteScheduled = vi.mocked(deleteScheduledTransaction);
const mockedGetScheduleInfo = vi.mocked(getScheduleInfo);

const mockedSignScheduledWithSig = vi.mocked(signScheduledTransactionWithSignature);

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.456:2";
const POSTER_PK = PrivateKey.generateED25519().toStringDer();
const POSTER_PUBLIC_KEY = PrivateKey.fromStringED25519(POSTER_PK).publicKey.toStringDer();
const FAKE_SCHEDULE_ID = "0.0.888";
const FAKE_TX_BYTES = Buffer.from("fake-schedule-sign-tx").toString("base64");
const FAKE_SIGNATURE = JSON.stringify([Buffer.from("fake-sig").toString("base64")]);

function makeApp(): Hono {
  return marketRoutes;
}

function mockDeliveredTask(overrides?: Record<string, unknown>) {
  return {
    taskId: "task-escrow-001",
    posterDid: POSTER_DID,
    title: "Escrow Release Test",
    description: "Test signed escrow release",
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
    scheduleId: FAKE_SCHEDULE_ID,
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
  mockedSignScheduledWithSig.mockResolvedValue({ txId: "0.0.999@schedule-sig", executed: true });
  mockedDeleteScheduled.mockResolvedValue({ scheduleId: FAKE_SCHEDULE_ID, deleted: true });
  mockedGetScheduleInfo.mockResolvedValue({
    scheduleId: FAKE_SCHEDULE_ID,
    executed: false,
    deleted: false,
    signers: [],
    expirationTime: undefined,
    memo: undefined,
    adminKey: undefined,
  });
  mockedUpdateTaskStatus.mockReturnValue(true);
  mockedSetEscrowStatus.mockReturnValue(true);
});

describe("SLICE-83-1: POST /market/tasks/:taskId/complete — signed escrow release (no private key)", () => {
  it("succeeds with {scheduleId, txBytes, publicKey, signature} — no posterPrivateKey", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        scheduleId: FAKE_SCHEDULE_ID,
        txBytes: FAKE_TX_BYTES,
        publicKey: POSTER_PUBLIC_KEY,
        signature: FAKE_SIGNATURE,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paymentTxId).toBe("0.0.999@schedule-sig");

    expect(mockedSignScheduledWithSig).toHaveBeenCalledWith(
      FAKE_SCHEDULE_ID,
      FAKE_TX_BYTES,
      POSTER_PUBLIC_KEY,
      expect.any(Array),
    );
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-escrow-001", "released");
  });

  it("rejects wrong signer — signature from different account", async () => {
    const wrongPubKey = PrivateKey.generateED25519().publicKey.toStringDer();
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);
    mockedGetScheduleInfo.mockResolvedValue({
      scheduleId: FAKE_SCHEDULE_ID,
      executed: false,
      deleted: false,
      signers: ["some-other-signer"],
      expirationTime: undefined,
      memo: undefined,
      adminKey: undefined,
    });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        scheduleId: FAKE_SCHEDULE_ID,
        txBytes: FAKE_TX_BYTES,
        publicKey: wrongPubKey,
        signature: FAKE_SIGNATURE,
      }),
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("signer");
    expect(mockedSignScheduledWithSig).not.toHaveBeenCalled();
  });

  it("rejects tampered txBytes — signature verification fails", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);
    mockedSignScheduledWithSig.mockRejectedValue(new Error("Signature verification failed"));

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        scheduleId: FAKE_SCHEDULE_ID,
        txBytes: Buffer.from("tampered-bytes").toString("base64"),
        publicKey: POSTER_PUBLIC_KEY,
        signature: FAKE_SIGNATURE,
      }),
    });

    expect(res.status).toBe(500);
    expect(mockedSignScheduledWithSig).toHaveBeenCalled();
  });

  it("still accepts posterPrivateKey for backward compat (escrow path)", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        posterPrivateKey: POSTER_PK,
      }),
    });

    expect(res.status).toBe(200);
    expect(mockedSignScheduledTransaction).toHaveBeenCalledWith(FAKE_SCHEDULE_ID, POSTER_PK);
    expect(mockedSignScheduledWithSig).not.toHaveBeenCalled();
  });

  it("rejects if signature path missing txBytes", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        scheduleId: FAKE_SCHEDULE_ID,
        publicKey: POSTER_PUBLIC_KEY,
        signature: FAKE_SIGNATURE,
      }),
    });

    expect(res.status).toBe(400);
    expect(mockedSignScheduledWithSig).not.toHaveBeenCalled();
  });

  it("rejects if signature path missing publicKey", async () => {
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-escrow-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        scheduleId: FAKE_SCHEDULE_ID,
        txBytes: FAKE_TX_BYTES,
        signature: FAKE_SIGNATURE,
      }),
    });

    expect(res.status).toBe(400);
    expect(mockedSignScheduledWithSig).not.toHaveBeenCalled();
  });
});
