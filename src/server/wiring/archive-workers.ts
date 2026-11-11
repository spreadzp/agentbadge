/**
 * SLICE-217-8 + SLICE-217-9: archive workers wiring (EPIC-217).
 *
 * Two jobs on one startArchiveLoop:
 *  - "traffic-daily"  — daily digest message (supersedes O-217-2's
 *    env+hourly check: cursor-based, catch-up one window/tick)
 *  - "traffic-weekly" — weekly rollup JSON document → TG channel
 *    (off-box backup copy outside Fly infra)
 *
 * Guards: jobs register only when TG creds exist AND DATABASE_ENABLED.
 * Oversized weekly (>45MB, TG doc limit 50MB) → alert message instead
 * of the document; the cursor still commits with note=oversized — an
 * un-sendable window must not block the stream forever (recovery via
 * ad-hoc tg-export).
 */

import type {
  ArchiveCursorFacade,
  ArchiveJob,
} from "../lib/report/archive-scheduler";
import { startArchiveLoop } from "../lib/report/archive-scheduler";
import {
  buildExport,
  fetchTrafficRowsInWindow,
  type ExportEventStore,
} from "../lib/report/archive-export";
import { collectStats, formatTelegramReport } from "../lib/report/traffic-format";
import {
  sendTelegramDocument,
  sendTelegramMessage,
  telegramFromEnv,
  type TelegramConfig,
} from "../lib/notify/telegram";

/** TG Bot API sendDocument hard limit is 50MB; alert past 45MB. */
export const OVERSIZE_ALERT_BYTES = 45 * 1024 * 1024;

// ─── Cursor facade resolution ────────────────────────────────────

/** In-memory ArchiveCursorFacade — used while @agentbadge/database
 *  on disk predates 0.6.2 (no archiveCursors field). Cursor resets
 *  per boot → workers re-seed throughAt=now (at-least-once, honest). */
export class InMemoryArchiveCursorFallback implements ArchiveCursorFacade {
  private rows = new Map<string, bigint>();

  async get(stream: string): Promise<{ throughAt: bigint } | null> {
    const t = this.rows.get(stream);
    return t === undefined ? null : { throughAt: t };
  }

  async commit(
    stream: string,
    u: { throughAt: bigint },
  ): Promise<void> {
    this.rows.set(stream, u.throughAt);
  }
}

type ArchiveCursorStoreLike = {
  getCursor(stream: string): Promise<{ throughAt: bigint } | null>;
  commitCursor(
    stream: string,
    commit: {
      throughAt: bigint;
      messageId?: bigint | number | null;
      note?: string | null;
    },
  ): Promise<void>;
};

/**
 * Adapt db.archiveCursors (ArchiveCursorStore, @agentbadge/database
 * ≥0.6.2) to the scheduler's facade. Falls back to in-memory when the
 * installed package predates the field — logs a warn either way.
 */
export function resolveArchiveCursors(
  db: unknown,
  warn: (msg: string) => void = (m) => console.warn(m),
): ArchiveCursorFacade {
  const store = (db as { archiveCursors?: ArchiveCursorStoreLike })
    .archiveCursors;
  if (!store) {
    warn(
      "archive-workers: db.archiveCursors unavailable (database pkg <0.6.2) — in-memory cursor fallback",
    );
    return new InMemoryArchiveCursorFallback();
  }
  return {
    get: (stream) => store.getCursor(stream),
    commit: (stream, u) =>
      store.commitCursor(stream, {
        throughAt: u.throughAt,
        messageId: u.messageId ?? null,
        note: u.note ?? null,
      }),
  };
}

// ─── Jobs ────────────────────────────────────────────────────────

export interface ArchiveWorkersDeps {
  events: ExportEventStore;
  /** TG creds — absent → no jobs registered (caller logs skip-reason). */
  telegram?: TelegramConfig;
  /** Injectable senders (tests). Default: real Bot API calls. */
  sendMessage?: (text: string, cfg: TelegramConfig) => Promise<number>;
  sendDocument?: (
    cfg: TelegramConfig,
    doc: {
      filename: string;
      data: Uint8Array | string;
      caption?: string;
      mimeType?: string;
    },
  ) => Promise<number>;
  /** Test hook — force the oversized path. Default OVERSIZE_ALERT_BYTES. */
  oversizeBytes?: number;
}

