import { describe, it, expect, beforeEach } from "vitest";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerVerifyCommand } from "../../../../src/agent-readiness/cli/commands/verify-report";
import { runCommand, clearCommands } from "../../../../src/agent-readiness/cli/router";
import { generateSigningKey, savePublicKey, saveSigningKey, loadSigningKey } from "../../../../src/agent-readiness/integrity/key-manager";
import { assembleReport } from "../../../../src/agent-readiness/integrity/report-serializer";
import { signContentHash } from "../../../../src/agent-readiness/integrity/signer";

let tempDir: string;

beforeEach(async () => {
  clearCommands();
  registerVerifyCommand();
  tempDir = await mkdtemp(join(tmpdir(), "agentbadge-verify-"));
});

describe("verify-report command", () => {
  it("returns error for missing report path", async () => {
    const result = await runCommand(["verify-report"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
  });

  it("returns error for missing --public-key flag", async () => {
    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify({ integrity: {} }), "utf-8");
    const result = await runCommand(["verify-report", reportPath]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--public-key");
  });

  it("verifies a valid signed report", async () => {
    const key = generateSigningKey("test-key");
    const keyPath = join(tempDir, "key.json");
    const pubKeyPath = join(tempDir, "pub.json");
    await saveSigningKey(key, keyPath);
    await savePublicKey(key, pubKeyPath);

    const report = assembleReport({
      scope: { agent_id: "test", agent_version: "1.0", endpoint_base_url: "https://test.com" },
      assertions: [],
      scoreResult: { total: { score: 85 }, categories: {} },
      previousHash: null,
      keyId: key.keyId,
    });

    // Sign the report
    const loadedKey = await loadSigningKey(keyPath);
    report.integrity.signature.value = signContentHash(report.integrity.content_hash, loadedKey);

    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

    const result = await runCommand(["verify-report", reportPath, "--public-key", pubKeyPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("VERIFIED");
    expect(result.stdout).toContain("✓");
  });

  it("fails for tampered report", async () => {
    const key = generateSigningKey("test-key");
    const pubKeyPath = join(tempDir, "pub.json");
    await savePublicKey(key, pubKeyPath);

    const report = assembleReport({
      scope: { agent_id: "test", agent_version: "1.0", endpoint_base_url: "https://test.com" },
      assertions: [],
      scoreResult: { total: { score: 85 }, categories: {} },
      previousHash: null,
      keyId: key.keyId,
    });

    // Tamper: change content_hash
    report.integrity.content_hash = "0".repeat(64);

    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

    const result = await runCommand(["verify-report", reportPath, "--public-key", pubKeyPath]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("FAILED");
    expect(result.stderr).toContain("hash_mismatch");
  });

  it("outputs JSON with --json flag", async () => {
    const key = generateSigningKey("test-key");
    const pubKeyPath = join(tempDir, "pub.json");
    await savePublicKey(key, pubKeyPath);

    const report = assembleReport({
      scope: { agent_id: "test", agent_version: "1.0", endpoint_base_url: "https://test.com" },
      assertions: [],
      scoreResult: { total: { score: 85 }, categories: {} },
      previousHash: null,
      keyId: key.keyId,
    });

    const reportPath = join(tempDir, "report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");

    const result = await runCommand(["verify-report", reportPath, "--public-key", pubKeyPath, "--json"]);
    expect(result.exitCode).toBe(1); // Will fail because signature is empty
    const parsed = JSON.parse(result.stdout);
    expect(parsed.verified).toBe(false);
    expect(parsed.checks).toBeInstanceOf(Array);
  });
});
