/**
 * SLICE-98-6: RT-04 — Construct a valid request from parsed spec
 *
 * Journey: Pick first read endpoint from RT-02's parsed OpenAPI; build a
 * valid request (path, params, content-type). Proves spec sufficiency.
 * Safety: read-only
 */

import type { TaskDefinition } from "../task-schema";

export const RT04_CONSTRUCT: TaskDefinition = {
  task_id: "RT-04",
  name: "Construct valid request from spec",
  category: "construct",
  steps: [
    { action: "read-parsed-openapi-spec", phase: "construct" },
    { action: "select-first-read-endpoint", phase: "construct" },
    { action: "build-request-from-spec", phase: "construct" },
  ],
  preconditions: ["RT-02"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 2, max_steps: 10, timeout_ms: 15000 },
};
