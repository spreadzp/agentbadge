import { describe, it, expect, beforeEach } from "vitest";
import {
  parseArgs,
  runCommand,
  registerCommand,
  clearCommands,
  type CommandDefinition,
  type CommandResult,
} from "../../../src/agent-readiness/cli/router";

describe("parseArgs", () => {
  it("parses command with positional arg", () => {
    const result = parseArgs(["scan", "https://example.com"]);
    expect(result.command).toBe("scan");
    expect(result.args.positional).toEqual(["https://example.com"]);
    expect(result.flags).toEqual({});
  });

  it("parses boolean flag", () => {
    const result = parseArgs(["scan", "--json", "https://example.com"]);
    expect(result.command).toBe("scan");
    expect(result.flags.json).toBe(true);
    expect(result.args.positional).toEqual(["https://example.com"]);
  });

  it("parses string flag with separate value", () => {
    const flagDefs = [{ name: "output", shortName: "o", type: "string" as const, description: "Output path" }];
    const result = parseArgs(["scan", "--output", "report.json", "https://example.com"], flagDefs);
    expect(result.command).toBe("scan");
    expect(result.flags.output).toBe("report.json");
    expect(result.args.positional).toEqual(["https://example.com"]);
  });

  it("parses string flag with inline = value", () => {
    const result = parseArgs(["scan", "--output=report.json", "https://example.com"]);
    expect(result.command).toBe("scan");
    expect(result.flags.output).toBe("report.json");
  });

  it("parses verify-report with public-key flag", () => {
    const flagDefs = [{ name: "public-key", shortName: "k", type: "string" as const, description: "Public key path" }];
    const result = parseArgs(["verify-report", "report.json", "--public-key", "key.pub"], flagDefs);
    expect(result.command).toBe("verify-report");
    expect(result.args.positional).toEqual(["report.json"]);
    expect(result.flags["public-key"]).toBe("key.pub");
  });

  it("returns empty command for no args", () => {
    const result = parseArgs([]);
    expect(result.command).toBe("");
    expect(result.args.positional).toEqual([]);
  });

  it("applies flag defaults", () => {
    const flagDefs = [{ name: "json", shortName: "j", type: "boolean" as const, description: "JSON output" }];
    const result = parseArgs(["scan", "https://example.com"], flagDefs);
    expect(result.flags.json).toBeUndefined();
  });

  it("parses short flag alias for boolean", () => {
    const flagDefs = [{ name: "json", shortName: "j", type: "boolean" as const, description: "JSON output" }];
    const result = parseArgs(["scan", "-j", "https://example.com"], flagDefs);
    expect(result.flags.json).toBe(true);
  });

  it("parses short flag alias for string", () => {
    const flagDefs = [{ name: "output", shortName: "o", type: "string" as const, description: "Output path" }];
    const result = parseArgs(["scan", "-o", "report.json", "https://example.com"], flagDefs);
    expect(result.flags.output).toBe("report.json");
  });
});

describe("registerCommand", () => {
  beforeEach(() => {
    clearCommands();
  });

  it("registers a command in the dispatch table", () => {
    const cmd: CommandDefinition = {
      name: "test-cmd",
      description: "Test command",
      args: [],
      flags: [],
      handler: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
    };
    registerCommand(cmd);
    expect(runCommand(["test-cmd"])).resolves.toMatchObject({ exitCode: 0, stdout: "ok" });
  });

  it("rejects duplicate command registration", () => {
    const cmd: CommandDefinition = {
      name: "dup",
      description: "Duplicate",
      args: [],
      flags: [],
      handler: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    };
    registerCommand(cmd);
    expect(() => registerCommand(cmd)).toThrow(/already registered/);
  });
});

describe("runCommand", () => {
  beforeEach(() => {
    clearCommands();
  });

  it("returns error for unknown command", async () => {
    const result = await runCommand(["nonexistent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
    expect(result.stderr).toContain("--help");
  });

  it("returns error for missing required argument", async () => {
    registerCommand({
      name: "scan",
      description: "Scan a URL",
      args: [{ name: "url", required: true, description: "Target URL" }],
      flags: [],
      handler: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    const result = await runCommand(["scan"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing required argument");
    expect(result.stderr).toContain("url");
  });

  it("dispatches to handler with parsed args and flags", async () => {
    let receivedArgs: any = null;
    let receivedFlags: any = null;
    registerCommand({
      name: "scan",
      description: "Scan a URL",
      args: [{ name: "url", required: true, description: "Target URL" }],
      flags: [{ name: "json", shortName: "j", type: "boolean", description: "JSON output" }],
      handler: async (args, flags) => {
        receivedArgs = args;
        receivedFlags = flags;
        return { exitCode: 0, stdout: "done", stderr: "" };
      },
    });
    const result = await runCommand(["scan", "--json", "https://example.com"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("done");
    expect(receivedArgs.positional).toEqual(["https://example.com"]);
    expect(receivedFlags.json).toBe(true);
  });

  it("catches handler errors and returns exit code 1", async () => {
    registerCommand({
      name: "fail",
      description: "Failing command",
      args: [],
      flags: [],
      handler: async () => {
        throw new Error("Something went wrong");
      },
    });
    const result = await runCommand(["fail"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Something went wrong");
  });

  it("handles empty argv", async () => {
    const result = await runCommand([]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