/**
 * Build the two archive jobs. Pure composition — no timers, no env.
 * Empty array when TG creds are missing (caller logs the skip).
 */
export function buildArchiveJobs(deps: ArchiveWorkersDeps): ArchiveJob[] {
  const tg = deps.telegram;
  if (!tg) return [];
  const sendMessage = deps.sendMessage ?? sendTelegramMessage;
  const sendDocument = deps.sendDocument ?? sendTelegramDocument;
  const oversizeBytes = deps.oversizeBytes ?? OVERSIZE_ALERT_BYTES;

  const daily: ArchiveJob = {
    stream: "traffic-daily",
    kind: "daily",
    run: async (w) => {
      const rows = await fetchTrafficRowsInWindow(deps.events, w);
      const stats = collectStats(rows, (w.to - w.from) / 3600_000);
      // Header must show the archived window, not "now".
      stats.from = new Date(w.from).toISOString();
      stats.until = new Date(w.to).toISOString();
      const messageId = await sendMessage(formatTelegramReport(stats), tg);
      return { messageId, note: `${stats.total} rows` };
    },
  };

  const weekly: ArchiveJob = {
    stream: "traffic-weekly",
    kind: "weekly",
    run: async (w) => {
      const out = await buildExport(
        { events: deps.events },
        w,
        { stream: "http_traffic" },
      );
      const dates = `${new Date(w.from).toISOString().slice(0, 10)}..${new Date(w.to).toISOString().slice(0, 10)}`;
      if (out.bytes > oversizeBytes) {
        // Un-sendable window: alert instead of the doc, but still
        // return a messageId so the cursor commits with note=oversized
        // (one bad period must not wedge the stream — recover via
        // ad-hoc tg-export).
        const messageId = await sendMessage(
          `#archive stream=http_traffic weekly ${dates} oversized: ${out.bytes}B > 45MB — run tg-export manually`,
          tg,
        );
        return { messageId, note: `oversized ${out.bytes}B` };
      }
      const messageId = await sendDocument(tg, {
        filename: out.filename,
        data: out.data,
        caption: `#archive stream=http_traffic weekly ${dates} rows=${out.rowCount} bytes=${out.bytes}`,
      });
      return { messageId, note: `${out.rowCount} rows, ${out.bytes}B` };
    },
  };

  return [daily, weekly];
}

export interface StartArchiveWorkersDeps extends ArchiveWorkersDeps {
  /** From getConfig().database?.enabled — off → loop not started. */
  databaseEnabled: boolean;
  /** db handle (archiveCursors resolved via resolveArchiveCursors). */
  db: unknown;
  now?: () => number;
  tickMs?: number;
  autoStart?: boolean;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

/**
 * Register archive workers. Returns null (with a logged skip-reason)
 * when TG creds or DATABASE_ENABLED are missing.
 */
export function startArchiveWorkers(deps: StartArchiveWorkersDeps): {
  stop(): void;
  jobs: ArchiveJob[];
} | null {
  const log = deps.log ?? ((m: string) => console.log(m));
  const warn = deps.warn ?? ((m: string) => console.warn(m));

  if (!deps.databaseEnabled) {
    log("archive-workers: skipped (DATABASE_ENABLED off)");
    return null;
  }
  const tg = deps.telegram ?? telegramFromEnv();
  if (!tg) {
    log("archive-workers: skipped (no TELEGRAM_BOT_TOKEN/CHAT_ID)");
    return null;
  }

  const jobs = buildArchiveJobs({ ...deps, telegram: tg });
  const cursors = resolveArchiveCursors(deps.db, warn);
  const loop = startArchiveLoop({
    cursors,
    jobs,
    now: deps.now,
    tickMs: deps.tickMs,
    autoStart: deps.autoStart,
    warn,
  });
  log(`archive-workers: started (${jobs.length} jobs, tick ${deps.tickMs ?? 15 * 60_000}ms)`);
  return { stop: () => loop.stop(), jobs };
}
