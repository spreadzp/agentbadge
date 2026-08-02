import { describe, it, expect, beforeEach } from "vitest";
import { VerifierRegistry } from "../../src/verifiers/verifier.registry";
import { NoopVerifier } from "../../src/verifiers/noop.verifier";
import type { ITaskVerifier, VerificationResult } from "../../src/verifiers/verifier.interface";

describe("SLICE-24-4: VerifierRegistry", () => {
  let registry: VerifierRegistry;

  beforeEach(() => {
    registry = VerifierRegistry.getInstance();
    registry.register(new NoopVerifier());
  });

  it("getInstance returns the same singleton instance", () => {
    const a = VerifierRegistry.getInstance();
    const b = VerifierRegistry.getInstance();
    expect(a).toBe(b);
  });

  it("register adds a verifier by type", () => {
    const custom: ITaskVerifier = {
      type: "custom-test",
      async verify(): Promise<VerificationResult> {
        return { passed: true, report: "custom" };
      },
    };
    registry.register(custom);
    expect(registry.get("custom-test")).toBe(custom);
  });

  it("get('noop') returns NoopVerifier", () => {
    const v = registry.get("noop");
    expect(v).toBeInstanceOf(NoopVerifier);
  });

  it("getOrDefault('unknown') returns NoopVerifier as fallback", () => {
    const v = registry.getOrDefault("unknown-type");
    expect(v).toBeInstanceOf(NoopVerifier);
  });

  it("getOrDefault('noop') returns NoopVerifier", () => {
    const v = registry.getOrDefault("noop");
    expect(v).toBeInstanceOf(NoopVerifier);
  });

  it("get returns undefined for unregistered type", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("list returns registered types including noop", () => {
    const types = registry.list();
    expect(types).toContain("noop");
  });
});

describe("SLICE-24-4: NoopVerifier", () => {
  it("has type 'noop'", () => {
    const v = new NoopVerifier();
    expect(v.type).toBe("noop");
  });

  it("verify() always returns { passed: true }", async () => {
    const v = new NoopVerifier();
    const result = await v.verify({} as any);
    expect(result.passed).toBe(true);
  });

  it("verify() returns a non-empty report string", async () => {
    const v = new NoopVerifier();
    const result = await v.verify({} as any);
    expect(result.report).toBeTruthy();
    expect(result.report.length).toBeGreaterThan(0);
  });

  it("verify() does not include errors on success", async () => {
    const v = new NoopVerifier();
    const result = await v.verify({} as any);
    expect(result.errors).toBeUndefined();
  });
});
