/**
 * EPIC-232 (D-232-8): env-gated drain interval service — off when
 * the ai section is absent (AI_AUTOMATION_ENABLED unset) or
 * AI_WORKER_ENABLED=0/false. Interval via AI_WORKER_INTERVAL_MS
 * (default 5s). Split from worker.ts (300-line cap).
 */

import { getConfig } from "../../../config/env";
import { drainAiJobs } from "./worker";

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function startAiWorker(): void {
  const cfg = getConfig().ai;
  if (!cfg?.enabled || !cfg.workerEnabled) return;
  if (_timer) return;
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    drainAiJobs()
      .then((r) => {
        if (r.errors.length) {
          console.warn("[ai-worker]", r.errors.join(" | "));
        }
      })
      .catch((e) => console.error("[ai-worker] drain error", e))
      .finally(() => {
        _running = false;
      });
  }, cfg.workerIntervalMs);
  if (typeof _timer.unref === "function") _timer.unref();
}

/** Test/shutdown hook. */
export function stopAiWorker(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
