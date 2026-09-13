import { describe, it, expect } from "vitest";
import { extractAuth } from "../../../../src/agent-readiness/profile/extractors/auth-extractor";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";

/**
 * SLICE-101-4: Auth Extractor tests.
 */

function makeAssertion(overrides: Partial<Assertion> & { rule_id: string; category: string; status: Assertion["status"]; evidence?: Evidence[] }): Assertion {
  return {
    rule_id: overrides.rule_id,
    rule_version: "2.4.0",
    status: overrides.status,
    evidence: overrides.evidence ?? [],
    confidence: overrides.confidence ?? 0.9,
    timestamp: overrides.timestamp ?? "2026-09-01T10:00:00Z",
    source_url: overrides.source_url ?? null,
    reason: overrides.reason ?? "ok",
    category: overrides.category,
    name: overrides.name ?? overrides.rule_id,
    claim: overrides.claim ?? "claim",
    verified_at: overrides.verified_at ?? "2026-09-01T10:00:00Z",
    review_level: "automatic",
  };
}

function makeEvidence(url: string, detail?: string): Evidence {
  return {
    type: "http",
    url,
    status: 200,
    headers: {},
    content_hash: "x",
    content_type: "application/json",
    resolved_ip: null,
    source_class: "machine_readable_spec",
    semantic_detail: detail,
  } as Evidence;
}

describe("SLICE-101-4: extractAuth — methods", () => {
  it("detects oauth2 from oauth-protected-resource URL", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-060",
        category: "bot_auth",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/.well-known/oauth-protected-resource")],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth).toBeDefined();
    expect(auth!.data.methods).toContainEqual(expect.objectContaining({ type: "oauth2" }));
  });

  it("detects oauth2 with client_credentials flow from detail", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-060",
        category: "bot_auth",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/auth", JSON.stringify({ oauth2: true, flows: ["client_credentials"] }))],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.data.methods).toContainEqual(expect.objectContaining({ type: "oauth2", flows: ["client_credentials"] }));
  });

  it("detects api_key from detail", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-061",
        category: "bot_auth",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com", JSON.stringify({ api_key: true, header: "x-api-key" }))],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.data.methods).toContainEqual(expect.objectContaining({ type: "api_key" }));
  });

  it("detects bearer from openapi security detail", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-062",
        category: "bot_auth",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/openapi.json", JSON.stringify({ bearer: true }))],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.data.methods).toContainEqual(expect.objectContaining({ type: "bearer" }));
  });

  it("detects did from did.json evidence", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-055",
        category: "identity",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/.well-known/did.json", JSON.stringify({ id: "did:hedera:testnet:abc123" }))],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.data.did).toBe("did:hedera:testnet:abc123");
    expect(auth!.data.methods).toContainEqual(expect.objectContaining({ type: "did" }));
  });
});

describe("SLICE-101-4: extractAuth — web_bot_auth", () => {
  it("sets web_bot_auth true for VERIFIED bot_auth assertion", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-060",
        category: "bot_auth",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/.well-known/http-message-signatures")],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.data.web_bot_auth).toBe(true);
  });

  it("sets web_bot_auth false when no bot_auth VERIFIED", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-055",
        category: "identity",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/.well-known/did.json")],
      }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.data.web_bot_auth).toBe(false);
  });
});

describe("SLICE-101-4: extractAuth — section meta", () => {
  it("computes confidence as mean", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-060", category: "bot_auth", status: "VERIFIED", confidence: 0.9, evidence: [makeEvidence("https://x.com/oauth")] }),
      makeAssertion({ rule_id: "AB-055", category: "identity", status: "VERIFIED", confidence: 0.8, evidence: [makeEvidence("https://x.com/did.json")] }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.confidence).toBeCloseTo(0.85, 5);
  });

  it("gaps contains GAP rule_ids", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-060", category: "bot_auth", status: "VERIFIED", evidence: [makeEvidence("https://x.com/oauth")] }),
      makeAssertion({ rule_id: "AB-058", category: "bot_auth", status: "GAP", confidence: 0 }),
    ];
    const auth = extractAuth(assertions);
    expect(auth!.gaps).toContain("AB-058");
  });

  it("stale is false", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-060", category: "bot_auth", status: "VERIFIED", evidence: [makeEvidence("https://x.com")] }),
    ];
    expect(extractAuth(assertions)!.stale).toBe(false);
  });
});

describe("SLICE-101-4: extractAuth — edge cases", () => {
  it("returns undefined when zero applicable assertions", () => {
    expect(extractAuth([makeAssertion({ rule_id: "AB-030", category: "pricing", status: "VERIFIED" })])).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(extractAuth([])).toBeUndefined();
  });

  it("does not add duplicate method types", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-060", category: "bot_auth", status: "VERIFIED", evidence: [makeEvidence("https://x.com/oauth-protected-resource")] }),
      makeAssertion({ rule_id: "AB-061", category: "bot_auth", status: "VERIFIED", evidence: [makeEvidence("https://y.com/oauth", JSON.stringify({ oauth2: true }))] }),
    ];
    const auth = extractAuth(assertions);
    const oauthMethods = auth!.data.methods.filter((m) => m.type === "oauth2");
    expect(oauthMethods).toHaveLength(1);
  });
});
