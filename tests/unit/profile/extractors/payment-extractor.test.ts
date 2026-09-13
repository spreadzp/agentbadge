import { describe, it, expect } from "vitest";
import { extractPricing } from "../../../../src/agent-readiness/profile/extractors/payment-extractor";
import type { Assertion } from "../../../../src/agent-readiness/rule-engine/assertion-builder";
import type { Evidence } from "../../../../src/agent-readiness/rule-engine/evidence.types";

/**
 * SLICE-101-4: Payment Extractor tests.
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

describe("SLICE-101-4: extractPricing — model inference", () => {
  it("infers 'paid' from x402 evidence", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-030",
        category: "payments",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/payment", JSON.stringify({ x402: true }))],
      }),
    ];
    const pricing = extractPricing(assertions);
    expect(pricing!.data.model).toBe("paid");
  });

  it("infers 'per_call' from x402 + per_call evidence", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-030",
        category: "payments",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/payment", JSON.stringify({ x402: true, per_call: true }))],
      }),
    ];
    const pricing = extractPricing(assertions);
    expect(pricing!.data.model).toBe("per_call");
  });

  it("infers 'freemium' from pricing.json with free tier", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-029",
        category: "pricing",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/pricing.json", JSON.stringify({ free_tier: true }))],
      }),
    ];
    const pricing = extractPricing(assertions);
    expect(pricing!.data.model).toBe("freemium");
  });

  it("infers 'subscription' from pricing.json with plans", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-029",
        category: "pricing",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/pricing.json", JSON.stringify({ plans: ["basic", "pro"] }))],
      }),
    ];
    const pricing = extractPricing(assertions);
    expect(pricing!.data.model).toBe("subscription");
  });

  it("infers 'free' when no pricing or x402 evidence", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-029",
        category: "pricing",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/agent-card.json", JSON.stringify({}))],
      }),
    ];
    const pricing = extractPricing(assertions);
    expect(pricing!.data.model).toBe("free");
  });
});

describe("SLICE-101-4: extractPricing — mechanism", () => {
  it("infers 'x402' mechanism from x402 evidence", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-030",
        category: "payments",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/payment", JSON.stringify({ x402: true }))],
      }),
    ];
    expect(extractPricing(assertions)!.data.mechanism).toBe("x402");
  });

  it("infers 'stripe' mechanism from stripe evidence", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-029",
        category: "pricing",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/pricing.json", JSON.stringify({ stripe: true, plans: ["basic"] }))],
      }),
    ];
    expect(extractPricing(assertions)!.data.mechanism).toBe("stripe");
  });

  it("infers 'none' mechanism for free model", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-029",
        category: "pricing",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/agent-card.json", JSON.stringify({}))],
      }),
    ];
    expect(extractPricing(assertions)!.data.mechanism).toBe("none");
  });
});

describe("SLICE-101-4: extractPricing — asset + free_tier", () => {
  it("extracts asset from agent-card payment.asset", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-030",
        category: "payments",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/agent-card.json", JSON.stringify({ payment: { asset: "HBAR" }, x402: true }))],
      }),
    ];
    expect(extractPricing(assertions)!.data.asset).toBe("HBAR");
  });

  it("extracts free_tier from pricing.json", () => {
    const assertions = [
      makeAssertion({
        rule_id: "AB-029",
        category: "pricing",
        status: "VERIFIED",
        evidence: [makeEvidence("https://api.example.com/pricing.json", JSON.stringify({ free_tier: true }))],
      }),
    ];
    expect(extractPricing(assertions)!.data.free_tier).toBe(true);
  });
});

describe("SLICE-101-4: extractPricing — section meta", () => {
  it("computes confidence as mean", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-030", category: "payments", status: "VERIFIED", confidence: 0.8, evidence: [makeEvidence("https://x.com", JSON.stringify({ x402: true }))] }),
      makeAssertion({ rule_id: "AB-029", category: "pricing", status: "VERIFIED", confidence: 0.9, evidence: [makeEvidence("https://x.com/pricing.json", JSON.stringify({ free_tier: true }))] }),
    ];
    expect(extractPricing(assertions)!.confidence).toBeCloseTo(0.85, 5);
  });

  it("gaps contains GAP rule_ids", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-030", category: "payments", status: "VERIFIED", evidence: [makeEvidence("https://x.com", JSON.stringify({ x402: true }))] }),
      makeAssertion({ rule_id: "AB-031", category: "payments", status: "GAP", confidence: 0 }),
    ];
    expect(extractPricing(assertions)!.gaps).toContain("AB-031");
  });

  it("stale is false", () => {
    const assertions = [
      makeAssertion({ rule_id: "AB-030", category: "payments", status: "VERIFIED", evidence: [makeEvidence("https://x.com", JSON.stringify({ x402: true }))] }),
    ];
    expect(extractPricing(assertions)!.stale).toBe(false);
  });
});

describe("SLICE-101-4: extractPricing — edge cases", () => {
  it("returns undefined when zero applicable assertions", () => {
    expect(extractPricing([makeAssertion({ rule_id: "AB-060", category: "bot_auth", status: "VERIFIED" })])).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(extractPricing([])).toBeUndefined();
  });
});
