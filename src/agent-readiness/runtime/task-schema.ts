/**
 * SLICE-98-2: Task model — TaskDefinition types per spec §9.1
 *
 * Validation: unknown category / budget ≤ 0 → load-time fail.
 */

export type TaskCategory =
  | "discover"
  | "docs"
  | "auth"
  | "construct"
  | "call"
  | "handle"
  | "observe"
  | "version";

export type SafetyMode = "read_only" | "mutating";

export interface TaskSafety {
  mode: SafetyMode;
  auth_required: boolean;
}

export interface TaskBudget {
  max_requests: number;
  max_steps: number;
  timeout_ms: number;
}

export interface TaskStep {
  action: string;
  phase: string;
}

export interface TaskDefinition {
  task_id: string;
  name: string;
  category: TaskCategory;
  steps: TaskStep[];
  preconditions?: string[];
  safety: TaskSafety;
  budget: TaskBudget;
}

const VALID_CATEGORIES: readonly TaskCategory[] = [
  "discover",
  "docs",
  "auth",
  "construct",
  "call",
  "handle",
  "observe",
  "version",
];

const VALID_MODES: readonly SafetyMode[] = ["read_only", "mutating"];

export function validateTaskDefinition(task: unknown): asserts task is TaskDefinition {
  if (typeof task !== "object" || task === null) {
    throw new Error("TaskDefinition must be an object");
  }
  const t = task as Record<string, unknown>;

  if (typeof t.task_id !== "string" || t.task_id.length === 0) {
    throw new Error("TaskDefinition: task_id is required and must be a non-empty string");
  }
  if (typeof t.name !== "string" || t.name.length === 0) {
    throw new Error("TaskDefinition: name is required");
  }
  if (typeof t.category !== "string" || !VALID_CATEGORIES.includes(t.category as TaskCategory)) {
    throw new Error(
      `TaskDefinition: category must be one of ${VALID_CATEGORIES.join(", ")}, got: ${t.category}`,
    );
  }
  if (!Array.isArray(t.steps)) {
    throw new Error("TaskDefinition: steps must be an array");
  }

  const safety = t.safety as Record<string, unknown> | undefined;
  if (typeof safety !== "object" || safety === null) {
    throw new Error("TaskDefinition: safety is required");
  }
  if (typeof safety.mode !== "string" || !VALID_MODES.includes(safety.mode as SafetyMode)) {
    throw new Error(
      `TaskDefinition: safety.mode must be one of ${VALID_MODES.join(", ")}, got: ${safety.mode}`,
    );
  }
  if (typeof safety.auth_required !== "boolean") {
    throw new Error("TaskDefinition: safety.auth_required must be a boolean");
  }

  const budget = t.budget as Record<string, unknown> | undefined;
  if (typeof budget !== "object" || budget === null) {
    throw new Error("TaskDefinition: budget is required");
  }
  if (typeof budget.max_requests !== "number" || budget.max_requests <= 0) {
    throw new Error("TaskDefinition: budget.max_requests must be a positive number");
  }
  if (typeof budget.max_steps !== "number" || budget.max_steps <= 0) {
    throw new Error("TaskDefinition: budget.max_steps must be a positive number");
  }
  if (typeof budget.timeout_ms !== "number" || budget.timeout_ms <= 0) {
    throw new Error("TaskDefinition: budget.timeout_ms must be a positive number");
  }
}
