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
  };
});

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  marketUpsert: vi.fn(),
  marketGet: vi.fn(),
  getTaskById: vi.fn(),
  updateTaskStatus: vi.fn(),
  listTasks: vi.fn(),
  marketClear: vi.fn(),
  marketRebuildFromHcs: vi.fn(),
}));

import {
  submitTaskMessage,
  verifyA2ADid,
  prepareTransferTransaction,
  transferHbarWithSignature,
  didToAccountId,
  prepareTopicMessageTransaction,
  submitSignedTopicMessage,
  signTransactionBytes,
} from "@agentgate-hedera/hedera-core";
import {
  marketUpsert as upsert,
  marketGet as get,
  getTaskById,
  updateTaskStatus,
} from "@agentgate-hedera/passport";
import { marketRoutes } from "../src/server/routes/market";

const mockedVerify = vi.mocked(verifyA2ADid);
const mockedDidToAccountId = vi.mocked(didToAccountId);
const mockedPrepareTopic = vi.mocked(prepareTopicMessageTransaction);
const mockedSubmitSigned = vi.mocked(submitSignedTopicMessage);
const mockedSignTxBytes = vi.mocked(signTransactionBytes);
const mockedGetTaskById = vi.mocked(getTaskById);
const mockedUpdateTaskStatus = vi.mocked(updateTaskStatus);
const mockedUpsert = vi.mocked(upsert);

const POSTER_DID = "did:hcs:0.0.123:1";
const CLAIMER_DID = "did:hcs:0.0.456:2";
const POSTER_PK = PrivateKey.generateED25519().toStringDer();
const CLAIMER_PK = PrivateKey.generateED25519().toStringDer();

const FAKE_TX_BYTES = Buffer.from("fake-tx-bytes").toString("base64");
const FAKE_SIGNATURE = JSON.stringify(["fake-sig-base64"]);
const FAKE_PUBLIC_KEY = "fake-public-key-der";

function makeApp(): Hono {
  return marketRoutes;
}

function mockPostedTask() {
  return {
    taskId: "task-signed-001",
    posterDid: POSTER_DID,
    title: "Signed Lifecycle Task",
    description: "Test full signed lifecycle",
    priceHbar: 5,
    capabilities: ["data_analysis"],
    status: "posted" as const,
    txId: "0.0.111@posted-tx",
    consensusTimestamp: "2026-01-01T00:00:00Z",
    createdAt: 1000000,
  };
}

function mockClaimedTask() {
  return {
    ...mockPostedTask(),
    status: "claimed" as const,
    claimerDid: CLAIMER_DID,
    claimTxId: "0.0.456@claim-tx",
  };
}

function mockDeliveredTask() {
  return {
    ...mockClaimedTask(),
    status: "delivered" as const,
    deliverTxId: "0.0.456@deliver-tx",
    resultBody: "analysis complete",
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
  mockedPrepareTopic.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.999@prepare" });
  mockedSubmitSigned.mockResolvedValue({ txId: "0.0.999@signed-submit", consensusTimestamp: null });
  mockedSignTxBytes.mockReturnValue({ signature: FAKE_SIGNATURE, publicKey: FAKE_PUBLIC_KEY });
  mockedUpsert.mockReturnValue({} as any);
});

