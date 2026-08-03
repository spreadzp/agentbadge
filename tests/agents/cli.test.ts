import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { parseCliArgs, loadCliConfig, runCli, type CliConfig, type CliOptions } from "../../src/agents/cli";

// ─── parseCliArgs ──────────────────────────────────────────────────

describe("parseCliArgs", () => {
  it("parses --task-id=xxx", () => {
    const args = parseCliArgs(["--task-id=task-abc-123"]);
    expect(args.taskId).toBe("task-abc-123");
  });

  it("parses --task-id xxx (space-separated)", () => {
    const args = parseCliArgs(["--task-id", "task-def-456"]);
    expect(args.taskId).toBe("task-def-456");
  });

  it("returns undefined taskId when not provided", () => {
    const args = parseCliArgs([]);
    expect(args.taskId).toBeUndefined();
  });

  it("parses --capability=medical-analysis", () => {
    const args = parseCliArgs(["--capability=medical-analysis"]);
    expect(args.capability).toBe("medical-analysis");
  });

  it("defaults capability to medical-analysis", () => {
    const args = parseCliArgs([]);
    expect(args.capability).toBe("medical-analysis");
  });
});

// ─── loadCliConfig ─────────────────────────────────────────────────

describe("loadCliConfig", () => {
  beforeEach(() => {
    process.env.AGENT_DID = "did:hcs:0.0.1234:5";
    process.env.AGENT_ACCOUNT_ID = "0.0.1234";
    process.env.AGENT_PRIVATE_KEY = "302e0201000a";
    process.env.AGENT_TIER = "gold";
  });

  afterEach(() => {
    delete process.env.AGENT_DID;
    delete process.env.AGENT_ACCOUNT_ID;
    delete process.env.AGENT_PRIVATE_KEY;
    delete process.env.AGENT_TIER;
  });

  it("loads config from env vars", () => {
    const config = loadCliConfig();
    expect(config.did).toBe("did:hcs:0.0.1234:5");
    expect(config.accountId).toBe("0.0.1234");
    expect(config.privateKey).toBe("302e0201000a");
    expect(config.tier).toBe("gold");
  });

  it("throws on missing AGENT_DID", () => {
    delete process.env.AGENT_DID;
    expect(() => loadCliConfig()).toThrow("AGENT_DID");
  });

  it("throws on missing AGENT_ACCOUNT_ID", () => {
    delete process.env.AGENT_ACCOUNT_ID;
    expect(() => loadCliConfig()).toThrow("AGENT_ACCOUNT_ID");
  });

  it("throws on missing AGENT_PRIVATE_KEY", () => {
    delete process.env.AGENT_PRIVATE_KEY;
    expect(() => loadCliConfig()).toThrow("AGENT_PRIVATE_KEY");
  });

  it("defaults tier to bronze when not set", () => {
    delete process.env.AGENT_TIER;
    const config = loadCliConfig();
    expect(config.tier).toBe("bronze");
  });
});

// ─── runCli ────────────────────────────────────────────────────────

describe("runCli", () => {
  const CONFIG: CliConfig = {
    did: "did:hcs:0.0.1234:5",
    accountId: "0.0.1234",
    privateKey: "302e0201000a",
    tier: "gold",
    capabilities: ["medical-analysis"],
  };

  it("runs specific task with --task-id and exits 0 on success", async () => {
    const mockRun = mock(() => Promise.resolve({ completed: true, attempts: 1 }));
    const result = await runCli({
      config: CONFIG,
      options: { taskId: "task-xyz" },
      runTask: mockRun,
    });
    expect(result.exitCode).toBe(0);
    expect(mockRun).toHaveBeenCalledWith("task-xyz");
  });

  it("exits 1 on task failure (aborted)", async () => {
    const mockRun = mock(() => Promise.resolve({ completed: false, attempts: 3 }));
    const result = await runCli({
      config: CONFIG,
      options: { taskId: "task-fail" },
      runTask: mockRun,
    });
    expect(result.exitCode).toBe(1);
  });

  it("exits 1 on runtime error", async () => {
    const mockRun = mock(() => Promise.reject(new Error("network error")));
    const result = await runCli({
      config: CONFIG,
      options: { taskId: "task-err" },
      runTask: mockRun,
    });
    expect(result.exitCode).toBe(1);
  });

  it("polls marketplace when no --task-id", async () => {
    const mockPoll = mock(() => Promise.resolve("task-from-poll"));
    const mockRun = mock(() => Promise.resolve({ completed: true, attempts: 1 }));
    const result = await runCli({
      config: CONFIG,
      options: {},
      runTask: mockRun,
      pollTask: mockPoll,
    });
    expect(result.exitCode).toBe(0);
    expect(mockPoll).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith("task-from-poll");
  });

  it("exits 1 when no tasks available", async () => {
    const mockPoll = mock(() => Promise.resolve(null));
    const mockRun = mock(() => Promise.resolve({ completed: true, attempts: 1 }));
    const result = await runCli({
      config: CONFIG,
      options: {},
      runTask: mockRun,
      pollTask: mockPoll,
    });
    expect(result.exitCode).toBe(1);
    expect(mockRun).not.toHaveBeenCalled();
  });
});
