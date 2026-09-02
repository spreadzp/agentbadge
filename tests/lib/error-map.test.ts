/**
 * SLICE-83-4: Error mapper tests.
 *
 * Verifies that toPublicError maps known error patterns to safe codes/messages
 * and never leaks upstream exception details (account IDs, SDK traces, endpoints).
 */

import { describe, it, expect } from "vitest";
import { toPublicError } from "../../src/server/lib/error-map";

describe("SLICE-83-4: toPublicError", () => {
  it("maps HCS submission errors to HCS_SUBMISSION_FAILED", () => {
    const err = new Error("HCS topic submission failed: 0.0.1234 timeout");
    const result = toPublicError(err);
    expect(result.code).toBe("HCS_SUBMISSION_FAILED");
    expect(result.safeMessage).not.toContain("0.0.1234");
  });

  it("maps mirror node errors to MIRROR_NODE_UNAVAILABLE", () => {
    const err = new Error("Mirror node query failed for account 0.0.5678");
    const result = toPublicError(err);
    expect(result.code).toBe("MIRROR_NODE_UNAVAILABLE");
    expect(result.safeMessage).not.toContain("0.0.5678");
  });

  it("maps signature verification errors to VERIFICATION_FAILED", () => {
    const err = new Error("Signature verification failed for tx 0xabc123");
    const result = toPublicError(err);
    expect(result.code).toBe("VERIFICATION_FAILED");
    expect(result.safeMessage).not.toContain("0xabc123");
  });

  it("maps invalid input errors to INVALID_INPUT", () => {
    const err = new Error("Invalid input: accountId format wrong");
    const result = toPublicError(err);
    expect(result.code).toBe("INVALID_INPUT");
  });

  it("maps rate limit errors to RATE_LIMITED", () => {
    const err = new Error("Rate limit exceeded for client 192.168.1.1");
    const result = toPublicError(err);
    expect(result.code).toBe("RATE_LIMITED");
    expect(result.safeMessage).not.toContain("192.168.1.1");
  });

  it("maps unknown errors to INTERNAL_ERROR with generic message", () => {
    const err = new Error("Some internal SDK trace with account 0.0.9999 and endpoint https://internal.svc:8080");
    const result = toPublicError(err);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.safeMessage).not.toContain("0.0.9999");
    expect(result.safeMessage).not.toContain("https://internal.svc");
    expect(result.safeMessage).not.toContain("Some internal SDK trace");
  });

  it("never leaks account IDs (0.0.X format) in safeMessage", () => {
    const err = new Error("Failed at 0.0.1234 with 0.0.5678 and 0.0.99999");
    const result = toPublicError(err);
    expect(result.safeMessage).not.toMatch(/0\.0\.\d+/);
  });

  it("never leaks hex strings (0x...) in safeMessage", () => {
    const err = new Error("Transaction 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890 failed");
    const result = toPublicError(err);
    expect(result.safeMessage).not.toContain("0xabcdef");
  });

  it("never leaks URLs in safeMessage", () => {
    const err = new Error("Fetch to https://internal-api.svc.local:9090/v1/secret failed");
    const result = toPublicError(err);
    expect(result.safeMessage).not.toContain("https://internal-api");
  });

  it("handles non-Error throwables", () => {
    const result = toPublicError("some string error");
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.safeMessage).not.toContain("some string error");
  });

  it("handles null/undefined", () => {
    const result = toPublicError(null);
    expect(result.code).toBe("INTERNAL_ERROR");
  });
});
