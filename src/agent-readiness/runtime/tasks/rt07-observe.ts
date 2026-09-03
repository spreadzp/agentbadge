/**
 * SLICE-98-6: RT-07 — Observe rate-limit headers
 *
 * Journey: Read rate-limit headers (X-RateLimit, RateLimit) on normal
 * responses only. Observe-only — never trip or deliberately cause 429.
 * Compare vs declared rate limits (feeds 98-5 rate-limit rule).
 * Safety: read-only, observe-only (no extra requests beyond normal calls)
 */

import type { TaskDefinition } from "../task-schema";

export const RT07_OBSERVE: TaskDefinition = {
  task_id: "RT-07",
  name: "Observe rate-limit headers",
  category: "observe",
  steps: [
    { action: "GET /api/v1/status", phase: "observe" },
    { action: "read-rate-limit-headers", phase: "observe" },
    { action: "compare-vs-declared-limits", phase: "observe" },
  ],
  preconditions: ["RT-05"],
  safety: { mode: "read_only", auth_required: false },
  budget: { max_requests: 1, max_steps: 5, timeout_ms: 10000 },
};
