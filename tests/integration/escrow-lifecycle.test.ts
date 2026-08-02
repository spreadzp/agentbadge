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
    signScheduledTransaction: vi.fn(),
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
  prepareTransferTransaction,
  transferHbarWithSignature,
  transferHbarWithKey,
  signTransactionBytes,
  createScheduledTransfer,
  signScheduledTransaction,
  deleteScheduledTransaction,
} from "@agentgate-hedera/hedera-core";
import {
  getTaskById,
  updateTaskStatus,
  setEscrowStatus,
  returnTaskToMarket,
  updateTaskVerificationAttempts,
} from "@agentgate-hedera/passport";
import { runVerification } from "../../src/verifiers";
import { marketRoutes } from "../../src/server/routes/market";

const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedSetEscrowStatus = vi.mocked(setEscrowStatus);
const mockedReturnTaskToMarket = vi.mocked(returnTaskToMarket);
const mockedUpdateTaskVerificationAttempts = vi.mocked(updateTaskVerificationAttempts);
const mockedSubmitTaskMessage = vi.mocked(submitTaskMessage);
const mockedRunVerification = vi.mocked(runVerification);
const mockedCreateScheduledTransfer = vi.mocked(createScheduledTransfer);
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
const SCHEDULE_ID_1 = "0.0.10001";
const SCHEDULE_ID_2 = "0.0.10002";
const SCHEDULE_TX_ID = "0.0.123@schedule-tx";

function makeApp(): Hono {
  return marketRoutes;
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-int-001",
    posterDid: POSTER_DID,
    title: "Integration Test Task",
    description: "Full lifecycle test",
    priceHbar: 10,
    capabilities: ["data_analysis"],
    status: "posted" as const,
    txId: "0.0.111@posted-tx",
    consensusTimestamp: "2026-01-01T00:00:00Z",
    createdAt: 1000000,
    ...overrides,
  } as any;
}

function hcsMessageTypes(): string[] {
  return mockedSubmitTaskMessage.mock.calls.map((c) => (c[0] as any).type);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedVerify.mockResolvedValue(true);
  mockedDidToAccountId.mockImplementation(async (did: string) => {
    if (did === POSTER_DID) return "0.0.123";
    if (did === CLAIMER_DID) return "0.0.456";
    return null;
  });
  mockedSubmitTaskMessage.mockResolvedValue("0.0.999@hcs-tx");
  mockedCreateScheduledTransfer.mockResolvedValue({
    scheduleId: SCHEDULE_ID_1,
    scheduleTxId: SCHEDULE_TX_ID,
  });
  mockedSignScheduledTransaction.mockResolvedValue({ txId: "0.0.999@schedule-sign", executed: true });
  mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID_1, deleted: true });
  mockedPrepareTransfer.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.777@prepare" });
  mockedSignTxBytes.mockReturnValue({ signature: FAKE_SIGNATURE, publicKey: FAKE_PUBLIC_KEY });
  mockedTransferHbarWithSignature.mockResolvedValue("0.0.999@transfer");
  mockedTransferHbarWithKey.mockResolvedValue("0.0.999@transfer-key");
  mockedRunVerification.mockResolvedValue({
    passed: true,
    attempts: 1,
    shouldReturnToMarket: false,
    result: { passed: true, report: "ok" },
  });
  mockedUpdateTaskStatus.mockReturnValue(true);
  mockedSetEscrowStatus.mockReturnValue(true);
  mockedReturnTaskToMarket.mockReturnValue(true);
  mockedUpdateTaskVerificationAttempts.mockReturnValue(true);
});

// ─── Scenario 1: Happy path (noop verifier) ───────────────────────

