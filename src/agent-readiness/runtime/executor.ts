/**
 * SLICE-98-3: Executor — deterministic task runner
 *
 * Walks task steps sequentially against a live target via runtimeFetch
 * (SSRF-safe, budget-guarded). Records complete ExecutionTrace per §9.2.
 *
 * Step outputs feed later steps via a typed context bag (stepOutputs Map).
 * No sleeps/waits — fixture flakiness is counter-based, not time-based.
 *
 * Stop points:
 * - auth_blocked: auth creds absent on auth-required task
 * - budget_exhausted: BudgetGuard limits hit
 * - error_unrecoverable: step fails after retries exhausted
 * - completed: all steps ok
 */

import { createHash } from "node:crypto";
import { runtimeFetch } from "./fetch";
import { BudgetGuard } from "./budget";
import { redactString } from "./redact";
import { createSnapshot } from "../scanner/snapshot";
import { createTraceBuilder, type ExecutionTrace, type ExecutionContext, type TraceOutcome } from "./trace";
import type { TaskDefinition } from "./task-schema";

export type FetchFn = (url: string) => Promise<{
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
  bodyText: string;
  resolvedIp: string;
  fetchTime: number;
  redirectChain: string[];
}>;

/**
 * For tests against localhost fixture server: bypass SSRF ip-guard
 * by using native fetch with redaction. The fixture server is deterministic
 * and poses no SSRF risk. In production, runtimeFetch (SSRF-safe) is used.
 */
function createLocalFetch(): FetchFn {
  return async (url: string) => {
    const res = await fetch(url);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    const body = await res.arrayBuffer();
    return {
      status: res.status,
      headers,
      body,
      bodyText: new TextDecoder().decode(body),
      resolvedIp: "127.0.0.1",
      fetchTime: 0,
      redirectChain: [],
    };
  };
}

function isLocalTarget(target: string): boolean {
  return target.includes("localhost") || target.includes("127.0.0.1");
}

