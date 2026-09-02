import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runVerification, logReputationPenalty, MAX_VERIFICATION_ATTEMPTS } from "../../src/verifiers/verification.service";
import { VerifierRegistry } from "../../src/verifiers/verifier.registry";
import { NoopVerifier } from "../../src/verifiers/noop.verifier";
import type { ITaskVerifier, VerificationResult } from "../../src/verifiers/verifier.interface";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

// Mock submitTaskMessage
vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
  return {
    ...actual,
    submitTaskMessage: vi.fn().mockResolvedValue({ txId: "0.0.999@1.1", consensusTimestamp: null }),
  };
});

const { submitTaskMessage } = await import("@agentbadge/hedera-core");

function makeTask(overrides: Partial<CachedMarketTask> = {}): CachedMarketTask {
  return {
    taskId: "task-123",
    posterDid: "did:hcs:0.0.1:1",
    title: "Test",
    description: "Test desc",
    priceHbar: 5,
    capabilities: ["api_call"],
    status: "delivered",
    txId: "0.0.2@1.1",
    consensusTimestamp: "1.1",
    createdAt: Date.now(),
    claimerDid: "did:hcs:0.0.1:2",
    ...overrides,
  } as CachedMarketTask;
}

describe("SLICE-24-6: runVerification", () => {
  let registry: VerifierRegistry;

  beforeEach(() => {
    registry = VerifierRegistry.getInstance();
    registry.register(new NoopVerifier());
    vi.mocked(submitTaskMessage).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MAX_VERIFICATION_ATTEMPTS is 3", () => {
    expect(MAX_VERIFICATION_ATTEMPTS).toBe(3);
  });

  it("passes on first attempt with noop verifier", async () => {
    const task = makeTask({ verificationAttempts: 0 });
    const outcome = await runVerification(task, "result body");

    expect(outcome.passed).toBe(true);
    expect(outcome.attempts).toBe(1);
    expect(outcome.shouldReturnToMarket).toBe(false);
  });

  it("fails on first attempt (attempts=1, no return to market)", async () => {
    const failingVerifier: ITaskVerifier = {
      type: "failing",
      async verify(): Promise<VerificationResult> {
        return { passed: false, report: "assertions failed", errors: ["err1"] };
      },
    };
    registry.register(failingVerifier);

    const task = makeTask({ verificationAttempts: 0, verifierType: "failing" });
    const outcome = await runVerification(task, "result body");

    expect(outcome.passed).toBe(false);
    expect(outcome.attempts).toBe(1);
    expect(outcome.shouldReturnToMarket).toBe(false);
  });

  it("fails on second attempt (attempts=2, no return to market)", async () => {
    const failingVerifier: ITaskVerifier = {
      type: "failing2",
      async verify(): Promise<VerificationResult> {
        return { passed: false, report: "still failing" };
      },
    };
    registry.register(failingVerifier);

    const task = makeTask({ verificationAttempts: 1, verifierType: "failing2" });
    const outcome = await runVerification(task, "result body");

    expect(outcome.passed).toBe(false);
    expect(outcome.attempts).toBe(2);
    expect(outcome.shouldReturnToMarket).toBe(false);
  });

  it("fails on third attempt (attempts=3, return to market + penalty logged)", async () => {
    const failingVerifier: ITaskVerifier = {
      type: "failing3",
      async verify(): Promise<VerificationResult> {
        return { passed: false, report: "max retries exceeded" };
      },
    };
    registry.register(failingVerifier);

    const task = makeTask({ verificationAttempts: 2, verifierType: "failing3", claimerDid: "did:hcs:0.0.1:5" });
    const outcome = await runVerification(task, "result body");

    expect(outcome.passed).toBe(false);
    expect(outcome.attempts).toBe(3);
    expect(outcome.shouldReturnToMarket).toBe(true);
    expect(submitTaskMessage).toHaveBeenCalledTimes(1);
  });

  it("does not log penalty when claimerDid is missing", async () => {
    const failingVerifier: ITaskVerifier = {
      type: "failing4",
      async verify(): Promise<VerificationResult> {
        return { passed: false, report: "fail" };
      },
    };
    registry.register(failingVerifier);

    const task = makeTask({ verificationAttempts: 2, verifierType: "failing4", claimerDid: undefined });
    const outcome = await runVerification(task, "result body");

    expect(outcome.shouldReturnToMarket).toBe(true);
    expect(submitTaskMessage).not.toHaveBeenCalled();
  });
});

describe("SLICE-24-6: logReputationPenalty", () => {
  beforeEach(() => {
    vi.mocked(submitTaskMessage).mockClear();
    vi.mocked(submitTaskMessage).mockResolvedValue({ txId: "0.0.999@1.1", consensusTimestamp: null });
  });

  it("submits HCS message with correct format", async () => {
    const txId = await logReputationPenalty("did:hcs:0.0.1:5", "task-999", "verification failed");

    expect(submitTaskMessage).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(submitTaskMessage).mock.calls[0][0];
    expect(msg.type).toBe("task_verification_failed");
    expect(msg.taskId).toBe("task-999");
    expect((msg as any).claimerDid).toBe("did:hcs:0.0.1:5");
    expect((msg as any).report).toBe("verification failed");
    expect((msg as any).timestamp).toBeGreaterThan(0);
    expect(txId).toBe("0.0.999@1.1");
  });
});
