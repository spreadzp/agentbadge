import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
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
const SCHEDULE_ID = "0.0.50001";
const SCHEDULE_TX_ID = "0.0.123@schedule-tx";

const E2E_TIMEOUT = 10000;

function makeApp(): Hono {
  return marketRoutes;
}

function hcsMessageTypes(): string[] {
  return mockedSubmitTaskMessage.mock.calls.map((c) => (c[0] as any).type);
}

function makeMedicalTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-med-001",
    posterDid: POSTER_DID,
    title: "Pima Diabetes Correlation Analysis",
    description: "Analyze Pima Diabetes dataset for correlation between BMI, Glucose, and Hypertension",
    priceHbar: 5,
    capabilities: ["data_analysis"],
    status: "posted" as const,
    txId: "0.0.111@posted-tx",
    consensusTimestamp: "2026-01-01T00:00:00Z",
    createdAt: 1000000,
    ...overrides,
  } as any;
}

const MEDICAL_RESULT_HTML = `
<html><body>
<h1>Pima Diabetes Correlation Analysis</h1>
<p>Key findings: Strong correlation between BMI and Hypertension.</p>
<p>Glucose levels above 140mg/dL correlate with Hypertension risk.</p>
<p>BMI > 30 significantly increases diabetes probability.</p>
</body></html>
`;

const MEDICAL_RESULT_MISSING_TERMS = `
<html><body>
<h1>Analysis Report</h1>
<p>Some findings about the dataset.</p>
</body></html>
`;

beforeAll(() => {
  vi.stubEnv("MOCK_HEDERA", "true");
  vi.stubEnv("DATAHUB_ENABLED", "true");
  vi.stubEnv("HEDERA_OPERATOR_ID", "0.0.5266613");
  vi.stubEnv("HEDERA_OPERATOR_KEY",
    "302e020100300506032b6570042204207a1808c14f6e11817bc7c1b3ab9aa86bef1883e7da58046f8ab84021c30bfce7");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

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
    scheduleId: SCHEDULE_ID,
    scheduleTxId: SCHEDULE_TX_ID,
  });
  mockedSignScheduledTransaction.mockResolvedValue({ txId: "0.0.999@schedule-sign", executed: true });
  mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID, deleted: true });
  mockedPrepareTransfer.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.777@prepare" });
  mockedSignTxBytes.mockReturnValue({ signature: FAKE_SIGNATURE, publicKey: FAKE_PUBLIC_KEY });
  mockedTransferHbarWithSignature.mockResolvedValue("0.0.999@transfer");
  mockedTransferHbarWithKey.mockResolvedValue("0.0.999@transfer-key");
  mockedUpdateTaskStatus.mockReturnValue(true);
  mockedSetEscrowStatus.mockReturnValue(true);
  mockedReturnTaskToMarket.mockReturnValue(true);
  mockedUpdateTaskVerificationAttempts.mockReturnValue(true);
});

// ═══════════════════════════════════════════════════════════════════
// Flow A: Successful medical task with escrow + DataHub verification
// ═══════════════════════════════════════════════════════════════════

