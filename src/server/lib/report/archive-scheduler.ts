/**
 * SLICE-217-7: Archive run-scheduler core (EPIC-217, D-217-8).
 *
 * Restart-safe "one stream — one window per tick" orchestrator.
 * Knows nothing about Telegram or export building — a job supplies
 * `run(window)`; the loop supplies window math + cursor commit.
 *
 * Invariants:
 *  - Cursor commits ONLY after `run` resolves (at-least-once). A throw
 *    leaves the cursor behind → the same window retries next tick.
 *  - Backlog drains one window per job per tick — TG politeness
 *    (~1 msg/tick/stream), no burst storms after deploy/downtime.
 *  - 15-min tick + persisted cursor = restart-safe; never `setInterval(24h)`
 *    (a deploy resets the phase and the window slides).
 *  - Per-job error isolation (sweeper pattern) — one job's failure
 *    can't starve or kill the others.
 *  - Timer `.unref()` — the loop never keeps the process alive.
 *  - Not started by the loop itself when DB/TG creds are absent —
 *    callers gate registration (workers wire jobs only when enabled).
 */

import { computeWindow, type ArchiveWindow, type StreamKind } from "./archive-window";

export type { ArchiveWindow } from "./archive-window";

/** Minimal cursor surface — satisfied by ArchiveCursorStore (DB pkg). */
export interface ArchiveCursorFacade {
  get(stream: string): Promise<{ throughAt: bigint } | null>;
  commit(
    stream: string,
    update: {
      throughAt: bigint;
      messageId?: number | bigint | null;
      note?: string | null;
    },
  ): Promise<void>;
}

export interface ArchiveJob {
  /** Cursor stream key — "traffic-daily" | "traffic-weekly" | custom. */
  stream: string;
  kind: StreamKind;
  /**
   * Hour-of-day (UTC, 0–23) at which a closed window becomes sendable:
   * a window is due when `now >= window.to + sendAtUtcHour*3600_000`.
   * Yesterday's daily digest therefore lands at e.g. 10:00 UTC today;
   * the Mon–Sun weekly closes Mon 00:00 and sends Mon 10:00 — the
   * once-per-week gate falls out of the weekly window boundary itself.
   * Default 0 = send as soon as the window closes (legacy behavior).
   */
  sendAtUtcHour?: number;
  /**
   * Sends/built-and-sends one window. Resolves → cursor commits
   * `window.to`. Rejects → cursor untouched, window retries next tick.
   */
  run: (w: ArchiveWindow) => Promise<{ messageId?: number; note?: string }>;
}

export interface ArchiveLoopDeps {
  cursors: ArchiveCursorFacade;
  jobs: ArchiveJob[];
  /** Injectable clock — epoch ms. */
  now?: () => number;
  /** Tick period; default 15 min (restart-safe cadence). */
  tickMs?: number;
  /** Start the interval timer immediately (default true; tests use false + tick()). */
  autoStart?: boolean;
  /** Warn sink for job failures (default console.warn). */
  warn?: (msg: string) => void;
}

export interface ArchiveLoop {
  /** Run one scheduler tick manually (also what the timer calls). */
  tick(): Promise<void>;
  stop(): void;
}

export function startArchiveLoop(deps: ArchiveLoopDeps): ArchiveLoop {
  const now = deps.now ?? (() => Date.now());
  const tickMs = deps.tickMs ?? 15 * 60_000;
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const autoStart = deps.autoStart !== false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runJob(job: ArchiveJob): Promise<void> {
    const cursor = await deps.cursors.get(job.stream);
    const cursorThrough = cursor ? cursor.throughAt : null;
    const w = computeWindow(
      job.kind,
      cursorThrough === null ? null : Number(cursorThrough),
      now(),
    );
    if (!w) return;
    // Time-of-day gate: a just-closed window holds until the configured
    // send hour. Lagging windows (cursor behind) are already past it —
    // catch-up drains unchanged, one window per tick.
    const dueAt = w.to + (job.sendAtUtcHour ?? 0) * 3_600_000;
    if (now() < dueAt) return;

    const res = await job.run(w);
    // Commit-after-send: reaching here means run() resolved.
    await deps.cursors.commit(job.stream, {
      throughAt: BigInt(w.to),
      messageId: res.messageId ?? null,
      note: res.note ?? null,
    });
  }

  async function tick(): Promise<void> {
    for (const job of deps.jobs) {
      try {
        await runJob(job);
      } catch (err) {
        // Error isolation — cursor not committed, next tick retries.
        const msg = err instanceof Error ? err.message : String(err);
        warn(`archive-scheduler: job "${job.stream}" failed: ${msg}`);
      }
    }
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  if (autoStart) {
    timer = setInterval(() => {
      tick().catch((e) => warn(`archive-scheduler: tick error: ${e}`));
    }, tickMs);
    timer.unref();
  }

  return { tick, stop };
}
