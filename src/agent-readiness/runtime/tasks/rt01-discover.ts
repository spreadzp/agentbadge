/**
 * SLICE-98-2: RT-01 — Discover agent entry points
 *
 * Journey: Find llms.txt, agents.txt, well-known agent entries.
 * Proves: An agent can find you at all.
 * Safety: read-only
 */

import type { TaskDefinition } from "../task-schema";

export const RT01_DISCOVER: TaskDefinition = {
  task_id: "RT-01",
  name: "Discover agent entry points",
  category: "discover",
  steps: [
    { action: "GET /llms.txt", phase: "discover" },
    { action: "GET /agents.txt", phase: "discover" },
    { action: "GET /.well-known/ai-plugin.json", phase: "discover" },
  ],
  preconditions: [],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 5, max_steps: 10, timeout_ms: 15000 },
};
