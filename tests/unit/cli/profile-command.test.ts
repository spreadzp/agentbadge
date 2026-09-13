import { describe, it, expect, beforeEach } from "vitest";
import { clearCommands, runCommand } from "../../../src/agent-readiness/cli/router";
import { registerProfileCommand } from "../../../src/agent-readiness/cli/commands/profile";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-101-8: CLI profile command tests.
 */

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(tmpdir(), "profile-test-"));
}

describe("SLICE-101-8: CLI profile command", () => {
  beforeEach(() => {
    clearCommands();
    registerProfileCommand();
  });

  it("is registered without error", () => {
    clearCommands();
    registerProfileCommand();
    expect(true).toBe(true);
  });

  it("returns exit 1 when neither --url nor --report given", async () => {
    const result = await runCommand(["profile"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--url or --report");
  });

  it("returns exit 1 with usage message when no flags", async () => {
    const result = await runCommand(["profile"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("generates JSON profile from --report with simplified format", async () => {
    const dir = makeTmpDir();
    const reportPath = path.join(dir, "scan.json");

    const { makeFixtureScanReport, makeFixtureAssertions } = await import("../profile/fixtures/scan-report-fixture");
    const reportData = {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "CLI-TEST",
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportData));

    const result = await runCommand(["profile", "--report", reportPath, "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const profile = JSON.parse(result.stdout);
    expect(profile.profile_version).toBe("1.0.0");
    expect(profile.service.domain).toBe("api.example.com");

    fs.rmSync(dir, { recursive: true });
  });

  it("generates markdown profile from --report", async () => {
    const dir = makeTmpDir();
    const reportPath = path.join(dir, "scan.json");

    const { makeFixtureScanReport, makeFixtureAssertions } = await import("../profile/fixtures/scan-report-fixture");
    const reportData = {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "CLI-MD-TEST",
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportData));

    const result = await runCommand(["profile", "--report", reportPath, "--format", "markdown"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("# Knowledge Profile");

    fs.rmSync(dir, { recursive: true });
  });

  it("generates YAML profile from --report", async () => {
    const dir = makeTmpDir();
    const reportPath = path.join(dir, "scan.json");

    const { makeFixtureScanReport, makeFixtureAssertions } = await import("../profile/fixtures/scan-report-fixture");
    const reportData = {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "CLI-YAML-TEST",
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportData));

    const result = await runCommand(["profile", "--report", reportPath, "--format", "yaml"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("profile_version:");

    fs.rmSync(dir, { recursive: true });
  });

  it("writes to --output file instead of stdout", async () => {
    const dir = makeTmpDir();
    const reportPath = path.join(dir, "scan.json");
    const outputPath = path.join(dir, "profile.json");

    const { makeFixtureScanReport, makeFixtureAssertions } = await import("../profile/fixtures/scan-report-fixture");
    const reportData = {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "CLI-OUT-TEST",
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportData));

    const result = await runCommand(["profile", "--report", reportPath, "--output", outputPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.outputFile).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
    expect(written.profile_version).toBe("1.0.0");

    fs.rmSync(dir, { recursive: true });
  });

  it("returns exit 1 for invalid report file", async () => {
    const result = await runCommand(["profile", "--report", "/nonexistent/path/scan.json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Error:");
  });

  it("returns exit 2 when profile has stale sections", async () => {
    const dir = makeTmpDir();
    const reportPath = path.join(dir, "scan.json");

    const { makeFixtureScanReport, makeFixtureAssertions } = await import("../profile/fixtures/scan-report-fixture");
    const reportData = {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions().map((a: Assertion) => ({
        ...a,
        verified_at: "2020-01-01T00:00:00Z",
        timestamp: "2020-01-01T00:00:00Z",
      })),
      reportId: "CLI-STALE-TEST",
    };
    fs.writeFileSync(reportPath, JSON.stringify(reportData));

    const result = await runCommand(["profile", "--report", reportPath, "--format", "json"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("stale sections");
    const profile = JSON.parse(result.stdout);
    expect(profile.profile_version).toBe("1.0.0");

    fs.rmSync(dir, { recursive: true });
  });
});
