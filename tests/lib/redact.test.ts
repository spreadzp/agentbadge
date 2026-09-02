/**
 * SLICE-83-2: Secret redaction utility tests.
 *
 * Verifies that redactSecrets() strips private keys, bearer tokens,
 * Stripe tokens, and *PrivateKey* field names from payloads.
 */

import { describe, it, expect } from "vitest";
import { redactSecrets, redactString } from "../../src/server/lib/redact";

describe("SLICE-83-2: redactSecrets", () => {
  describe("redactString — pattern matching", () => {
    it("redacts Hedera ED25519 DER private keys (302e020100...)", () => {
      const input = '{"posterPrivateKey":"302e020100300506032b657004220420abcdef1234567890"}';
      const result = redactString(input);
      expect(result).not.toContain("302e020100300506032b657004220420abcdef1234567890");
      expect(result).toContain("[REDACTED]");
    });

    it("redacts Hedera ECDSA hex private keys (0x...)", () => {
      const input = '{"privateKey":"0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"}';
      const result = redactString(input);
      expect(result).not.toContain("0xabcdef0123456789");
      expect(result).toContain("[REDACTED]");
    });

    it("redacts Bearer token values", () => {
      const input = '{"authorization":"Bearer some-secret-jwt-token-12345"}';
      const result = redactString(input);
      expect(result).not.toContain("some-secret-jwt-token-12345");
      expect(result).toContain("[REDACTED]");
    });

    it("redacts Stripe token patterns (sk_live_...)", () => {
      const input = '{"stripeKey":"sk_live_abcdef1234567890"}';
      const result = redactString(input);
      expect(result).not.toContain("sk_live_abcdef1234567890");
      expect(result).toContain("[REDACTED]");
    });

    it("redacts *PrivateKey* field names in JSON", () => {
      const input = '{"posterPrivateKey":"some-value","claimerPrivateKey":"other-value"}';
      const result = redactString(input);
      expect(result).not.toContain("some-value");
      expect(result).not.toContain("other-value");
    });

    it("does NOT redact normal fields", () => {
      const input = '{"taskId":"task-123","priceHbar":10.5,"posterDid":"did:a2a:0.0.1234"}';
      const result = redactString(input);
      expect(result).toContain("task-123");
      expect(result).toContain("10.5");
      expect(result).toContain("did:a2a:0.0.1234");
    });
  });

  describe("redactSecrets — object payload", () => {
    it("redacts posterPrivateKey field from object", () => {
      const payload = {
        taskId: "task-123",
        posterPrivateKey: "302e020100300506032b6570secret",
        posterDid: "did:a2a:0.0.1234",
      };
      const result = redactSecrets(payload);
      expect(result.posterPrivateKey).toBe("[REDACTED]");
      expect(result.taskId).toBe("task-123");
      expect(result.posterDid).toBe("did:a2a:0.0.1234");
    });

    it("redacts claimerPrivateKey field from object", () => {
      const payload = { claimerPrivateKey: "0xsecret", taskId: "t1" };
      const result = redactSecrets(payload);
      expect(result.claimerPrivateKey).toBe("[REDACTED]");
      expect(result.taskId).toBe("t1");
    });

    it("redacts privateKey field from object", () => {
      const payload = { privateKey: "0xsecret", from: "did:a2a:0.0.1" };
      const result = redactSecrets(payload);
      expect(result.privateKey).toBe("[REDACTED]");
      expect(result.from).toBe("did:a2a:0.0.1");
    });

    it("redacts nested key fields", () => {
      const payload = {
        body: { posterPrivateKey: "secret-key-value" },
        method: "POST",
      };
      const result = redactSecrets(payload);
      expect((result.body as Record<string, unknown>).posterPrivateKey).toBe("[REDACTED]");
    });

    it("preserves non-key fields at all levels", () => {
      const payload = {
        method: "POST",
        path: "/market/tasks",
        status: 200,
        headers: { "content-type": "application/json" },
      };
      const result = redactSecrets(payload);
      expect(result).toEqual(payload);
    });
  });
});
