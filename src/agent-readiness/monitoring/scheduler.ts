/**
 * SLICE-99-3: Restart-safe tick-loop scheduler per spec v0.7 §10.6.
 *
 * - Due selection: enabled projects with next_run_at <= now
 * - Per-project lock: one in-flight run per project
 * - next_run computation: daily/weekly, strictly future, UTC only
 * - Error isolation: one project failure doesn't kill the loop
 * - Restart safety: due selection is pure over persisted next_run_at
 * - Single-writer: sequential per-tick execution (politeness to targets)
 *
 * No scan code here — run callback is injected (99-4 supplies the real pipeline).
 */

import type { MonitoringStore } from "./monitoring-store";
import type { MonitoredProject, ScheduleConfig } from "./monitoring-types";

export interface RunOutcome {
  outcome: "ok" | "error";
  error?: string;
}

export interface SchedulerDeps {
  store: MonitoringStore;
  now: () => Date;
  onDueProject: (project: MonitoredProject, trigger: "scheduled" | "manual") => Promise<RunOutcome>;
  tickIntervalMs?: number;
}

/**
 * Pure function: compute next run time from schedule + current time.
 * Always returns a strictly future timestamp. UTC only.
 */
export function computeNextRun(schedule: ScheduleConfig, from: Date): Date {
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);

  if (schedule.kind === "daily") {
    next.setUTCHours(schedule.hour_utc, 0, 0, 0);
    if (next <= from) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
  } else {
    // weekly
    const targetDay = schedule.day_of_week ?? 0;
    next.setUTCHours(schedule.hour_utc, 0, 0, 0);
    const currentDay = next.getUTCDay();
    let daysUntil = targetDay - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= from) {
      daysUntil = 7;
    }
    if (daysUntil > 0) {
      next.setUTCDate(next.getUTCDate() + daysUntil);
    }
  }

  return next;
}

export interface Scheduler {
  tick(): Promise<void>;
  triggerManualRun(project_id: string): Promise<RunOutcome>;
  stop(): void;
}

export function startMonitoringScheduler(deps: SchedulerDeps): Scheduler {
  const { store, now, onDueProject } = deps;
  const tickIntervalMs = deps.tickIntervalMs ?? 60_000;

  const runningProjects = new Set<string>();
  let timerHandle: ReturnType<typeof setInterval> | null = null;

  async function executeRun(project: MonitoredProject, trigger: "scheduled" | "manual"): Promise<RunOutcome> {
    if (runningProjects.has(project.project_id)) {
      return { outcome: "error", error: `Project ${project.project_id} already running` };
    }

    runningProjects.add(project.project_id);
    try {
      const result = await onDueProject(project, trigger);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { outcome: "error", error: msg };
    } finally {
      runningProjects.delete(project.project_id);
    }
  }

  function advanceNextRun(project: MonitoredProject): void {
    const nextRun = computeNextRun(project.schedule, now());
    store.upsertProject({
      ...project,
      next_run_at: nextRun.toISOString(),
      updated_at: now().toISOString(),
    });
  }

  async function tick(): Promise<void> {
    const currentTime = now();
    const projects = store.listProjects();
    const due = projects.filter(
      (p) => p.enabled && new Date(p.next_run_at) <= currentTime,
    );

    for (const project of due) {
      const result = await executeRun(project, "scheduled");
      // Always advance next_run_at, even on error (no backlog chasing)
      advanceNextRun(project);
    }
  }

  async function triggerManualRun(project_id: string): Promise<RunOutcome> {
    const project = store.getProject(project_id);
    if (!project) {
      return { outcome: "error", error: `Project ${project_id} not found` };
    }

    const result = await executeRun(project, "manual");
    // Manual runs don't advance next_run_at (only scheduled runs do)
    return result;
  }

  function stop(): void {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  // Start the tick loop
  timerHandle = setInterval(() => {
    tick().catch(() => {
      // Error isolation — loop stays alive
    });
  }, tickIntervalMs);

  return { tick, triggerManualRun, stop };
}
