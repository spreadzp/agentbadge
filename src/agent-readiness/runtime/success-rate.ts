/**
 * SLICE-98-6: Agent Success Rate (ASR) computation
 *
 * Pure function over ExecutionTrace[]. Per spec §9.5:
 *   ASR = successful_tasks / tested_tasks
 *
 * Partial bucket is explicit — not silently failed.
 * Per-category breakdown for: discover, docs, auth, construct, call,
 * handle, observe, version.
 *
 * ASR is reported BESIDE the static score, never folded into it.
 */

import type { ExecutionTrace } from "./trace";
import type { TaskCategory } from "./task-schema";

export interface AsrResult {
  total: number;
  successful: number;
  failed: number;
  partial: number;
  asr: number;
  per_category: Record<string, CategoryAsr>;
}

export interface CategoryAsr {
  total: number;
  successful: number;
  failed: number;
  partial: number;
  asr: number;
}

const CATEGORIES: TaskCategory[] = [
  "discover",
  "docs",
  "auth",
  "construct",
  "call",
  "handle",
  "observe",
  "version",
];

function round(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function computeCategoryAsr(traces: ExecutionTrace[]): CategoryAsr {
  const total = traces.length;
  const successful = traces.filter((t) => t.outcome === "success").length;
  const failed = traces.filter((t) => t.outcome === "failed").length;
  const partial = traces.filter((t) => t.outcome === "partial").length;
  return {
    total,
    successful,
    failed,
    partial,
    asr: total > 0 ? round(successful / total) : 0,
  };
}

export function computeAsr(traces: ExecutionTrace[]): AsrResult {
  const total = traces.length;
  const successful = traces.filter((t) => t.outcome === "success").length;
  const failed = traces.filter((t) => t.outcome === "failed").length;
  const partial = traces.filter((t) => t.outcome === "partial").length;

  const per_category: Record<string, CategoryAsr> = {};

  for (const cat of CATEGORIES) {
    const catTraces = traces.filter((t) => {
      // Extract category from task_id prefix (RT-01 → discover, etc.)
      // We use the trace's task_id to look up the category from the task definition
      // But since we only have traces here, we use a mapping based on the task_id
      return getCategoryFromTrace(t) === cat;
    });
    if (catTraces.length > 0) {
      per_category[cat] = computeCategoryAsr(catTraces);
    }
  }

  return {
    total,
    successful,
    failed,
    partial,
    asr: total > 0 ? round(successful / total) : 0,
    per_category,
  };
}

// Map task_id to category — this is the deterministic mapping from the task library
const TASK_CATEGORY_MAP: Record<string, TaskCategory> = {
  "RT-01": "discover",
  "RT-02": "docs",
  "RT-03": "auth",
  "RT-04": "construct",
  "RT-05": "call",
  "RT-06": "handle",
  "RT-07": "observe",
  "RT-08": "version",
};

function getCategoryFromTrace(trace: ExecutionTrace): TaskCategory | undefined {
  return TASK_CATEGORY_MAP[trace.task_id];
}
