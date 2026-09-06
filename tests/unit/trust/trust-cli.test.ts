import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { runCommand, clearCommands } from "../../../src/agent-readiness/cli/router";
import { registerTrustCommand } from "../../../src/agent-readiness/cli/commands/trust";
import { makeValidSnapshot, makeTamperedHashSnapshot } from "./fixtures/verification-fixtures";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("SLICE-102-8: CLI trust command", () => {
  beforeEach(() => {
    clearCommands();
    registerTrustCommand();
  });

  afterEach(() => {
    clearCommands();
    vi.restoreAllMocks();
  });

  describe("missing required flags", () => {
    it("returns exit 1 when no --url or --snapshot provided", async () => {
      const result = await runCommand(["trust", "--verify"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("either --url or --snapshot is required");
    });
  });

  describe("--snapshot <file> --verify (local verification)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-cli-test-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("verifies a valid local snapshot → exit 0", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const filePath = path.join(tmpDir, "snapshot.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot));

      const result = await runCommand(["trust", "--snapshot", filePath, "--verify", "--public-key", publicKey]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("VERIFIED");
    });

    it("fails on tampered snapshot → exit 2", async () => {
      const { snapshot } = makeValidSnapshot();
      const tampered = makeTamperedHashSnapshot(snapshot);
      const filePath = path.join(tmpDir, "tampered.json");
      fs.writeFileSync(filePath, JSON.stringify(tampered));

      const result = await runCommand(["trust", "--snapshot", filePath, "--verify"]);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Verification failed");
    });

    it("outputs JSON with --json flag on valid snapshot", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const filePath = path.join(tmpDir, "snapshot.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot));

      const result = await runCommand(["trust", "--snapshot", filePath, "--verify", "--json", "--public-key", publicKey]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.valid).toBe(true);
      expect(parsed.checks).toBeDefined();
    });

    it("outputs JSON with --json flag on failed verification → exit 2", async () => {
      const { snapshot } = makeValidSnapshot();
      const tampered = makeTamperedHashSnapshot(snapshot);
      const filePath = path.join(tmpDir, "tampered.json");
      fs.writeFileSync(filePath, JSON.stringify(tampered));

      const result = await runCommand(["trust", "--snapshot", filePath, "--verify", "--json"]);
      expect(result.exitCode).toBe(2);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.valid).toBe(false);
    });

    it("outputs markdown with --markdown flag", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const filePath = path.join(tmpDir, "snapshot.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot));

      const result = await runCommand(["trust", "--snapshot", filePath, "--verify", "--markdown", "--public-key", publicKey]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("# Trust Snapshot:");
    });

    it("returns exit 1 on unreadable file", async () => {
      const result = await runCommand(["trust", "--snapshot", "/nonexistent/path/snapshot.json", "--verify"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error reading snapshot file");
    });
  });

  describe("--url <url> --verify (remote fetch)", () => {
    it("returns exit 1 on network error", async () => {
      const result = await runCommand(["trust", "--url", "nonexistent.example.com", "--verify", "--api-url", "http://localhost:1"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error:");
    });
  });

  describe("--url <url> --challenge", () => {
    it("returns exit 1 on network error for challenge", async () => {
      const result = await runCommand(["trust", "--url", "api.example.com", "--challenge", "--api-url", "http://localhost:1"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error:");
    });
  });

  describe("--url <url> --attest", () => {
    it("returns exit 1 when --tier/--account/--signature missing", async () => {
      const result = await runCommand(["trust", "--url", "api.example.com", "--attest"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--attest requires --tier, --account, and --signature");
    });

    it("returns exit 1 on network error for attest", async () => {
      const result = await runCommand([
        "trust", "--url", "api.example.com", "--attest",
        "--tier", "silver", "--account", "0x123", "--signature", "0xabc",
        "--api-url", "http://localhost:1",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error:");
    });
  });

  describe("--snapshot without --verify (auto-verifies when no --url)", () => {
    it("verifies snapshot even without --verify flag when --url is absent", async () => {
      const { snapshot, publicKey } = makeValidSnapshot();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-cli-test-"));
      const filePath = path.join(tmpDir, "snapshot.json");
      fs.writeFileSync(filePath, JSON.stringify(snapshot));

      const result = await runCommand(["trust", "--snapshot", filePath, "--public-key", publicKey]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("VERIFIED");

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