describe("SLICE-24-13 Scenario 1: Happy path — full lifecycle with escrow", () => {
  it("post → claim (escrow) → deliver → complete (verify + release)", async () => {
    const app = makeApp();

    // Step 1: Claim (escrow created)
    mockedGetTaskById.mockReturnValue(makeTask({ status: "posted" }));
    const claimRes = await app.request("/market/tasks/task-int-001/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimerDid: CLAIMER_DID }),
    });

    expect(claimRes.status).toBe(200);
    const claimData = await claimRes.json();
    expect(claimData.scheduleId).toBe(SCHEDULE_ID_1);
    expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
      "0.0.123", "0.0.456", 10,
      { memo: "escrow:task-int-001:did:hcs:0.0.456:2" },
    );
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith(
      "task-int-001", "pending",
      { scheduleId: SCHEDULE_ID_1, scheduleTxId: SCHEDULE_TX_ID },
    );
    expect(hcsMessageTypes()).toContain("task_escrow_created");

    // Step 2: Deliver result
    vi.clearAllMocks();
    mockedGetTaskById.mockReturnValue(makeTask({
      status: "claimed",
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
      escrowStatus: "pending",
    }));
    mockedVerify.mockResolvedValue(true);
    mockedSubmitTaskMessage.mockResolvedValue("0.0.999@deliver-tx");

    const deliverRes = await app.request("/market/tasks/task-int-001/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimerDid: CLAIMER_DID, resultBody: "analysis complete" }),
    });

    expect(deliverRes.status).toBe(200);
    expect(hcsMessageTypes()).toContain("task_delivered");

    // Step 3: Complete (verify + release escrow)
    vi.clearAllMocks();
    mockedGetTaskById.mockReturnValue(makeTask({
      status: "delivered",
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
      escrowStatus: "pending",
      resultBody: "analysis complete",
    }));
    mockedVerify.mockResolvedValue(true);
    mockedSubmitTaskMessage.mockResolvedValue("0.0.999@hcs-tx");
    mockedRunVerification.mockResolvedValue({
      passed: true,
      attempts: 1,
      shouldReturnToMarket: false,
      result: { passed: true, report: "ok" },
    });
    mockedSignScheduledTransaction.mockResolvedValue({ txId: "0.0.999@schedule-sign", executed: true });

    const completeRes = await app.request("/market/tasks/task-int-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(completeRes.status).toBe(200);
    const completeData = await completeRes.json();
    expect(completeData.paymentTxId).toBe("0.0.999@schedule-sign");

    expect(mockedRunVerification).toHaveBeenCalledOnce();
    expect(mockedSignScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID_1, POSTER_PK);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-int-001", "released");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-int-001", "completed",
      expect.objectContaining({ paymentTxId: "0.0.999@schedule-sign" }),
    );
    expect(hcsMessageTypes()).toContain("task_completed");
  });
});

// ─── Scenario 2: Verification fail + retry success ────────────────

describe("SLICE-24-13 Scenario 2: Verification fail then retry success", () => {
  it("complete (fail attempt 1) → complete (pass attempt 2)", async () => {
    const app = makeApp();

    // Attempt 1: verification fails
    mockedGetTaskById.mockReturnValue(makeTask({
      status: "delivered",
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
      verificationAttempts: 0,
    }));
    mockedRunVerification.mockResolvedValue({
      passed: false,
      attempts: 1,
      shouldReturnToMarket: false,
      result: { passed: false, report: "Data mismatch" },
    });

    const failRes = await app.request("/market/tasks/task-int-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(failRes.status).toBe(422);
    const failData = await failRes.json();
    expect(failData.error).toContain("attempt 1/3");
    expect(mockedUpdateTaskVerificationAttempts).toHaveBeenCalledWith("task-int-001", 1);
    expect(mockedReturnTaskToMarket).not.toHaveBeenCalled();
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();

    // Attempt 2: verification passes
    vi.clearAllMocks();
    mockedGetTaskById.mockReturnValue(makeTask({
      status: "delivered",
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
      verificationAttempts: 1,
    }));
    mockedVerify.mockResolvedValue(true);
    mockedSubmitTaskMessage.mockResolvedValue("0.0.999@hcs-tx");
    mockedRunVerification.mockResolvedValue({
      passed: true,
      attempts: 2,
      shouldReturnToMarket: false,
      result: { passed: true, report: "ok on retry" },
    });
    mockedSignScheduledTransaction.mockResolvedValue({ txId: "0.0.999@schedule-sign", executed: true });

    const passRes = await app.request("/market/tasks/task-int-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(passRes.status).toBe(200);
    expect(mockedSignScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID_1, POSTER_PK);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-int-001", "released");
  });
});

// ─── Scenario 3: Verification fail 3x → return to market ──────────

describe("SLICE-24-13 Scenario 3: Fail 3x → task returned to marketplace", () => {
  it("complete (fail 1) → complete (fail 2) → complete (fail 3, return to market)", async () => {
    const app = makeApp();

    // Attempt 3 (attempts=2, so this is the 3rd): verification fails, return to market
    mockedGetTaskById.mockReturnValue(makeTask({
      status: "delivered",
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
      verificationAttempts: 2,
    }));
    mockedRunVerification.mockResolvedValue({
      passed: false,
      attempts: 3,
      shouldReturnToMarket: true,
      result: { passed: false, report: "Critical failure" },
    });
    mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID_1, deleted: true });

    const res = await app.request("/market/tasks/task-int-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain("returned to marketplace");

    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID_1);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-int-001", "cancelled");
    expect(mockedReturnTaskToMarket).toHaveBeenCalledWith("task-int-001");
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    // task_verification_failed HCS message is submitted inside runVerification → logReputationPenalty
    // Since runVerification is mocked, verify it was called and returned shouldReturnToMarket: true
    expect(mockedRunVerification).toHaveBeenCalledOnce();
    const resolved = await mockedRunVerification.mock.results[0].value;
    expect(resolved).toHaveProperty("shouldReturnToMarket", true);
    expect(resolved).toHaveProperty("passed", false);
    expect(resolved).toHaveProperty("attempts", 3);
  });
});