describe("SLICE-24-14 Flow A: Successful medical task — full lifecycle", () => {
  it(
    "post → claim (escrow) → deliver (HTML+glossary) → complete (DataHub verify + release)",
    async () => {
      const app = makeApp();

      // ── Step 1: Agent claims task → escrow created ──
      mockedGetTaskById.mockReturnValue(makeMedicalTask({ status: "posted" }));

      const claimRes = await app.request("/market/tasks/task-med-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });

      expect(claimRes.status).toBe(200);
      const claimData = await claimRes.json();
      expect(claimData.scheduleId).toBe(SCHEDULE_ID);
      expect(mockedCreateScheduledTransfer).toHaveBeenCalledWith(
        "0.0.123", "0.0.456", 5,
        { memo: "escrow:task-med-001:did:hcs:0.0.456:2" },
      );
      expect(mockedSetEscrowStatus).toHaveBeenCalledWith(
        "task-med-001", "pending",
        { scheduleId: SCHEDULE_ID, scheduleTxId: SCHEDULE_TX_ID },
      );
      expect(hcsMessageTypes()).toContain("task_escrow_created");

      // ── Step 2: Agent delivers result with glossary terms ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "claimed",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        escrowStatus: "pending",
      }));
      mockedVerify.mockResolvedValue(true);
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@deliver-tx", consensusTimestamp: null });

      const deliverRes = await app.request("/market/tasks/task-med-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimerDid: CLAIMER_DID,
          resultBody: MEDICAL_RESULT_HTML,
        }),
      });

      expect(deliverRes.status).toBe(200);
      expect(hcsMessageTypes()).toContain("task_delivered");

      // ── Step 3: Poster completes → DataHub verification passes → escrow released ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "delivered",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        escrowStatus: "pending",
        resultBody: MEDICAL_RESULT_HTML,
      }));
      mockedVerify.mockResolvedValue(true);
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@hcs-tx", consensusTimestamp: null });
      // DataHub verifier: assertions pass, glossary terms found (Hypertension, BMI, Glucose)
      mockedRunVerification.mockResolvedValue({
        passed: true,
        attempts: 1,
        shouldReturnToMarket: false,
        result: {
          passed: true,
          report: "DataHub verification passed: all assertions verified, glossary terms present (Hypertension, BMI, Glucose)",
        },
      });
      mockedSignScheduledTransaction.mockResolvedValue({ txId: "0.0.999@schedule-sign", executed: true });

      const completeRes = await app.request("/market/tasks/task-med-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
      });

      expect(completeRes.status).toBe(200);
      const completeData = await completeRes.json();
      expect(completeData.paymentTxId).toBe("0.0.999@schedule-sign");

      // Verify escrow released
      expect(mockedSignScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID, POSTER_PK);
      expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-med-001", "released");
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
        "task-med-001", "completed",
        expect.objectContaining({ paymentTxId: "0.0.999@schedule-sign" }),
      );

      // Verify HCS audit trail
      expect(hcsMessageTypes()).toContain("task_completed");
    },
    E2E_TIMEOUT,
  );
});

// ═══════════════════════════════════════════════════════════════════
// Flow B: Failed verification 3x → return to market
// ═══════════════════════════════════════════════════════════════════

