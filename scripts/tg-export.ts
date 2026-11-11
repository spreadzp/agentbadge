/**
 * SLICE-217-10: tg-export — ad-hoc filtered traffic/forensics export
 * → JSON doc to Telegram channel or local file (EPIC-217).
 *
 *   bun scripts/tg-export.ts \
 *     --stream http_traffic|forensics_edge|event \
 *     --from 2026-11-01 --to 2026-11-05 [--to-inclusive] \
 *     [--type x402_paid] [--status 404] [--path-glob '/wp-*'] \
 *     [--client GPTBot] [--chain 5042] [--raw] \
 *     [--send-to <chatId>] [--no-send] [--out file.json.gz] [--dry-run] \
 *     [--require-nonempty]
 *
 * --to is EXCLUSIVE but a bare date is the day's start, so
 * --to 2026-11-05 covers Nov 1–4; --to-inclusive adds one day.
 *
 * DB: DATABASE_URL + DATABASE_ENABLED=1. Prod access pattern:
 *   fly proxy 5433:5432 -a agentbadge-pg-vm &
 *   DATABASE_URL=postgres://…@localhost:5433/… bun scripts/tg-export.ts …
 * TG: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (or --send-to).
 *
 * Exit: 0 ok · 2 usage/missing creds · 3 empty + --require-nonempty.
 * NEVER touches ArchiveCursor — ad-hoc exports don't move watermarks.
 */

import { writeFile } from "node:fs/promises";

import { buildExport, type ExportFilters, type ExportDeps } from "../src/server/lib/report/archive-export";
import { parseExplicitWindow, type ArchiveWindow } from "../src/server/lib/report/archive-window";
import {
  sendTelegramDocument,
  telegramFromEnv,
  type TelegramConfig,
} from "../src/server/lib/notify/telegram";
import { getDatabase } from "../src/server/lib/database";

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_EMPTY = 3;

const DAY_MS = 86_400_000;

export interface TgExportArgs extends ExportFilters {
  window: ArchiveWindow;
  sendTo?: string;
  noSend: boolean;
  out?: string;
  dryRun: boolean;
  requireNonempty: boolean;
  error?: string;
}

const opt = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length && !args[i + 1]!.startsWith("--")
    ? args[i + 1]
    : undefined;
};

const STREAMS = new Set(["http_traffic", "forensics_edge", "event"]);

export function parseTgExportArgs(args: string[]): TgExportArgs {
  const stream = opt(args, "stream");
  const from = opt(args, "from");
  const to = opt(args, "to");
  const toInclusive = args.includes("--to-inclusive");

  const base: Omit<TgExportArgs, "window" | "stream"> = {
    type: opt(args, "type"),
    status: opt(args, "status") !== undefined ? Number(opt(args, "status")) : undefined,
    pathGlob: opt(args, "path-glob"),
    client: opt(args, "client"),
    chain: opt(args, "chain"),
    raw: args.includes("--raw") || undefined,
    sendTo: opt(args, "send-to"),
    noSend: args.includes("--no-send"),
    out: opt(args, "out"),
    dryRun: args.includes("--dry-run"),
    requireNonempty: args.includes("--require-nonempty"),
  };

  const fail = (error: string): TgExportArgs =>
    ({ ...base, stream: "event", window: { from: 0, to: 0 }, error } as TgExportArgs);

  if (!stream || !STREAMS.has(stream)) {
    return fail(`--stream must be one of ${[...STREAMS].join("|")}`);
  }
  if (!from || !to) {
    return fail("--from and --to are required (ISO dates, --to exclusive)");
  }
  let window: ArchiveWindow;
  try {
    window = parseExplicitWindow(from, to);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (toInclusive) window = { ...window, to: window.to + DAY_MS };

  return { ...base, stream: stream as TgExportArgs["stream"], window };
}

export interface TgExportDeps {
  events: ExportDeps["events"];
  forensics?: ExportDeps["forensics"];
  /** Default telegramFromEnv(); --send-to overrides chatId. */
  telegram?: TelegramConfig;
  sendDocument?: (
    cfg: TelegramConfig,
    doc: { filename: string; data: Uint8Array | string; caption?: string },
  ) => Promise<number>;
  writeFile?: (path: string, data: Uint8Array) => Promise<unknown>;
  out?: (msg: string) => void;
  err?: (msg: string) => void;
}

/** Build+send/write one export. Returns process exit code. */
export async function runTgExport(
  argv: string[],
  deps: TgExportDeps,
): Promise<number> {
  const out = deps.out ?? console.log;
  const err = deps.err ?? ((m) => console.error(m));
  const a = parseTgExportArgs(argv);
  if (a.error) {
    err(`tg-export: ${a.error}`);
    return EXIT_USAGE;
  }

  const result = await buildExport(
    { events: deps.events, forensics: deps.forensics },
    a.window,
    {
      stream: a.stream,
      type: a.type,
      status: a.status,
      pathGlob: a.pathGlob,
      client: a.client,
      chain: a.chain,
      raw: a.raw,
    },
  );

  const summary = `${result.caption} file=${result.filename} bytes=${result.bytes}`;

  if (a.dryRun) {
    out(`[dry-run] ${summary}`);
    return EXIT_OK;
  }

  if (a.requireNonempty && result.rowCount === 0) {
    err(`tg-export: empty result (rows=0), --require-nonempty → exit ${EXIT_EMPTY}`);
    return EXIT_EMPTY;
  }

  if (a.out) {
    await (deps.writeFile ?? writeFile)(a.out, result.data);
    out(`wrote ${a.out}`);
  }

  if (a.noSend) {
    out(`no-send: ${summary}`);
    return EXIT_OK;
  }

  const tg = a.sendTo
    ? deps.telegram
      ? { ...deps.telegram, chatId: a.sendTo }
      : undefined
    : deps.telegram;
  if (!tg) {
    err("tg-export: no TELEGRAM_BOT_TOKEN/CHAT_ID (use --no-send or --send-to)");
    return EXIT_USAGE;
  }
  const send = deps.sendDocument ?? sendTelegramDocument;
  const messageId = await send(tg, {
    filename: result.filename,
    data: result.data,
    caption: result.caption,
  });
  out(`sent message_id=${messageId} ${summary}`);
  return EXIT_OK;
}

if (import.meta.main) {
  const db = getDatabase();
  const tg = telegramFromEnv();
  const deps: TgExportDeps = {
    events: db.events as unknown as ExportDeps["events"],
    telegram: tg ?? undefined,
    forensics: {
      scan: async (w, opts) => {
        // Window is by createdAt (ISO), NOT ts — see SLICE-217-12.
        const rows = await db.forensics.edges.listWindow(
          new Date(w.from).toISOString(),
          new Date(w.to).toISOString(),
          opts?.chain !== undefined ? { chain: opts.chain } : {},
        );
        return rows.map((r) => ({
          chain: r.chain,
          txHash: r.txHash,
          payer: r.payer,
          seller: r.seller,
          amountAtomic: r.amountAtomic,
          blockNumber: r.blockNumber,
          ts: r.ts,
          createdAt: r.createdAt,
        }));
      },
    },
  };
  const code = await runTgExport(process.argv.slice(2), deps);
  process.exit(code);
}