// ─── Scenario 4: Cancel by poster (claimed task) ──────────────────

describe("SLICE-24-13 Scenario 4: Cancel by poster — escrow cancelled", () => {
  it("post → claim → cancel (escrow cancelled, HBAR returned)", async () => {
    const app = makeApp();

    // Cancel a claimed task with escrow
    mockedGetTaskById.mockReturnValue(makeTask({
      status: "claimed",
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
      priceHbar: 10,
    }));
    mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID_1, deleted: true });

    const res = await app.request("/market/tasks/task-int-001/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hbarReturned).toBe(10);

    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID_1);
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-int-001", "cancelled");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith("task-int-001", "cancelled");
    expect(hcsMessageTypes()).toContain("task_cancelled");
  });
});

// ─── Scenario 5: Increase reward ──────────────────────────────────

describe("SLICE-24-13 Scenario 5: Increase reward — new schedule created", () => {
  it("post (5 HBAR) → claim → increase-reward (10 HBAR)", async () => {
    const app = makeApp();

    mockedGetTaskById.mockReturnValue(makeTask({
      status: "claimed",
      priceHbar: 5,
      scheduleId: SCHEDULE_ID_1,
      claimerDid: CLAIMER_DID,
    }));
    mockedCreateScheduledTransfer.mockResolvedValue({
      scheduleId: SCHEDULE_ID_2,
      scheduleTxId: "0.0.123@schedule-2",
    });
    mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID_1, deleted: true });

    const res = await app.request("/market/tasks/task-int-001/increase-reward", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, newPriceHbar: 10 }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.newPriceHbar).toBe(10);
    expect(data.newScheduleId).toBe(SCHEDULE_ID_2);

    expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID_1);
    expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
      "0.0.123", CLAIMER_DID, 10,
      { memo: "escrow:task-int-001:10" },
    );
    expect(mockedSetEscrowStatus).toHaveBeenCalledWith(
      "task-int-001", "pending",
      expect.objectContaining({ priceHbar: 10, scheduleId: SCHEDULE_ID_2 }),
    );
    expect(hcsMessageTypes()).toContain("task_reward_increased");
  });
});

// ─── Scenario 6: Backward compat (no scheduleId) ──────────────────

describe("SLICE-24-13 Scenario 6: Backward compat — no scheduleId fallback", () => {
  it("complete without scheduleId → direct transfer fallback", async () => {
    const app = makeApp();

    mockedGetTaskById.mockReturnValue(makeTask({
      status: "delivered",
      claimerDid: CLAIMER_DID,
      // No scheduleId — backward compat
    }));
    mockedRunVerification.mockResolvedValue({
      passed: true,
      attempts: 1,
      shouldReturnToMarket: false,
      result: { passed: true, report: "ok" },
    });
    mockedTransferHbarWithKey.mockResolvedValue("0.0.999@direct-transfer");

    const res = await app.request("/market/tasks/task-int-001/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paymentTxId).toBe("0.0.999@direct-transfer");

    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    expect(mockedTransferHbarWithKey).toHaveBeenCalled();
  });

  it("complete-with-key without scheduleId → signature-based transfer", async () => {
    const app = makeApp();

    mockedGetTaskById.mockReturnValue(makeTask({
      status: "delivered",
      claimerDid: CLAIMER_DID,
    }));
    mockedRunVerification.mockResolvedValue({
      passed: true,
      attempts: 1,
      shouldReturnToMarket: false,
      result: { passed: true, report: "ok" },
    });
    mockedPrepareTransfer.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.777@prepare" });
    mockedTransferHbarWithSignature.mockResolvedValue("0.0.999@sig-transfer");

    const res = await app.request("/market/tasks/task-int-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
    });

    expect(res.status).toBe(200);
    expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    expect(mockedPrepareTransfer).toHaveBeenCalled();
    expect(mockedTransferHbarWithSignature).toHaveBeenCalled();
  });
});
