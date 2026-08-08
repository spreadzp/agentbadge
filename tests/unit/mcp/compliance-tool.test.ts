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
});
