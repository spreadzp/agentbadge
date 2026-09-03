/**
 * SLICE-98-2: RT-02 — Locate + parse OpenAPI / agent-guide
 *
 * Journey: Fetch and validate machine-readable docs.
 * Proves: Machine-readable docs are actually usable.
 * Safety: read-only
 */

import type { TaskDefinition } from "../task-schema";

export const RT02_DOCS: TaskDefinition = {
  task_id: "RT-02",
  name: "Locate and parse OpenAPI / agent-guide",
  category: "docs",
  steps: [
    { action: "GET /openapi.json", phase: "fetch" },
    { action: "validate-openapi-schema", phase: "parse" },
    { action: "GET /agent-guide.json", phase: "fetch" },
    { action: "validate-guide-schema", phase: "parse" },
  ],
  preconditions: ["RT-01"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 5, max_steps: 10, timeout_ms: 15000 },
};