describe("SLICE-15-6: Full signed lifecycle (post → claim → deliver → complete)", () => {
  it("posts a task with agent-signed HCS message", async () => {
    const app = makeApp();
    const res = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        title: "Signed Lifecycle Task",
        description: "Test full signed lifecycle",
        priceHbar: 5,
        capabilities: ["data_analysis"],
        posterPrivateKey: POSTER_PK,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.txId).toBeDefined();
    expect(data.taskId).toBeDefined();
    expect(data.timestamp).toBeDefined();

    expect(mockedPrepareTopic).toHaveBeenCalledWith("0.0.123", expect.objectContaining({
      type: "task_posted",
      posterDid: POSTER_DID,
    }));
    expect(mockedSignTxBytes).toHaveBeenCalledWith(FAKE_TX_BYTES, POSTER_PK);
    expect(mockedSubmitSigned).toHaveBeenCalledWith(FAKE_TX_BYTES, FAKE_PUBLIC_KEY, expect.any(Array));
  });

  it("claims a task with agent-signed HCS message", async () => {
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-signed-001/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        claimerPrivateKey: CLAIMER_PK,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.txId).toBeDefined();
    expect(data.taskId).toBe("task-signed-001");

    expect(mockedPrepareTopic).toHaveBeenCalledWith("0.0.456", expect.objectContaining({
      type: "task_claimed",
      taskId: "task-signed-001",
      claimerDid: CLAIMER_DID,
    }));
    expect(mockedSignTxBytes).toHaveBeenCalledWith(FAKE_TX_BYTES, CLAIMER_PK);
    expect(mockedSubmitSigned).toHaveBeenCalled();

    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-signed-001",
      "claimed",
      expect.objectContaining({ claimerDid: CLAIMER_DID, claimTxId: data.txId }),
    );
  });

  it("delivers results with agent-signed HCS message", async () => {
    mockedGetTaskById.mockReturnValue(mockClaimedTask() as any);

    const app = makeApp();
    const res = await app.request("/market/tasks/task-signed-001/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        resultBody: "analysis complete",
        claimerPrivateKey: CLAIMER_PK,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.txId).toBeDefined();

    expect(mockedPrepareTopic).toHaveBeenCalledWith("0.0.456", expect.objectContaining({
      type: "task_delivered",
      taskId: "task-signed-001",
      claimerDid: CLAIMER_DID,
      resultBody: "analysis complete",
    }));
    expect(mockedSignTxBytes).toHaveBeenCalledWith(FAKE_TX_BYTES, CLAIMER_PK);
    expect(mockedSubmitSigned).toHaveBeenCalled();

    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-signed-001",
      "delivered",
      expect.objectContaining({ deliverTxId: data.txId }),
    );
  });

  it("completes a task with agent-signed HCS message (poster pays with key)", async () => {
    const deliveredTask = mockDeliveredTask();
    mockedGetTaskById.mockReturnValue(deliveredTask as any);
    vi.mocked(prepareTransferTransaction).mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.111@prepare" });
    vi.mocked(transferHbarWithSignature).mockResolvedValue("0.0.111@payment-tx");
    vi.mocked(submitTaskMessage).mockResolvedValue({ txId: "0.0.111@complete-tx", consensusTimestamp: null });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-signed-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        posterPrivateKey: POSTER_PK,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.paymentTxId).toBe("0.0.111@payment-tx");
    expect(data.completedAt).toBeDefined();

    expect(vi.mocked(prepareTransferTransaction)).toHaveBeenCalledWith("0.0.123", "0.0.456", 5);
    expect(vi.mocked(transferHbarWithSignature)).toHaveBeenCalled();
    expect(vi.mocked(submitTaskMessage)).toHaveBeenCalledWith(expect.objectContaining({
      type: "task_completed",
      taskId: "task-signed-001",
    }));
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-signed-001",
      "completed",
      expect.objectContaining({ paymentTxId: "0.0.111@payment-tx" }),
    );
  });
});