describe("SLICE-24-14 Flow B: Verification fails 3x → task returned to marketplace", () => {
  it(
    "claim → deliver (missing glossary) → complete×3 (fail) → escrow cancelled, task returned",
    async () => {
      const app = makeApp();

      // ── Step 1: Claim ──
      mockedGetTaskById.mockReturnValue(makeMedicalTask({ status: "posted" }));
      const claimRes = await app.request("/market/tasks/task-med-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });
      expect(claimRes.status).toBe(200);

      // ── Step 2: Deliver result WITHOUT required glossary terms ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "claimed",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        escrowStatus: "pending",
      }));
      mockedVerify.mockResolvedValue(true);
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@deliver-tx", consensusTimestamp: null });

      const deliverRes = await app.request("/market/tasks/task-med-001/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimerDid: CLAIMER_DID,
          resultBody: MEDICAL_RESULT_MISSING_TERMS,
        }),
      });
      expect(deliverRes.status).toBe(200);

      // ── Step 3: Complete attempt 1 → DataHub fails (missing glossary terms) ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "delivered",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        verificationAttempts: 0,
        resultBody: MEDICAL_RESULT_MISSING_TERMS,
      }));
      mockedVerify.mockResolvedValue(true);
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@hcs-tx", consensusTimestamp: null });
      mockedRunVerification.mockResolvedValue({
        passed: false,
        attempts: 1,
        shouldReturnToMarket: false,
        result: {
          passed: false,
          report: "DataHub verification failed: missing glossary terms (Hypertension, BMI, Glucose)",
        },
      });

      const fail1 = await app.request("/market/tasks/task-med-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
      });
      expect(fail1.status).toBe(422);
      expect(mockedUpdateTaskVerificationAttempts).toHaveBeenCalledWith("task-med-001", 1);
      expect(mockedReturnTaskToMarket).not.toHaveBeenCalled();
      expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();

      // ── Step 4: Complete attempt 2 → still fails ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "delivered",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        verificationAttempts: 1,
        resultBody: MEDICAL_RESULT_MISSING_TERMS,
      }));
      mockedVerify.mockResolvedValue(true);
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@hcs-tx", consensusTimestamp: null });
      mockedRunVerification.mockResolvedValue({
        passed: false,
        attempts: 2,
        shouldReturnToMarket: false,
        result: { passed: false, report: "Still missing glossary terms" },
      });

      const fail2 = await app.request("/market/tasks/task-med-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
      });
      expect(fail2.status).toBe(422);
      expect(mockedReturnTaskToMarket).not.toHaveBeenCalled();

      // ── Step 5: Complete attempt 3 → fails, escrow cancelled, task returned ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "delivered",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        verificationAttempts: 2,
        resultBody: MEDICAL_RESULT_MISSING_TERMS,
      }));
      mockedVerify.mockResolvedValue(true);
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@hcs-tx", consensusTimestamp: null });
      mockedRunVerification.mockResolvedValue({
        passed: false,
        attempts: 3,
        shouldReturnToMarket: true,
        result: { passed: false, report: "Max attempts reached, missing glossary terms" },
      });
      mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID, deleted: true });

      const fail3 = await app.request("/market/tasks/task-med-001/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID, posterPrivateKey: POSTER_PK }),
      });

      expect(fail3.status).toBe(422);
      const fail3Data = await fail3.json();
      expect(fail3Data.error).toContain("returned to marketplace");

      // Escrow cancelled
      expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID);
      expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-med-001", "cancelled");
      expect(mockedReturnTaskToMarket).toHaveBeenCalledWith("task-med-001");
      expect(mockedSignScheduledTransaction).not.toHaveBeenCalled();
    },
    E2E_TIMEOUT,
  );
});

// ═══════════════════════════════════════════════════════════════════
// Flow C: Cancel by poster — escrow cancelled, HBAR returned
// ═══════════════════════════════════════════════════════════════════

describe("SLICE-24-14 Flow C: Cancel by poster — escrow cancelled, HBAR returned", () => {
  it(
    "post → claim → cancel (escrow cancelled, HBAR returned)",
    async () => {
      const app = makeApp();

      // ── Step 1: Claim ──
      mockedGetTaskById.mockReturnValue(makeMedicalTask({ status: "posted" }));
      const claimRes = await app.request("/market/tasks/task-med-001/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimerDid: CLAIMER_DID }),
      });
      expect(claimRes.status).toBe(200);

      // ── Step 2: Poster cancels claimed task ──
      vi.clearAllMocks();
      mockedGetTaskById.mockReturnValue(makeMedicalTask({
        status: "claimed",
        scheduleId: SCHEDULE_ID,
        claimerDid: CLAIMER_DID,
        priceHbar: 5,
      }));
      mockedDeleteScheduledTransaction.mockResolvedValue({ scheduleId: SCHEDULE_ID, deleted: true });
      mockedSubmitTaskMessage.mockResolvedValue({ txId: "0.0.999@cancel-tx", consensusTimestamp: null });

      const cancelRes = await app.request("/market/tasks/task-med-001/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posterDid: POSTER_DID }),
      });

      expect(cancelRes.status).toBe(200);
      const cancelData = await cancelRes.json();
      expect(cancelData.hbarReturned).toBe(5);

      // Escrow cancelled
      expect(mockedDeleteScheduledTransaction).toHaveBeenCalledWith(SCHEDULE_ID);
      expect(mockedSetEscrowStatus).toHaveBeenCalledWith("task-med-001", "cancelled");
      expect(mockedUpdateTaskStatus).toHaveBeenCalledWith("task-med-001", "cancelled");

      // HCS audit trail
      expect(hcsMessageTypes()).toContain("task_cancelled");
    },
    E2E_TIMEOUT,
  );
});
