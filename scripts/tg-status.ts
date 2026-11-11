/**
 * SLICE-217-11: tg-status — archive pipeline status, read-only.
 *
 *   bun scripts/tg-status.ts
 *
 * Prints one row per archive stream: committed cursor (throughAt,
 * lastMessageId, note) + the NEXT window computeWindow would pick on
 * the next tick ("due" or "next due at <ts>") + a row estimate for
 * that window (paged count over http_traffic events).
 *
 * Read-only: never sends, never commits — cursor writes stay with the
 * worker (217-7). No TG creds required.
 *
 * Env: DATABASE_ENABLED=1 + DATABASE_URL (fly proxy — see tg-export).
 */

import { computeWindow, type ArchiveWindow, type StreamKind } from "../src/server/lib/report/archive-window";
import { fetchTrafficRowsInWindow, type ExportEventStore } from "../src/server/lib/report/archive-export";
import { getDatabase } from "../src/server/lib/database";
import { resolveArchiveCursors } from "../src/server/wiring/archive-workers";

/** Streams the archive loop owns (extend when 217-12 lands). */
export const ARCHIVE_STREAMS: Array<{ stream: string; kind: StreamKind }> = [
  { stream: "traffic-daily", kind: "daily" },
  { stream: "traffic-weekly", kind: "weekly" },
];

export interface StatusRow {
  stream: string;
  throughAt: string;
  messageId: string;
  note: string;
  nextWindow: string;
  due: string;
  rows: number;
}

export function formatStatusTable(rows: StatusRow[]): string {
  const head = "stream            throughAt                msgId  note           next window               due                                    rows";
  const line = (r: StatusRow) =>
    `${r.stream.padEnd(17)} ${r.throughAt.padEnd(24)} ${r.messageId.padEnd(6)} ${r.note.padEnd(14)} ${r.nextWindow.padEnd(25)} ${r.due.padEnd(38)} ${r.rows}`;
  return [head, ...rows.map(line)].join("\n");
}

export interface TgStatusDeps {
  cursors: { get(stream: string): Promise<{ throughAt: bigint; messageId?: unknown; note?: unknown } | null> };
  events: ExportEventStore;
  streams?: Array<{ stream: string; kind: StreamKind }>;
  now?: () => number;
  out?: (msg: string) => void;
}

const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => iso(ms).slice(0, 10);

export async function runTgStatus(
  _argv: string[],
  deps: TgStatusDeps,
): Promise<number> {
  const out = deps.out ?? console.log;
  const now = deps.now ?? (() => Date.now());
  const streams = deps.streams ?? ARCHIVE_STREAMS;

  const rows: StatusRow[] = [];
  for (const s of streams) {
    const cursor = await deps.cursors.get(s.stream);
    const cursorMs = cursor ? Number(cursor.throughAt) : null;
    const w: ArchiveWindow | null = computeWindow(s.kind, cursorMs, now());
    let due: string;
    let nextWindow = "—";
    let rowsEst = 0;
    if (w) {
      nextWindow = `${day(w.from)}..${day(w.to)}`;
      rowsEst = (await fetchTrafficRowsInWindow(deps.events, w)).length;
      due = cursor === null ? "due (no cursor → last completed window)" : "due";
    } else {
      // Not due: next window opens at floor(cursor)+period
      const period = s.kind === "daily" ? 86_400_000 : 7 * 86_400_000;
      const base = cursorMs ?? now();
      due = `next due at ${iso(Math.floor(base / 86_400_000) * 86_400_000 + period)}`;
    }
    rows.push({
      stream: s.stream,
      throughAt: cursor ? iso(cursorMs!) : "no cursor",
      messageId: cursor?.messageId != null ? String(cursor.messageId) : "—",
      note: cursor?.note != null ? String(cursor.note) : "—",
      nextWindow,
      due,
      rows: rowsEst,
    });
  }
  out(formatStatusTable(rows));
  return 0;
}

if (import.meta.main) {
  const db = getDatabase();
  const cursors = resolveArchiveCursors(db);
  const code = await runTgStatus(process.argv.slice(2), {
    cursors: {
      get: async (s) => {
        const r = await cursors.get(s);
        return r ? { throughAt: r.throughAt } : null;
      },
    },
    events: db.events as unknown as ExportEventStore,
  });
  process.exit(code);
}
