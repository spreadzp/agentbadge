/**
 * SLICE-98-7: `agentbadge runtime <url>` — Runtime Test Command
 *
 * Opt-in command that runs runtime tasks (RT-01..RT-08) against a target URL.
 * Never invoked by default scan — safety property (D3).
 *
 * Flags:
 *   --tasks <ids>      Comma-separated task IDs (default: all 8)
 *   --budget-requests N  Max requests per task
 *   --timeout-ms N     Per-task timeout
 *   --creds-env VAR    Environment variable name holding credentials (never value on argv)
 *   --json             JSON output to stdout
 *   --with-scan        Also run static scan, merge comparison assertions
 */

import {
  registerCommand,
  type CommandResult,
  type ParsedArgs,
  type ParsedFlags,
} from "../router";
import { runTasks } from "../../runtime/executor";
import { computeAsr } from "../../runtime/success-rate";
import type { ExecutionTrace } from "../../runtime/trace";
import type { TaskDefinition } from "../../runtime/task-schema";
import { RT01_DISCOVER } from "../../runtime/tasks/rt01-discover";
import { RT02_DOCS } from "../../runtime/tasks/rt02-docs";
import { RT03_AUTH } from "../../runtime/tasks/rt03-auth";
import { RT04_CONSTRUCT } from "../../runtime/tasks/rt04-construct";
import { RT05_CALL } from "../../runtime/tasks/rt05-call";
import { RT06_HANDLE } from "../../runtime/tasks/rt06-handle";
import { RT07_OBSERVE } from "../../runtime/tasks/rt07-observe";
import { RT08_VERSION } from "../../runtime/tasks/rt08-version";

const ALL_TASKS: TaskDefinition[] = [
  RT01_DISCOVER,
  RT02_DOCS,
  RT03_AUTH,
  RT04_CONSTRUCT,
  RT05_CALL,
  RT06_HANDLE,
  RT07_OBSERVE,
  RT08_VERSION,
];

const TASK_MAP: Record<string, TaskDefinition> = {
  "RT-01": RT01_DISCOVER,
  "RT-02": RT02_DOCS,
  "RT-03": RT03_AUTH,
  "RT-04": RT04_CONSTRUCT,
  "RT-05": RT05_CALL,
  "RT-06": RT06_HANDLE,
  "RT-07": RT07_OBSERVE,
  "RT-08": RT08_VERSION,
};

const RUNTIME_FLAGS = [
  { name: "tasks", shortName: "", type: "string" as const, description: "Comma-separated task IDs (e.g. RT-01,RT-03). Default: all 8 tasks" },
  { name: "budget-requests", shortName: "", type: "string" as const, description: "Max HTTP requests per task" },
  { name: "timeout-ms", shortName: "", type: "string" as const, description: "Per-task timeout in milliseconds" },
  { name: "creds-env", shortName: "", type: "string" as const, description: "Environment variable name containing credentials (value never on argv)" },
  { name: "json", shortName: "j", type: "boolean" as const, description: "Output JSON to stdout" },
  { name: "with-scan", shortName: "", type: "boolean" as const, description: "Also run static scan and merge comparison assertions" },
];

interface RuntimeJsonResult {
  traces: Array<{
    task_id: string;
    target: string;
    outcome: string;
    stop_reason?: string;
    steps: number;
    requests: number;
  }>;
  asr: {
    total: number;
    successful: number;
    failed: number;
    partial: number;
    asr: number;
    per_category: Record<string, { total: number; successful: number; failed: number; partial: number; asr: number }>;
  };
  conflicts?: Array<{ rule_id: string; status: string; reason: string }>;
}

function parseTasks(tasksFlag: string | undefined): TaskDefinition[] {
  if (!tasksFlag) return ALL_TASKS;
  const ids = tasksFlag.split(",").map((s) => s.trim().toUpperCase());
  const tasks: TaskDefinition[] = [];
  for (const id of ids) {
    const task = TASK_MAP[id];
    if (task) tasks.push(task);
  }
  return tasks.length > 0 ? tasks : ALL_TASKS;
}