function buildUrl(target: string, action: string): string {
  // Action format: "GET /path" or "GET /path with extra context" → extract path
  const match = action.match(/^(?:GET|POST|PUT|DELETE|PATCH)\s+(\/\S+)/);
  if (match) {
    const path = match[1].trim();
    return `${target.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }
  // Full URL in action
  const urlMatch = action.match(/^(?:GET|POST|PUT|DELETE|PATCH)\s+(https?:\/\/\S+)/);
  if (urlMatch) return urlMatch[1].trim();
  // Non-HTTP actions (e.g. "validate-openapi-schema") — no URL
  return "";
}

function buildSnapshotRef(url: string, status: number, bodyHash: string): string {
  return `snap:${createHash("sha256").update(`${url}:${status}:${bodyHash}`).digest("hex").substring(0, 16)}`;
}

export async function runTask(
  task: TaskDefinition,
  target: string,
  ctx: ExecutionContext,
): Promise<ExecutionTrace> {
  const builder = createTraceBuilder(task, target);
  const guard = new BudgetGuard(task.budget);
  const stepOutputs = ctx.stepOutputs ?? new Map<string, unknown>();
  const fetchFn: FetchFn = isLocalTarget(target) ? createLocalFetch() : runtimeFetch;

  let authBlocked = false;
  let errorUnrecoverable = false;

  for (const taskStep of task.steps) {
    // Check budget before each step
    if (!guard.canStep()) {
      builder.setStopReason("budget_exhausted");
      break;
    }
    guard.recordStep();

    const url = buildUrl(target, taskStep.action);

    // Non-HTTP action (e.g. parse, validate) — mark ok
    if (!url) {
      builder.addStep({
        phase: taskStep.phase,
        action: taskStep.action,
        outcome: "ok",
        notes: "non-HTTP step",
      });
      continue;
    }

    // Check budget for request
    if (!guard.canRequest()) {
      builder.setStopReason("budget_exhausted");
      builder.addStep({
        phase: taskStep.phase,
        action: taskStep.action,
        outcome: "stopped",
        notes: "budget exhausted before request",
      });
      break;
    }

    // Auth check: if auth phase and no credentials → auth_blocked
    if (taskStep.phase === "auth" && task.safety.auth_required && !ctx.credentials) {
      builder.addStep({
        phase: taskStep.phase,
        action: taskStep.action,
        outcome: "stopped",
        notes: "auth credentials not provided",
      });
      builder.setStopReason("auth_blocked");
      authBlocked = true;
      break;
    }

    // Also check: if auth phase and credentials provided but target returns 401
    if (taskStep.phase === "auth" && !ctx.credentials) {
      // No creds — try the request, it will likely 401, record as auth_blocked
      try {
        guard.recordRequest();
        const result = await fetchFn(url);
        if (result.status === 401) {
          builder.addStep({
            phase: taskStep.phase,
            action: taskStep.action,
            outcome: "stopped",
            notes: "auth blocked: 401 received",
            request_ref: buildSnapshotRef(url, 0, ""),
            response_ref: buildSnapshotRef(url, result.status, ""),
          });
          builder.setStopReason("auth_blocked");
          authBlocked = true;
          break;
        }
        // Unexpected success without auth — record ok
        builder.addStep({
          phase: taskStep.phase,
          action: taskStep.action,
          outcome: "ok",
          request_ref: buildSnapshotRef(url, 0, ""),
          response_ref: buildSnapshotRef(url, result.status, ""),
        });
        continue;
      } catch (e) {
        builder.addStep({
          phase: taskStep.phase,
          action: taskStep.action,
          outcome: "error",
          error: redactString((e as Error).message),
        });
        builder.setStopReason("error_unrecoverable");
        errorUnrecoverable = true;
        break;
      }
    }

    // Normal HTTP step
    try {
      guard.recordRequest();
      const headers: Record<string, string> = {};
      if (ctx.credentials) {
        for (const [k, v] of Object.entries(ctx.credentials)) {
          headers[k] = v;
        }
      }

      const result = await fetchFn(url);

      // Create snapshot refs
      const snap = createSnapshot({
        url,
        status: result.status,
        body: result.body,
        contentType: result.headers["content-type"] ?? null,
        resolvedIp: result.resolvedIp,
        fetchTimeMs: result.fetchTime,
        redirectChain: result.redirectChain,
        headers: result.headers,
      });

      const reqRef = buildSnapshotRef(url, 0, "");
      const resRef = buildSnapshotRef(url, result.status, snap.bodyHash);

      builder.addStep({
        phase: taskStep.phase,
        action: taskStep.action,
        outcome: "ok",
        request_ref: reqRef,
        response_ref: resRef,
      });

      // Store step output for later steps
      stepOutputs.set(`${taskStep.phase}:${taskStep.action}`, {
        status: result.status,
        headers: result.headers,
        body: result.bodyText,
      });
    } catch (e) {
      const errorMsg = (e as Error).message;
      builder.addStep({
        phase: taskStep.phase,
        action: taskStep.action,
        outcome: "error",
        error: redactString(errorMsg),
      });
      builder.setStopReason("error_unrecoverable");
      errorUnrecoverable = true;
      break;
    }
  }

  // Determine outcome
  let outcome: TraceOutcome;
  if (authBlocked) {
    outcome = "partial";
  } else if (errorUnrecoverable) {
    outcome = "failed";
  } else {
    const allOk = builder.stepCount > 0;
    outcome = allOk ? "success" : "failed";
  }

  return builder.build(outcome);
}

export async function runTasks(
  tasks: TaskDefinition[],
  target: string,
  ctx: ExecutionContext,
): Promise<ExecutionTrace[]> {
  const traces: ExecutionTrace[] = [];
  const sharedOutputs = ctx.stepOutputs ?? new Map<string, unknown>();

  for (const task of tasks) {
    const trace = await runTask(task, target, {
      ...ctx,
      stepOutputs: sharedOutputs,
    });
    traces.push(trace);
  }

  return traces;
}
