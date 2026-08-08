import { describe, it, expect } from "vitest";
import { generateImprovementGuide } from "../../src/agent-readiness/generators/improvement-guide";

describe("SLICE-48-23: Improvement guide generation", () => {
  it("generates markdown guide from failing checks", () => {
    const guide = generateImprovementGuide({
      score: 45,
      checks: [
        { id: "AB-015", name: "Agent UA gets non-HTML", status: "MISSING", hint: "Add content negotiation", fixExample: "app.use(accepts())" },
        { id: "AB-039", name: "x402.json found", status: "MISSING", hint: "Create /.well-known/x402.json", fixExample: "{}" },
      ],
    });
    expect(guide).toContain("# Improvement Guide");
    expect(guide).toContain("AB-015");
    expect(guide).toContain("Add content negotiation");
    expect(guide).toContain("app.use(accepts())");
  });

  it("orders by priority (category weight)", () => {
    const guide = generateImprovementGuide({
      score: 50,
      checks: [
        { id: "AB-039", name: "x402.json", status: "MISSING", category: "payments", hint: "Create x402.json" },
        { id: "AB-015", name: "Content negotiation", status: "MISSING", category: "machine_readable", hint: "Add accepts()" },
      ],
    });
    expect(guide.indexOf("AB-015")).toBeLessThan(guide.indexOf("AB-039"));
  });

  it("groups by category", () => {
    const guide = generateImprovementGuide({
      score: 30,
      checks: [
        { id: "AB-015", name: "Content negotiation", status: "fail", category: "content_negotiation", hint: "Add accepts()" },
        { id: "AB-020", name: "MCP descriptor", status: "fail", category: "discovery", hint: "Add /.well-known/mcp.json" },
      ],
    });
    expect(guide).toContain("## content_negotiation");
    expect(guide).toContain("## discovery");
  });
});
