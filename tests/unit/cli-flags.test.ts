import { describe, it, expect } from "vitest";
import { parseArgs, type CommandFlag } from "../../src/agent-readiness/cli/router";

const TEST_FLAGS: CommandFlag[] = [
  { name: "json-api", type: "boolean", description: "Full JSON API output" },
  { name: "category", type: "string", description: "Filter by category" },
  { name: "format", type: "string", description: "Output format", default: "text" },
  { name: "threshold", type: "string", description: "Score threshold" },
  { name: "fix-hints", type: "boolean", description: "Include fix hints" },
  { name: "compact", type: "boolean", description: "Compact M2M JSON" },
  { name: "report-url", type: "string", description: "Web report URL" },
  { name: "watch", type: "boolean", description: "Watch mode" },
];

describe("SLICE-48-21..22: CLI flags", () => {
  it("parses --json-api", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--json-api"], TEST_FLAGS);
    expect(flags["json-api"]).toBe(true);
  });

  it("parses --category <name>", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--category", "payments"], TEST_FLAGS);
    expect(flags["category"]).toBe("payments");
  });

  it("parses --format <text|json|markdown>", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--format", "json"], TEST_FLAGS);
    expect(flags["format"]).toBe("json");
  });

  it("parses --threshold <N>", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--threshold", "80"], TEST_FLAGS);
    expect(flags["threshold"]).toBe("80");
  });

  it("parses --fix-hints", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--fix-hints"], TEST_FLAGS);
    expect(flags["fix-hints"]).toBe(true);
  });

  it("parses --compact", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--compact"], TEST_FLAGS);
    expect(flags["compact"]).toBe(true);
  });

  it("parses --report-url <url>", () => {
    const { flags } = parseArgs(["scan", "https://example.com", "--report-url", "https://app.agentbadge.xyz/r/123"], TEST_FLAGS);
    expect(flags["report-url"]).toBe("https://app.agentbadge.xyz/r/123");
  });

  it("format defaults to text", () => {
    const { flags } = parseArgs(["scan", "https://example.com"], TEST_FLAGS);
    expect(flags["format"]).toBe("text");
  });
});
