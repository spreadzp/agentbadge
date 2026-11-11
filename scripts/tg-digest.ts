/**
 * SLICE-217-11: tg-digest — send/print a traffic digest for an
 * ARBITRARY window, off-schedule (EPIC-217).
 *
 *   bun scripts/tg-digest.ts --from 2026-11-08 --to 2026-11-10 \
 *     [--send-to <chatId>] [--no-send]
 *
 * Same path as the daily worker: fetchTrafficRowsInWindow →
 * collectStats → formatTelegramReport → sendMessage. Read-only for
 * cursors — ad-hoc digests never move ArchiveCursor.
 *
 * Env: DATABASE_ENABLED=1 + DATABASE_URL (via fly proxy — see
 * scripts/tg-export.ts header), TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
 * Exit: 0 ok · 2 usage/missing creds.
 */

import { parseExplicitWindow, type ArchiveWindow } from "../src/server/lib/report/archive-window";
import { fetchTrafficRowsInWindow, type ExportEventStore } from "../src/server/lib/report/archive-export";
import { collectStats, formatTelegramReport } from "../src/server/lib/report/traffic-format";
import {
  sendTelegramMessage,
  telegramFromEnv,
  type TelegramConfig,
} from "../src/server/lib/notify/telegram";
import { getDatabase } from "../src/server/lib/database";

export interface TgDigestArgs {
  window?: ArchiveWindow;
  sendTo?: string;
  noSend: boolean;
  error?: string;
}

const opt = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length && !args[i + 1]!.startsWith("--")
    ? args[i + 1]
    : undefined;
};

export function parseTgDigestArgs(args: string[]): TgDigestArgs {
  const from = opt(args, "from");
  const to = opt(args, "to");
  const base = { sendTo: opt(args, "send-to"), noSend: args.includes("--no-send") };
  if (!from || !to) return { ...base, error: "--from and --to are required (ISO, --to exclusive)" };
  try {
    return { ...base, window: parseExplicitWindow(from, to) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface TgDigestDeps {
  events: ExportEventStore;
  telegram?: TelegramConfig;
  sendMessage?: (text: string, cfg: TelegramConfig) => Promise<number>;
  out?: (msg: string) => void;
  err?: (msg: string) => void;
}

export async function runTgDigest(
  argv: string[],
  deps: TgDigestDeps,
): Promise<number> {
  const out = deps.out ?? console.log;
  const err = deps.err ?? ((m) => console.error(m));
  const a = parseTgDigestArgs(argv);
  if (a.error || !a.window) {
    err(`tg-digest: ${a.error}`);
    return 2;
  }

  const rows = await fetchTrafficRowsInWindow(deps.events, a.window);
  const stats = collectStats(rows, (a.window.to - a.window.from) / 3600_000);
  stats.from = new Date(a.window.from).toISOString();
  stats.until = new Date(a.window.to).toISOString();
  const text = formatTelegramReport(stats);

  if (a.noSend) {
    out(text);
    return 0;
  }

  const tg = a.sendTo
    ? deps.telegram
      ? { ...deps.telegram, chatId: a.sendTo }
      : undefined
    : deps.telegram;
  if (!tg) {
    err("tg-digest: no TELEGRAM_BOT_TOKEN/CHAT_ID (use --no-send or --send-to)");
    return 2;
  }
  const send = deps.sendMessage ?? sendTelegramMessage;
  const messageId = await send(text, tg);
  out(`sent message_id=${messageId} rows=${stats.total}`);
  return 0;
}

if (import.meta.main) {
  const db = getDatabase();
  const code = await runTgDigest(process.argv.slice(2), {
    events: db.events as unknown as ExportEventStore,
    telegram: telegramFromEnv() ?? undefined,
  });
  process.exit(code);
}
