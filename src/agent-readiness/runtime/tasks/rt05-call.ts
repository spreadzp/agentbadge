/**
 * SLICE-98-6: RT-05 — Call the constructed request
 *
 * Journey: Execute the request built in RT-04; check response vs declared
 * schema (conformance fact feeds 98-5's schema rule).
 * Safety: read-only
 */

import type { TaskDefinition } from "../task-schema";

export const RT05_CALL: TaskDefinition = {
  task_id: "RT-05",
  name: "Execute constructed request",
  category: "call",
  steps: [
    { action: "GET /api/v1/status", phase: "call" },
    { action: "validate-response-against-schema", phase: "call" },
  ],
  preconditions: ["RT-04"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 3, max_steps: 10, timeout_ms: 15000 },
};
