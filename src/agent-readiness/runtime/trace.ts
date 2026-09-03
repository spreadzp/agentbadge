/**
 * SLICE-98-3: ExecutionTrace types + builder per spec §9.2
 *
 * ExecutionTrace is the first-class output of a single task execution.
 * Snapshot refs only (never inlined bodies). trace_id is deterministic.
 */

import { createHash } from "node:crypto";
import type { TaskDefinition } from "./task-schema";

export type TraceOutcome = "success" | "partial" | "failed";
export type StopReason =
  | "completed"
  | "auth_blocked"
  | "error_unrecoverable"
  | "budget_exhausted"
  | "timeout";

export type StepOutcome = "ok" | "error" | "stopped";

export interface TraceStep {
  seq: number;
  phase: string;
  action: string;
  request_ref?: string;
  response_ref?: string;
  outcome: StepOutcome;
  error?: string;
  retry_of?: number;
  notes?: string;
}

export interface ExecutionTrace {
  trace_id: string;
  target: string;
  task_id: string;
  started_at: string;
  duration_ms: number;
  steps: TraceStep[];
  outcome: TraceOutcome;
  stop_reason: StopReason;
}

export interface ExecutionContext {
  credentials?: Record<string, string>;
  stepOutputs?: Map<string, unknown>;
}

export function buildTraceId(target: string, task_id: string): string {
  return createHash("sha256")
    .update(`${target}:${task_id}`)
    .digest("hex")
    .substring(0, 16);
}

export function createTraceBuilder(task: TaskDefinition, target: string) {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const steps: TraceStep[] = [];
  let seqCounter = 0;
  let stopReason: StopReason | null = null;

  return {
    addStep(step: Omit<TraceStep, "seq">): TraceStep {
      seqCounter++;
      const fullStep: TraceStep = { seq: seqCounter, ...step };
      steps.push(fullStep);
      return fullStep;
    },
    setStopReason(reason: StopReason) {
      stopReason = reason;
    },
    build(outcome: TraceOutcome): ExecutionTrace {
      return {
        trace_id: buildTraceId(target, task.task_id),
        target,
        task_id: task.task_id,
        started_at: startedAt,
        duration_ms: Date.now() - startTime,
        steps: [...steps],
        outcome,
        stop_reason: stopReason ?? "completed",
      };
    },
    get stepCount() {
      return seqCounter;
    },
  };
}
