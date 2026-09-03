/**
 * SLICE-98-6: RT-08 — Version check
 *
 * Journey: Call versioned endpoint / read Sunset-Deprecation headers;
 * compare vs declared versioning.
 * Safety: read-only
 */

import type { TaskDefinition } from "../task-schema";

export const RT08_VERSION: TaskDefinition = {
  task_id: "RT-08",
  name: "Version check",
  category: "version",
  steps: [
    { action: "GET /api/v1/status", phase: "version" },
    { action: "read-sunset-deprecation-headers", phase: "version" },
    { action: "compare-vs-declared-versioning", phase: "version" },
  ],
  preconditions: ["RT-05"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 2, max_steps: 8, timeout_ms: 10000 },
};
