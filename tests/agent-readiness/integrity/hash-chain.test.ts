import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HashChainManager } from "../../../src/agent-readiness/integrity/hash-chain";

describe("SLICE-36-7: Hash Chain Manager", () => {
  let tempDir: string;
  let manager: HashChainManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "chain-"));
    manager = new HashChainManager(tempDir);
    await manager.load();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("getPreviousHash returns null for new scope", () => {
    expect(manager.getPreviousHash("https://api.example.com")).toBeNull();
  });

  it("after updateChain, getPreviousHash returns new hash", async () => {
    await manager.updateChain("https://api.example.com", "report-1", "hash-abc", "2026-01-01T00:00:00Z");
    expect(manager.getPreviousHash("https://api.example.com")).toBe("hash-abc");
  });

  it("verifyChain with 3 valid reports → valid: true", () => {
    const reports = [
      { scope: "s1", report_id: "r0", previous_hash: null, integrity: { content_hash: "hash-0" } },
      { scope: "s1", report_id: "r1", previous_hash: "hash-0", integrity: { content_hash: "hash-1" } },
      { scope: "s1", report_id: "r2", previous_hash: "hash-1", integrity: { content_hash: "hash-2" } },
    ];
    const result = manager.verifyChain(reports);
    expect(result.valid).toBe(true);
  });

  it("verifyChain with tampered middle report → valid: false, brokenAt: 2", () => {
    const reports = [
      { scope: "s1", report_id: "r0", previous_hash: null, integrity: { content_hash: "hash-0" } },
      { scope: "s1", report_id: "r1", previous_hash: "hash-0", integrity: { content_hash: "TAMPERED" } },
      { scope: "s1", report_id: "r2", previous_hash: "hash-1", integrity: { content_hash: "hash-2" } },
    ];
    const result = manager.verifyChain(reports);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toContain("mismatch");
  });

  it("different scopes have independent chains", async () => {
    await manager.updateChain("scope-a", "r1", "hash-a", "2026-01-01T00:00:00Z");
    await manager.updateChain("scope-b", "r2", "hash-b", "2026-01-01T00:00:00Z");
    expect(manager.getPreviousHash("scope-a")).toBe("hash-a");
    expect(manager.getPreviousHash("scope-b")).toBe("hash-b");
  });

  it("chain persists across load/save cycle", async () => {
    await manager.updateChain("scope-persist", "r1", "hash-persist", "2026-01-01T00:00:00Z");

    const manager2 = new HashChainManager(tempDir);
    await manager2.load();
    expect(manager2.getPreviousHash("scope-persist")).toBe("hash-persist");
  });

  it("genesis report (first) has null previous_hash", () => {
    const reports = [
      { scope: "s1", report_id: "r0", previous_hash: null, integrity: { content_hash: "hash-0" } },
    ];
    const result = manager.verifyChain(reports);
    expect(result.valid).toBe(true);
  });

  it("verifyChain with single report → valid: true", () => {
    const reports = [
      { scope: "s1", report_id: "r0", previous_hash: null, integrity: { content_hash: "hash-0" } },
    ];
    expect(manager.verifyChain(reports).valid).toBe(true);
  });
});
