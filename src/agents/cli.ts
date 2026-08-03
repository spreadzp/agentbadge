/**
 * SLICE-26-12: Agent CLI Runner
 * CLI script to run the medical agent end-to-end.
 * Config via env vars. Polls marketplace or runs specific task.
 */

import type { MedicalAgentConfig } from "./types";

export interface CliArgs {
  taskId?: string;
  capability?: string;
}

export type CliConfig = MedicalAgentConfig;

export interface CliOptions {
  taskId?: string;
  capability?: string;
}

export interface CliRunResult {
  exitCode: number;
  message: string;
}

export interface RunCliParams {
  config: CliConfig;
  options: CliOptions;
  runTask: (taskId: string) => Promise<{ completed: boolean; attempts: number }>;
  pollTask?: () => Promise<string | null>;
}

/**
 * Parse command-line arguments.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { capability: "medical-analysis" };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg.startsWith("--task-id=")) {
      args.taskId = arg.slice("--task-id=".length);
    } else if (arg === "--task-id" && i + 1 < argv.length) {
      args.taskId = argv[++i];
    } else if (arg.startsWith("--capability=")) {
      args.capability = arg.slice("--capability=".length);
    }
  }

  return args;
}

/**
 * Load agent configuration from environment variables.
 * Throws descriptive error if required vars are missing.
 */
export function loadCliConfig(): CliConfig {
  const did = process.env.AGENT_DID;
  const accountId = process.env.AGENT_ACCOUNT_ID;
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  const tier = process.env.AGENT_TIER ?? "bronze";

  if (!did) throw new Error("AGENT_DID environment variable is required");
  if (!accountId) throw new Error("AGENT_ACCOUNT_ID environment variable is required");
  if (!privateKey) throw new Error("AGENT_PRIVATE_KEY environment variable is required");

  return {
    did,
    accountId,
    privateKey,
    tier,
    capabilities: ["medical-analysis"],
    datahubGmsUrl: process.env.DATAHUB_GMS_URL,
    hfsFileId: process.env.HFS_FILE_ID,
  };
}

/**
 * Run the CLI agent lifecycle.
 * Returns exit code and message.
 */
export async function runCli(params: RunCliParams): Promise<CliRunResult> {
  const { config, options, runTask, pollTask } = params;

  console.log(`[MedicalAgent] Starting... (DID: ${config.did}, tier: ${config.tier})`);

  let taskId = options.taskId;

  // If no task-id provided, poll marketplace
  if (!taskId) {
    if (!pollTask) {
      return { exitCode: 1, message: "No pollTask function provided and no --task-id given" };
    }

    console.log(`[MedicalAgent] Polling marketplace for ${options.capability ?? "medical-analysis"} tasks...`);
    taskId = (await pollTask()) ?? undefined;

    if (!taskId) {
      console.log("[MedicalAgent] No available tasks found. Exiting.");
      return { exitCode: 1, message: "No available tasks" };
    }

    console.log(`[MedicalAgent] Claimed task: ${taskId}`);
  } else {
    console.log(`[MedicalAgent] Running specific task: ${taskId}`);
  }

  // Run the task
  const startTime = Date.now();
  try {
    const result = await runTask(taskId);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    if (result.completed) {
      console.log(`[MedicalAgent] Done. Task completed in ${elapsed}s (${result.attempts} attempt(s)).`);
      return { exitCode: 0, message: `Task completed in ${elapsed}s` };
    } else {
      console.log(`[MedicalAgent] Aborted after ${result.attempts} attempt(s) in ${elapsed}s.`);
      return { exitCode: 1, message: `Task aborted after ${result.attempts} attempts` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[MedicalAgent] Error after ${elapsed}s: ${msg}`);
    return { exitCode: 1, message: `Error: ${msg}` };
  }
}

/**
 * Main entry point for CLI execution.
 */
async function main() {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const config = loadCliConfig();
    const result = await runCli({
      config,
      options: args,
      // In real usage, these would be wired to MedicalAgent + marketplace
      runTask: async (_taskId: string) => {
        throw new Error("runTask not configured — use MedicalAgent.run()");
      },
    });
    process.exit(result.exitCode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MedicalAgent] Fatal: ${msg}`);
    process.exit(1);
  }
}

// Run main if executed directly
if (import.meta.main) {
  main();
}
