/**
 * Daily traffic report: aggregates `http_traffic` Event rows from the
 * last N hours (default 24) and sends a summary via Resend or Telegram.
 *
 * The fly-logs buffer is ~10 minutes — traffic-log middleware persists
 * every request to the Event table so this report sees the full window.
 *
 * Usage:
 *   bun run scripts/traffic-report.ts [--hours 24] [--to you@x.com] [--dry]
 *   bun run scripts/traffic-report.ts --telegram [--hours 24] [--dry]
 *
 * Env: DATABASE_ENABLED=1 + DATABASE_URL (prod), RESEND_API_KEY,
 * REPORT_EMAIL_TO (fallback: SUPPORT_EMAIL),
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (for --telegram).
 */

import { getDatabase } from "../src/server/lib/database";
import {
  collectStats,
  formatTelegramReport,
  formatTextReport,
} from "../src/server/lib/report/traffic-format";
import { fetchTrafficRows } from "../src/server/lib/report/traffic-digest";
import {
  sendTelegramMessage,
  telegramFromEnv,
} from "../src/server/lib/notify/telegram";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const hours = Number(opt("hours", "24"));
const dry = args.includes("--dry");
const telegram = args.includes("--telegram");
const to = opt(
  "to",
  process.env.REPORT_EMAIL_TO ?? process.env.SUPPORT_EMAIL ?? "",
);

const db = getDatabase();
if (!db.db) {
  console.error(
    "DATABASE disabled or unreachable — set DATABASE_ENABLED=1 + DATABASE_URL",
  );
  process.exit(1);
}

// Paged scan shared with routes/meta-traffic.ts and routes/ops-stats.ts
// (lib/report/traffic-digest.ts) — events.list is newest-first, early-stop
// once a row crosses the cutoff.
const rows = await fetchTrafficRows(db.events, hours);

const stats = collectStats(rows, hours);

if (dry) {
  console.log(formatTextReport(stats));
  process.exit(0);
}

if (telegram) {
  const tg = telegramFromEnv();
  if (!tg) {
    console.error(
      "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured — skipping",
    );
    process.exit(1);
  }
  const id = await sendTelegramMessage(formatTelegramReport(stats), tg);
  console.log(
    `report sent to telegram chat ${tg.chatId} (message_id=${id}, ${stats.total} requests over ${hours}h)`,
  );
  process.exit(0);
}

if (!to) {
  console.error(
    "(no recipient — set REPORT_EMAIL_TO or pass --to; printing instead)\n",
  );
  console.log(formatTextReport(stats));
  process.exit(0);
}

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error("RESEND_API_KEY not configured");
  process.exit(1);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    from: "AgentBadge Reports <reports@agentbadge.xyz>",
    to: [to],
    subject: `[agentbadge] traffic report ${stats.until.slice(0, 10)} — ${stats.total} req`,
    text: formatTextReport(stats),
  }),
});

if (!res.ok) {
  console.error(`Resend API error: ${res.status} — ${await res.text()}`);
  process.exit(1);
}
console.log(`report sent to ${to} (${stats.total} requests over ${hours}h)`);
