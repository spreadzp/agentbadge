import { describe, it, expect, beforeEach } from "vitest";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerFixCommand } from "../../../../src/agent-readiness/cli/commands/fix";
import { runCommand, clearCommands } from "../../../../src/agent-readiness/cli/router";

let tempDir: string;

beforeEach(async () => {
  clearCommands();
  registerFixCommand();
  tempDir = await mkdtemp(join(tmpdir(), "agentbadge-fix-"));
});

function makeReport(assertions: any[]) {
  return {
    report_id: "01HTEST",
    schema_version: "0.1.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: { agent_id: "test", agent_version: "1.0", endpoint_base_url: "https://test.com", timestamp: "" },
    scanned_at: "",
    previous_hash: null,
    score: { overall: 50, categories: {} },
    assertions,
    integrity: { content_hash: "a".repeat(64), signature: { algorithm: "ed25519", key_id: "k", value: "" } },
  };
}

describe("fix command", () => {
  it("returns error for missing report path", async () => {
    const result = await runCommand(["fix"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });

  it("generates fix suggestions for MISSING assertions", async () => {
    const report = makeReport([
      { rule_id: "AB-001", status: "MISSING", reason: "robots.txt not found", confidence: 0.9, source_url: null },
      { rule_id: "AB-002", status: "MISSING", reason: "sitemap.xml not found", confidence: 0.9, source_url: null },
      { rule_id: "AB-003", status: "VERIFIED", reason: "ok", confidence: 1.0, source_url: null },
    ]);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");
    const outputPath = join(tempDir, "fixes.json");

    const result = await runCommand(["fix", reportPath, "--output", outputPath]);
    expect(result.exitCode).toBe(0);
    expect(result.outputFile).toBe(outputPath);

    const fixes = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(fixes).toHaveLength(2);
    expect(fixes[0].rule_id).toBe("AB-001");
    expect(fixes[0].diff).toContain("robots.txt");
    expect(fixes[1].rule_id).toBe("AB-002");
  });

  it("outputs JSON with --json flag", async () => {
    const report = makeReport([
      { rule_id: "AB-001", status: "MISSING", reason: "no robots", confidence: 0.9, source_url: null },
    ]);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");

    const result = await runCommand(["fix", reportPath, "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].rule_id).toBe("AB-001");
  });

  it("outputs to stdout with --dry-run", async () => {
    const report = makeReport([
      { rule_id: "AB-003", status: "MISSING", reason: "no guide", confidence: 0.9, source_url: null },
    ]);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");

    const result = await runCommand(["fix", reportPath, "--dry-run"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed[0].rule_id).toBe("AB-003");
  });

  it("sorts by severity (high first)", async () => {
    const report = makeReport([
      { rule_id: "AB-004", status: "MISSING", reason: "no openapi", confidence: 0.9, source_url: null },
      { rule_id: "AB-001", status: "MISSING", reason: "no robots", confidence: 0.9, source_url: null },
    ]);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");

    const result = await runCommand(["fix", reportPath, "--json"]);
    const parsed = JSON.parse(result.stdout);
    expect(parsed[0].severity).toBe("high");
    expect(parsed[1].severity).toBe("medium");
  });
});
