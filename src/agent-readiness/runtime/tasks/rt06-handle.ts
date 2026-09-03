/**
 * SLICE-98-6: RT-06 — Handle error semantics
 *
 * Journey: Send a safe invalid request (bad param value, NOT destructive);
 * observe 4xx body/headers vs declared error semantics.
 * Safety: read-only (invalid params only, no destructive actions)
 */

import type { TaskDefinition } from "../task-schema";

export const RT06_HANDLE: TaskDefinition = {
  task_id: "RT-06",
  name: "Handle error semantics",
  category: "handle",
  steps: [
    { action: "GET /api/v1/status?invalid_param=bad_value", phase: "handle" },
    { action: "observe-error-response", phase: "handle" },
    { action: "compare-error-semantics-vs-declared", phase: "handle" },
  ],
  preconditions: ["RT-05"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 3, max_steps: 10, timeout_ms: 15000 },
};