describe("SLICE-15-6: All 4 txIds stored in cache after signed lifecycle", () => {
  it("verifies post, claim, deliver, and complete txIds are all cached", async () => {
    // Step 1: Post
    mockedPrepareTopic.mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.123@post-tx" });
    mockedSubmitSigned.mockResolvedValue({ txId: "0.0.123@post-tx", consensusTimestamp: null });

    const app = makeApp();
    const postRes = await app.request("/market/tasks/signed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        title: "TxId Cache Test",
        description: "Verify all 4 txIds cached",
        priceHbar: 3,
        capabilities: ["api_call"],
        posterPrivateKey: POSTER_PK,
      }),
    });
    const postData = await postRes.json();
    expect(postData.txId).toBe("0.0.123@post-tx");
    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      txId: "0.0.123@post-tx",
      posterDid: POSTER_DID,
    }));

    // Step 2: Claim
    mockedGetTaskById.mockReturnValue(mockPostedTask() as any);
    mockedSubmitSigned.mockResolvedValue({ txId: "0.0.456@claim-tx", consensusTimestamp: null });

    const claimRes = await app.request("/market/tasks/task-signed-001/claim-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        claimerPrivateKey: CLAIMER_PK,
      }),
    });
    const claimData = await claimRes.json();
    expect(claimData.txId).toBe("0.0.456@claim-tx");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-signed-001",
      "claimed",
      expect.objectContaining({ claimTxId: "0.0.456@claim-tx" }),
    );

    // Step 3: Deliver
    mockedGetTaskById.mockReturnValue(mockClaimedTask() as any);
    mockedSubmitSigned.mockResolvedValue({ txId: "0.0.456@deliver-tx", consensusTimestamp: null });

    const deliverRes = await app.request("/market/tasks/task-signed-001/deliver-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimerDid: CLAIMER_DID,
        resultBody: "done",
        claimerPrivateKey: CLAIMER_PK,
      }),
    });
    const deliverData = await deliverRes.json();
    expect(deliverData.txId).toBe("0.0.456@deliver-tx");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-signed-001",
      "delivered",
      expect.objectContaining({ deliverTxId: "0.0.456@deliver-tx" }),
    );

    // Step 4: Complete
    mockedGetTaskById.mockReturnValue(mockDeliveredTask() as any);
    vi.mocked(prepareTransferTransaction).mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.123@prepare" });
    vi.mocked(transferHbarWithSignature).mockResolvedValue("0.0.123@payment-tx");
    vi.mocked(submitTaskMessage).mockResolvedValue({ txId: "0.0.123@complete-tx", consensusTimestamp: null });

    const completeRes = await app.request("/market/tasks/task-signed-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        posterPrivateKey: POSTER_PK,
      }),
    });
    const completeData = await completeRes.json();
    expect(completeData.paymentTxId).toBe("0.0.123@payment-tx");
    expect(mockedUpdateTaskStatus).toHaveBeenCalledWith(
      "task-signed-001",
      "completed",
      expect.objectContaining({ paymentTxId: "0.0.123@payment-tx" }),
    );

    // Verify all 4 txIds were cached via updateTaskStatus calls
    const updateCalls = mockedUpdateTaskStatus.mock.calls;
    expect(updateCalls).toHaveLength(3); // claim, deliver, complete (post uses upsert)

    // Post txId cached via upsert
    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({
      txId: "0.0.123@post-tx",
    }));

    // Claim txId cached
    expect(updateCalls[0][2]).toHaveProperty("claimTxId", "0.0.456@claim-tx");

    // Deliver txId cached
    expect(updateCalls[1][2]).toHaveProperty("deliverTxId", "0.0.456@deliver-tx");

    // Complete paymentTxId cached
    expect(updateCalls[2][2]).toHaveProperty("paymentTxId", "0.0.123@payment-tx");
  });
});

describe("SLICE-15-6: HBAR transfer amount correctness", () => {
  it("transfers exact task priceHbar from poster to claimer on complete", async () => {
    const task = { ...mockDeliveredTask(), priceHbar: 7.5 };
    mockedGetTaskById.mockReturnValue(task as any);
    vi.mocked(prepareTransferTransaction).mockResolvedValue({ txBytes: FAKE_TX_BYTES, txId: "0.0.111@prepare" });
    vi.mocked(transferHbarWithSignature).mockResolvedValue("0.0.111@payment-7.5");
    vi.mocked(submitTaskMessage).mockResolvedValue({ txId: "0.0.111@complete-tx", consensusTimestamp: null });

    const app = makeApp();
    const res = await app.request("/market/tasks/task-signed-001/complete-with-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        posterDid: POSTER_DID,
        posterPrivateKey: POSTER_PK,
      }),
    });

    expect(res.status).toBe(200);
    expect(vi.mocked(prepareTransferTransaction)).toHaveBeenCalledWith("0.0.123", "0.0.456", 7.5);
  });
});