function isEnvVarName(name: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/i.test(name);
}

function formatPretty(traces: ExecutionTrace[], asrResult: ReturnType<typeof computeAsr>): string {
  const lines: string[] = [];

  for (const trace of traces) {
    const status = trace.outcome.toUpperCase();
    const stopInfo = trace.stop_reason ? ` — stopped: ${trace.stop_reason}` : "";
    const stepCount = trace.steps.length;
    const lastStep = trace.steps[trace.steps.length - 1];
    const stepInfo = lastStep ? ` (step ${lastStep.seq}/${stepCount}: ${lastStep.action})` : "";
    lines.push(`[${status}] ${trace.task_id}${stopInfo}${stepInfo}`);
  }

  lines.push("");
  const pct = (asrResult.asr * 100).toFixed(1);
  lines.push(`Agent Success Rate: ${asrResult.successful}/${asrResult.total} (${pct}%)`);

  if (asrResult.partial > 0) {
    lines.push(`  Partial: ${asrResult.partial} · Failed: ${asrResult.failed}`);
  }

  return lines.join("\n");
}

function formatJson(traces: ExecutionTrace[], asrResult: ReturnType<typeof computeAsr>): string {
  const result: RuntimeJsonResult = {
    traces: traces.map((t) => ({
      task_id: t.task_id,
      target: t.target,
      outcome: t.outcome,
      stop_reason: t.stop_reason,
      steps: t.steps.length,
      requests: t.steps.filter((s) => s.response_ref).length,
    })),
    asr: {
      total: asrResult.total,
      successful: asrResult.successful,
      failed: asrResult.failed,
      partial: asrResult.partial,
      asr: asrResult.asr,
      per_category: asrResult.per_category,
    },
  };
  return JSON.stringify(result, null, 2);
}

async function runtimeHandler(
  args: ParsedArgs,
  flags: ParsedFlags,
): Promise<CommandResult> {
  const target = args.positional?.[0];
  if (!target) {
    return { exitCode: 1, stdout: "", stderr: "Usage: agentbadge runtime <url>\n" };
  }

  const budgetRequests = flags["budget-requests"] ? parseInt(flags["budget-requests"] as string, 10) : undefined;
  const timeoutMs = flags["timeout-ms"] ? parseInt(flags["timeout-ms"] as string, 10) : undefined;

  let tasks = parseTasks(flags.tasks as string | undefined);
  if (budgetRequests !== undefined || timeoutMs !== undefined) {
    tasks = tasks.map((t) => ({
      ...t,
      budget: {
        ...t.budget,
        max_requests: budgetRequests ?? t.budget.max_requests,
        timeout_ms: timeoutMs ?? t.budget.timeout_ms,
      },
    }));
  }

  const credsEnv = flags["creds-env"] as string | undefined;
  if (credsEnv) {
    if (!isEnvVarName(credsEnv)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Error: --creds-env must be an environment variable name (e.g. API_KEY), not a value. Got: "${credsEnv}"\n`,
      };
    }
  }

  const ctx = {
    credentials: credsEnv ? { [credsEnv]: process.env[credsEnv] ?? "" } : {},
    stepOutputs: new Map<string, unknown>(),
  };

  const traces = await runTasks(tasks, target, ctx);
  const asrResult = computeAsr(traces);

  const isJson = flags.json === true;
  const output = isJson ? formatJson(traces, asrResult) : formatPretty(traces, asrResult);

  return { exitCode: 0, stdout: output + "\n", stderr: "" };
}

export function registerRuntimeCommand(): void {
  registerCommand({
    name: "runtime",
    description: "Run runtime agent-readiness tests (RT-01..RT-08) against a target URL. Opt-in — never runs in default scan.",
    args: [{ name: "url", description: "Target URL to test", required: true }],
    flags: RUNTIME_FLAGS,
    handler: runtimeHandler,
  });
}
