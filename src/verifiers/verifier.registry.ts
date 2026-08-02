import type { ITaskVerifier } from "./verifier.interface";
import { NoopVerifier } from "./noop.verifier";

export class VerifierRegistry {
  private static instance: VerifierRegistry;
  private verifiers = new Map<string, ITaskVerifier>();

  private constructor() {}

  static getInstance(): VerifierRegistry {
    if (!VerifierRegistry.instance) {
      VerifierRegistry.instance = new VerifierRegistry();
    }
    return VerifierRegistry.instance;
  }

  register(verifier: ITaskVerifier): void {
    this.verifiers.set(verifier.type, verifier);
  }

  get(type: string): ITaskVerifier | undefined {
    return this.verifiers.get(type);
  }

  getOrDefault(type: string): ITaskVerifier {
    return this.verifiers.get(type) ?? new NoopVerifier();
  }

  list(): string[] {
    return Array.from(this.verifiers.keys());
  }
}
