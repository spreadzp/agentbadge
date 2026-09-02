import { describe, it, expect } from "vitest";
import {
  registerComplianceTools,
  checkComplianceHandler,
} from "../../../src/mcp/compliance-tools";

/**
 * SLICE-49-14: MCP tool check_compliance
 *
 * Tests that the check_compliance MCP tool is registered and
 * returns structured compliance scan results for a given URL.
 */

describe("SLICE-49-14: MCP check_compliance tool", () => {
  it("registerComplianceTools is a function", () => {
    expect(typeof registerComplianceTools).toBe("function");
  });

  it("checkComplianceHandler is a function", () => {
    expect(typeof checkComplianceHandler).toBe("function");
  });

  it("registerComplianceTools can be called without errors", () => {
    expect(() => registerComplianceTools()).not.toThrow();
  });

  it("returns structured result with score, checks, and summary", async () => {
    const result = await checkComplianceHandler({
      url: "https://agentbadge.xyz",
    });

    // Result is a ToolResult — content array with text
    expect(result).toHaveProperty("content");
    expect(result.content).toBeInstanceOf(Array);
    expect(result.content.length).toBeGreaterThan(0);

    // Parse the JSON from the text content
    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    // Score
    expect(parsed).toHaveProperty("score");
    expect(typeof parsed.score).toBe("number");

    // Checks array
    expect(parsed).toHaveProperty("checks");
    expect(parsed.checks).toBeInstanceOf(Array);
    expect(parsed.checks.length).toBeGreaterThan(0);

    // Each check has id, name, status
    for (const check of parsed.checks) {
      expect(check).toHaveProperty("id");
      expect(check).toHaveProperty("name");
      expect(check).toHaveProperty("status");
      expect(["pass", "fail", "skip"]).toContain(check.status);
    }

    // Summary
    expect(parsed).toHaveProperty("summary");
    expect(parsed.summary).toHaveProperty("totalChecks");
    expect(parsed.summary).toHaveProperty("passed");
    expect(parsed.summary).toHaveProperty("failed");
    expect(parsed.summary.totalChecks).toBe(parsed.checks.length);
  }, 120000);

  it("validates URL parameter — rejects missing url", async () => {
    const result = await checkComplianceHandler({});

    // Should return an error result
    expect(result.isError).toBe(true);
  });

  it("validates URL parameter — rejects invalid url", async () => {
    const result = await checkComplianceHandler({
      url: "not-a-url",
    });

    expect(result.isError).toBe(true);
  });

  // SLICE-94-9: Evidence V2 fields
  it("returns evidence_summary block with status counts", async () => {
    const result = await checkComplianceHandler({
      url: "https://agentbadge.xyz",
    });

    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    expect(parsed).toHaveProperty("evidence_summary");
    expect(parsed.evidence_summary).toHaveProperty("verified");
    expect(parsed.evidence_summary).toHaveProperty("inferred");
    expect(parsed.evidence_summary).toHaveProperty("gap");
    expect(parsed.evidence_summary).toHaveProperty("conflict");
    expect(parsed.evidence_summary).toHaveProperty("not_applicable");
    expect(parsed.evidence_summary).toHaveProperty("stale_count");
    expect(typeof parsed.evidence_summary.verified).toBe("number");
    expect(typeof parsed.evidence_summary.gap).toBe("number");
    expect(typeof parsed.evidence_summary.stale_count).toBe("number");
  }, 120000);

  it("checks include v2 fields: claim, verified_at, review_level", async () => {
    const result = await checkComplianceHandler({
      url: "https://agentbadge.xyz",
    });

    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    const check = parsed.checks[0];
    expect(check).toHaveProperty("claim");
    expect(check).toHaveProperty("verified_at");
    expect(check).toHaveProperty("review_level");
    expect(check).toHaveProperty("source_class");
    expect(check).toHaveProperty("source_label");
  }, 120000);

  it("checks include evidence entries array", async () => {
    const result = await checkComplianceHandler({
      url: "https://agentbadge.xyz",
    });

    const text = result.content[0].text;
    const parsed = JSON.parse(text);

    const check = parsed.checks[0];
    expect(check).toHaveProperty("evidence");
    expect(Array.isArray(check.evidence)).toBe(true);
  }, 120000);
});
