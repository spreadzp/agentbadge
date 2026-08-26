import type { CachedMarketTask, TaskVerificationFailedMessage } from "@agentgate-hedera/hedera-core";
import { submitTaskMessage } from "@agentgate-hedera/hedera-core";
import { VerifierRegistry } from "./verifier.registry";
import type { VerificationResult } from "./verifier.interface";

export const MAX_VERIFICATION_ATTEMPTS = 3;

export interface VerificationOutcome {
  passed: boolean;
  attempts: number;
  shouldReturnToMarket: boolean;
  result: VerificationResult;
}

export async function runVerification(
  task: CachedMarketTask,
  resultBody?: string,
  resultIpfs?: string,
): Promise<VerificationOutcome> {
  const registry = VerifierRegistry.getInstance();
  const verifier = registry.getOrDefault(task.verifierType ?? "noop");

  const result = await verifier.verify(task, resultBody, resultIpfs);
  const attempts = (task.verificationAttempts ?? 0) + 1;

  if (result.passed) {
    return { passed: true, attempts, shouldReturnToMarket: false, result };
  }

  if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
    if (task.claimerDid) {
      await logReputationPenalty(task.claimerDid, task.taskId, result.report);
    }
    return { passed: false, attempts, shouldReturnToMarket: true, result };
  }

  return { passed: false, attempts, shouldReturnToMarket: false, result };
}

export async function logReputationPenalty(
  claimerDid: string,
  taskId: string,
  report: string,
): Promise<string> {
  const message: TaskVerificationFailedMessage = {
    type: "task_verification_failed",
    taskId,
    claimerDid,
    report,
    timestamp: Date.now(),
  };
  return (await submitTaskMessage(message)).txId;
}
