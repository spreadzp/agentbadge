/**
 * SLICE-98-2: RT-03 — Apply declared auth scheme
 *
 * Journey: Apply the DECLARED auth scheme (no creds → trace records the stop
 * point; with creds → verify it works).
 * Proves: Declared auth matches reality.
 * Safety: read-only
 */

import type { TaskDefinition } from "../task-schema";

export const RT03_AUTH: TaskDefinition = {
  task_id: "RT-03",
  name: "Apply declared auth scheme",
  category: "auth",
  steps: [
    { action: "read-declared-auth-from-openapi", phase: "prepare" },
    { action: "GET /api/v1/protected with declared auth", phase: "auth" },
  ],
  preconditions: ["RT-02"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 3, max_steps: 5, timeout_ms: 10000 },
};
