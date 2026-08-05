import { describe, it, expect, beforeEach } from "vitest";
import { handleHelp, handleVersion } from "../../../src/agent-readiness/cli/help";
import { registerScanCommand } from "../../../src/agent-readiness/cli/commands/scan";
import { registerVerifyCommand } from "../../../src/agent-readiness/cli/commands/verify-report";
import { registerFixCommand } from "../../../src/agent-readiness/cli/commands/fix";
import { registerBadgeCommand } from "../../../src/agent-readiness/cli/commands/badge";
import { clearCommands } from "../../../src/agent-readiness/cli/router";

beforeEach(() => {
  clearCommands();
  registerScanCommand();
  registerVerifyCommand();
  registerFixCommand();
  registerBadgeCommand();
});

describe("handleHelp", () => {
  it("returns global help with no args", () => {
    const result = handleHelp([]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("scan");
    expect(result.stdout).toContain("verify-report");
    expect(result.stdout).toContain("fix");
    expect(result.stdout).toContain("badge");
  });

  it("returns global help with --help flag", () => {
    const result = handleHelp(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  it("returns command-specific help for scan", () => {
    const result = handleHelp(["scan"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agentbadge scan");
    expect(result.stdout).toContain("url");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--output");
  });

  it("returns command-specific help for verify-report", () => {
    const result = handleHelp(["verify-report"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agentbadge verify-report");
    expect(result.stdout).toContain("report-path");
    expect(result.stdout).toContain("--public-key");
  });

  it("returns error for unknown command help", () => {
    const result = handleHelp(["nonexistent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});

describe("handleVersion", () => {
  it("returns version string", () => {
    const result = handleVersion();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agentbadge v");
    expect(result.stdout).toMatch(/v\d+\.\d+\.\d+/);
  });
});
