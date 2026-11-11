/**
 * SLICE-217-1: ops stats digest — window presets, traffic-row fetch,
 * and digest response assembly for GET /ops/stats-digest.
 *
 * Reuses the SLICE-203-13 pipeline: `http_traffic` Event rows →
 * collectStats → formatTelegramReport / formatTextReport. The paged
 * scan is the same loop as scripts/traffic-report.ts and
 * routes/meta-traffic.ts — extracted here so all three share it.
 */

import type { Store } from "@agentbadge/database";
import {
  formatTelegramReport,
  formatTextReport,
  type TrafficRow,
  type TrafficStats,
} from "./traffic-format";
import {
  formatBusinessTelegram,
  formatBusinessText,
  type BusinessStats,
} from "./business-stats";

export type DigestWindowPreset = "24h" | "7d" | "30d";

const PRESETS: Record<DigestWindowPreset, number> = {
  "24h": 24,
  "7d": 168,
  "30d": 720,
};

/** Map ?window=24h|7d|30d → hours. Unknown/missing → 24h default. */
export function parseDigestWindow(
  raw: string | undefined,
): { preset: DigestWindowPreset; hours: number } {
  if (raw === "7d" || raw === "30d") {
    return { preset: raw, hours: PRESETS[raw] };
  }
  return { preset: "24h", hours: PRESETS["24h"] };
}

const PAGE = 5000;

/**
 * Paged scan of `http_traffic` events inside the window.
 * events.list is newest-first (createdAt desc) — early-stop once a row
 * crosses the cutoff. `now` injectable for tests.
 */
export async function fetchTrafficRows(
  events: Pick<Store, "list">,
  hours: number,
  now: number = Date.now(),
): Promise<TrafficRow[]> {
  const cutoff = now - hours * 3600_000;
  const rows: TrafficRow[] = [];
  let done = false;
  for (let offset = 0; !done; offset += PAGE) {
    const page = await events.list({
      type: "http_traffic",
      limit: PAGE,
      offset,
    });
    if (page.length === 0) break;
    for (const e of page) {
      if (Date.parse(e.createdAt) < cutoff) {
        done = true;
        break;
      }
      rows.push({ payload: e.payload ?? {}, createdAt: e.createdAt });
    }
    if (page.length < PAGE) break;
  }
  return rows;
}

export type DigestResponse = {
  sent: boolean;
  reason?: "no_creds" | "telegram_error";
  error?: string;
  messageId?: number;
  window: { preset: DigestWindowPreset; hours: number; from: string; until: string };
  totalRequests: number;
  errorTotal: number;
  topPaths: [string, number][];
  /** SLICE-217-2: business aggregates for the same window (null when the
   *  orm scan failed — traffic digest must not die on a business error). */
  business?: BusinessStats | null;
  reportText: string;
};

/**
 * Assemble stats + send Telegram digest. `sendTelegram` is injected —
 * the route passes a closure over telegramFromEnv/sendTelegramMessage,
 * tests pass a mock. Never throws: send failures degrade to
 * sent:false + stats (the digest is still useful as JSON).
 */
export async function runDigest(opts: {
  stats: TrafficStats;
  hours: number;
  preset: DigestWindowPreset;
  business?: BusinessStats | null;
  sendTelegram?: (text: string) => Promise<number>;
}): Promise<DigestResponse> {
  const { stats, hours, preset, sendTelegram } = opts;
  const business = opts.business ?? null;
  const topPaths = [...stats.byPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Business block rides inside the same TG message / text report —
  // appended after the traffic sections, before the footer (per spec).
  const tgText = business
    ? `${formatTelegramReport(stats)}\n\n${formatBusinessTelegram(business)}`
    : formatTelegramReport(stats);
  const reportText = business
    ? `${formatTextReport(stats)}\n\n${formatBusinessText(business)}`
    : formatTextReport(stats);

  let send: Pick<DigestResponse, "sent" | "reason" | "error" | "messageId">;
  if (!sendTelegram) {
    send = { sent: false, reason: "no_creds" };
  } else {
    try {
      const messageId = await sendTelegram(tgText);
      send = { sent: true, messageId };
    } catch (e) {
      send = {
        sent: false,
        reason: "telegram_error",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    ...send,
    window: {
      preset,
      hours,
      from: stats.from,
      until: stats.until,
    },
    totalRequests: stats.total,
    errorTotal: stats.errorTotal,
    topPaths,
    business,
    reportText,
  };
}
