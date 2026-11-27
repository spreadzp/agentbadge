/**
 * DB health watchdog — probes `db.health()` on an interval and sends a
 * Telegram alert on the up→down transition plus a recovery notice, so pg
 * outages (e.g. the 256MB pg-vm OOM kills of 2026-11-27) land in chat
 * instead of only in `fly logs`.
 *
 * Self-gates: armed only when the DB is enabled (in-memory mode → health
 * is a constant false, so no watchdog runs) and
 * DB_HEALTH_WATCHDOG_ENABLED ≠ "false" (default on). Without
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID transitions are still logged —
 * TG is an extra sink, not a requirement.
 */

import {
  escHtml,
  sendTelegramMessage,
  telegramFromEnv,
} from "../lib/notify/telegram";

const PROBE_MS = 30_000;
const FAILS_BEFORE_ALERT = 2; // ~60s confirmed down before paging
const STILL_DOWN_REPEAT_MS = 15 * 60_000;

type Logger = Pick<Console, "info" | "warn">;

export type WatchdogDeps = {
  health: () => Promise<boolean>;
  send?: (text: string) => Promise<void>;
  logger?: Logger;
  now?: () => number;
};

function where(): string {
  const app = process.env.FLY_APP_NAME ?? "app";
  const m = process.env.FLY_MACHINE_ID;
  const r = process.env.FLY_REGION;
  return `${escHtml(app)}${m ? `/${escHtml(m.slice(0, 8))}` : ""}${r ? ` (${escHtml(r)})` : ""}`;
}

/** Pure state machine — one call per probe; injectable for tests. */
export function createDbHealthTick(deps: WatchdogDeps): () => Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.logger ?? console;
  let fails = 0;
  let downSince = 0;
  let lastAlertAt = 0;

  const send = async (text: string): Promise<void> => {
    if (!deps.send) {
      log.info(`[db-health] ${text.replace(/<[^>]+>/g, "")}`);
      return;
    }
    try {
      await deps.send(text);
    } catch (err) {
      log.warn(`[db-health] telegram send failed: ${(err as Error).message}`);
    }
  };

  return async function tick(): Promise<void> {
    let ok = false;
    try {
      ok = await deps.health();
    } catch {
      ok = false;
    }
    const t = now();

    if (ok) {
      if (downSince) {
        const mins = Math.max(1, Math.round((t - downSince) / 60_000));
        await send(`🟢 <b>DB recovered</b> ${where()} — down ~${mins}m`);
        downSince = 0;
        lastAlertAt = 0;
      }
      fails = 0;
      return;
    }

    fails += 1;
    if (!downSince && fails >= FAILS_BEFORE_ALERT) {
      downSince = t;
      lastAlertAt = t;
      await send(
        `🔴 <b>DB unreachable</b> ${where()} — health probe failed ${fails}× in a row (pg down/OOM?)`,
      );
    } else if (downSince && t - lastAlertAt >= STILL_DOWN_REPEAT_MS) {
      lastAlertAt = t;
      const mins = Math.round((t - downSince) / 60_000);
      await send(`🔴 <b>DB still down</b> ${where()} — ~${mins}m`);
    }
  };
}

export function startDbHealthWatchdog(opts: {
  health: () => Promise<boolean>;
  databaseEnabled: boolean;
  probeMs?: number;
}): NodeJS.Timeout | undefined {
  if (!opts.databaseEnabled) return undefined;
  if (
    (process.env.DB_HEALTH_WATCHDOG_ENABLED ?? "").toLowerCase() === "false"
  ) {
    console.info(
      "[db-health] watchdog disabled (DB_HEALTH_WATCHDOG_ENABLED=false)",
    );
    return undefined;
  }

  const tg = telegramFromEnv();
  if (!tg) {
    console.info("[db-health] TELEGRAM_* creds absent — transitions logged only");
  }
  const send = tg
    ? (text: string) => sendTelegramMessage(text, tg).then(() => {})
    : undefined;
  const tick = createDbHealthTick({ health: opts.health, send });

  const timer = setInterval(() => {
    void tick();
  }, opts.probeMs ?? PROBE_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  // First probe +10s after boot — catches a dead-at-boot DB without
  // false-positives during warm-up.
  const first = setTimeout(() => {
    void tick();
  }, 10_000);
  if (typeof first === "object" && "unref" in first) first.unref();
  return timer;
}
