import type { CachedMarketTask } from "@agentbadge/hedera-core";

export interface VerificationResult {
  passed: boolean;
  report: string;
  errors?: string[];
}

export interface ITaskVerifier {
  readonly type: string;
  verify(task: CachedMarketTask, resultBody?: string, resultIpfs?: string): Promise<VerificationResult>;
}
