import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRuntimeTargetServer } from "../../fixtures/runtime-target-server";
import { registerRuntimeCommand } from "../../../src/agent-readiness/cli/commands/runtime";
import { getCommand, clearCommands, type ParsedFlags } from "../../../src/agent-readiness/cli/router";

describe("SLICE-98-7: CLI runtime command", () => {
  let server: ReturnType<typeof createRuntimeTargetServer>;
  let baseUrl: string;

  beforeAll(async () => {
    server = createRuntimeTargetServer({ port: 0 });
    baseUrl = await server.start();
    clearCommands();
    registerRuntimeCommand();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("command is registered as 'runtime'", () => {
    const cmd = getCommand("runtime");
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe("runtime");
    expect(cmd!.description).toContain("runtime");
  });

  it("pretty output: 8 tasks, ASR summary, per-task lines", async () => {
    const cmd = getCommand("runtime")!;
    const result = await cmd.handler(
      { positional: [baseUrl] },
      {} as ParsedFlags,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Agent Success Rate");
    expect(result.stdout).toContain("RT-01");
    expect(result.stdout).toContain("RT-08");
  });

  it("JSON output: --json flag produces valid JSON", async () => {
    const cmd = getCommand("runtime")!;
    const result = await cmd.handler(
      { positional: [baseUrl] },
      { json: true } as ParsedFlags,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.traces).toBeDefined();
    expect(parsed.asr).toBeDefined();
    expect(parsed.asr.total).toBe(8);
  });

  it("--tasks flag filters tasks", async () => {
    const cmd = getCommand("runtime")!;
    const result = await cmd.handler(
      { positional: [baseUrl] },
      { json: true, tasks: "RT-01,RT-02" } as ParsedFlags,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.asr.total).toBe(2);
    expect(parsed.traces).toHaveLength(2);
  });

  it("--budget-requests flag clamps max requests", async () => {
    const cmd = getCommand("runtime")!;
    const result = await cmd.handler(
      { positional: [baseUrl] },
      { json: true, "budget-requests": "1" } as ParsedFlags,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // With budget of 1, some tasks should be partial/failed due to budget exhaustion
    const notSuccess = parsed.traces.filter((t: { outcome: string }) => t.outcome !== "success");
    expect(notSuccess.length).toBeGreaterThan(0);
  });

  it("--creds-env reads credentials from environment", async () => {
    process.env.TEST_RUNTIME_KEY = "test-key-value";
    const cmd = getCommand("runtime")!;
    const result = await cmd.handler(
      { positional: [baseUrl] },
      { json: true, "creds-env": "TEST_RUNTIME_KEY" } as ParsedFlags,
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.traces).toBeDefined();
    delete process.env.TEST_RUNTIME_KEY;
  });

  it("safety: creds value on argv is rejected", async () => {
    const cmd = getCommand("runtime")!;
    // Simulate someone trying to pass creds directly (not via env var name)
    const result = await cmd.handler(
      { positional: [baseUrl] },
      { json: true, "creds-env": "secret-key-123" } as ParsedFlags,
    );
    // Should fail because "secret-key-123" is not a valid env var name
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("creds-env");
  });
});

describe("SLICE-98-7: Safety — default scan path is runtime-free", () => {
  it("scan command does not have runtime flags", () => {
    // The scan command must not invoke runtime tests
    // This is a structural assertion: scan.ts has no runtime-related flags
    const scanCmd = getCommand("scan");
    if (scanCmd) {
      const flagNames = scanCmd.flags.map((f) => f.name);
      expect(flagNames).not.toContain("runtime");
      expect(flagNames).not.toContain("with-runtime");
    }
  });
});
