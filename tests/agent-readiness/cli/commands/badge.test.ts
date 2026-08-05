import { describe, it, expect, beforeEach } from "vitest";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerBadgeCommand } from "../../../../src/agent-readiness/cli/commands/badge";
import { runCommand, clearCommands } from "../../../../src/agent-readiness/cli/router";

let tempDir: string;

beforeEach(async () => {
  clearCommands();
  registerBadgeCommand();
  tempDir = await mkdtemp(join(tmpdir(), "agentbadge-badge-"));
});

function makeReport(score: number) {
  return {
    report_id: "01HTEST",
    schema_version: "0.1.0",
    ruleset: { name: "agent-readiness", version: "1.2.0" },
    scope: { agent_id: "test", agent_version: "1.0", endpoint_base_url: "https://test.com", timestamp: "" },
    scanned_at: "",
    previous_hash: null,
    score: { overall: score, categories: {} },
    assertions: [],
    integrity: { content_hash: "a".repeat(64), signature: { algorithm: "ed25519", key_id: "k", value: "" } },
  };
}

describe("badge command", () => {
  it("returns error for missing report path", async () => {
    const result = await runCommand(["badge"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });

  it("generates SVG badge from report", async () => {
    const report = makeReport(85);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");
    const outputPath = join(tempDir, "badge.svg");

    const result = await runCommand(["badge", reportPath, "--output", outputPath]);
    expect(result.exitCode).toBe(0);
    expect(result.outputFile).toBe(outputPath);

    const svg = await readFile(outputPath, "utf-8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("85/100");
    expect(svg).toContain("agent readiness");
  });

  it("uses custom label", async () => {
    const report = makeReport(92);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");
    const outputPath = join(tempDir, "badge.svg");

    const result = await runCommand(["badge", reportPath, "--output", outputPath, "--label", "my badge"]);
    expect(result.exitCode).toBe(0);

    const svg = await readFile(outputPath, "utf-8");
    expect(svg).toContain("my badge");
  });

  it("uses green color for high scores", async () => {
    const report = makeReport(95);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");
    const outputPath = join(tempDir, "badge.svg");

    await runCommand(["badge", reportPath, "--output", outputPath]);
    const svg = await readFile(outputPath, "utf-8");
    expect(svg).toContain("#4c1");
  });

  it("uses red color for low scores", async () => {
    const report = makeReport(30);
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report), "utf-8");
    const outputPath = join(tempDir, "badge.svg");

    await runCommand(["badge", reportPath, "--output", outputPath]);
    const svg = await readFile(outputPath, "utf-8");
    expect(svg).toContain("#e05d44");
  });
});
