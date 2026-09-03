import { describe, it, expect } from "vitest";
import { redactHeaders, redactString, isRedacted } from "../../../src/agent-readiness/runtime/redact";

describe("SLICE-98-2: Credential redaction", () => {
  it("redacts Authorization header", () => {
    const result = redactHeaders({ authorization: "Bearer secret-token-123" });
    expect(result.authorization).toBe("[REDACTED]");
  });

  it("redacts Cookie header", () => {
    const result = redactHeaders({ cookie: "session=abc123" });
    expect(result.cookie).toBe("[REDACTED]");
  });

  it("redacts Set-Cookie header", () => {
    const result = redactHeaders({ "set-cookie": "token=xyz; HttpOnly" });
    expect(result["set-cookie"]).toBe("[REDACTED]");
  });

  it("redacts api-key variants", () => {
    const result = redactHeaders({
      "api-key": "key123",
      "x-api-key": "key456",
      "x-auth-token": "token789",
    });
    expect(result["api-key"]).toBe("[REDACTED]");
    expect(result["x-api-key"]).toBe("[REDACTED]");
    expect(result["x-auth-token"]).toBe("[REDACTED]");
  });

  it("redacts headers matching token/secret/password/key pattern", () => {
    const result = redactHeaders({
      "x-custom-token": "val1",
      "x-secret-field": "val2",
      "x-password": "val3",
      "x-my-key": "val4",
    });
    expect(result["x-custom-token"]).toBe("[REDACTED]");
    expect(result["x-secret-field"]).toBe("[REDACTED]");
    expect(result["x-password"]).toBe("[REDACTED]");
    expect(result["x-my-key"]).toBe("[REDACTED]");
  });

  it("preserves safe headers", () => {
    const result = redactHeaders({
      "content-type": "application/json",
      accept: "text/html",
      "user-agent": "AgentBadge/0.1",
      "x-ratelimit-limit": "100",
      "x-ratelimit-remaining": "50",
      "retry-after": "60",
      sunset: "Sat, 25 Dec 2025 00:00:00 GMT",
      deprecation: "true",
    });
    expect(result["content-type"]).toBe("application/json");
    expect(result.accept).toBe("text/html");
    expect(result["user-agent"]).toBe("AgentBadge/0.1");
    expect(result["x-ratelimit-limit"]).toBe("100");
    expect(result["x-ratelimit-remaining"]).toBe("50");
    expect(result["retry-after"]).toBe("60");
    expect(result.sunset).toBe("Sat, 25 Dec 2025 00:00:00 GMT");
    expect(result.deprecation).toBe("true");
  });

  it("redactString removes secrets from arbitrary text", () => {
    const text = "Got 401 with Authorization: Bearer my-secret-token and Cookie: session=xyz";
    const redacted = redactString(text);
    expect(redacted).not.toContain("my-secret-token");
    expect(redacted).not.toContain("session=xyz");
    expect(redacted).toContain("[REDACTED]");
  });

  it("isRedacted returns true for redacted value", () => {
    expect(isRedacted("[REDACTED]")).toBe(true);
    expect(isRedacted("Bearer token123")).toBe(false);
  });

  it("leak-proof: seeded fake token never appears in serialized output", () => {
    const FAKE_TOKEN = "AKIAIOSFODNN7EXAMPLE-super-secret-12345";
    const headers = redactHeaders({
      authorization: `Bearer ${FAKE_TOKEN}`,
      "x-api-key": FAKE_TOKEN,
      "content-type": "application/json",
    });
    const serialized = JSON.stringify(headers);
    expect(serialized).not.toContain(FAKE_TOKEN);
  });
});
