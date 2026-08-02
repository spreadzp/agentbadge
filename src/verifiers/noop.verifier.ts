import type { ITaskVerifier, VerificationResult } from "./verifier.interface";

export class NoopVerifier implements ITaskVerifier {
  readonly type = "noop";

  async verify(_task?: any, _resultBody?: string, _resultIpfs?: string): Promise<VerificationResult> {
    return { passed: true, report: "No verification required (noop verifier)" };
  }
}
