/**
 * SLICE-203-13: shared traffic-report aggregation + formatters.
 *
 * Pure functions — rows in, stats out; stats in, report string out.
 * Used by scripts/traffic-report.ts so the email/print and Telegram
 * outputs always describe the same data.
 *
 * Telegram Bot API has no Markdown tables: the Telegram formatter emits
 * one HTML message — <b> section titles + aligned tables inside <pre>,
 * capped at the 4096-char message limit.
 */

import { escHtml } from "../notify/telegram";

export type TrafficRow = {
  payload: {
    method?: string;
    path?: string;
    status?: number;
    durationMs?: number;
    ua?: string | null;
    referer?: string | null;
    ip?: string | null;
    /** SLICE-206-12: normalized ?src=<registry> attribution token. */
    src?: string | null;
  };
  createdAt: string;
};

export type TrafficStats = {
  total: number;
  byClass: Map<string, number>;
  byUaClass: Map<string, number>;
  byPath: Map<string, number>;
  byPathUa: Map<string, number>;
  errors: Map<string, number>;
  errorTotal: number;
  hourly: number[];
  /** SLICE-206-17: rendered AI-crawler section body (per-crawler hits + top paths). */
  aiCrawlerBody: string;
  /** SLICE-206-12: rendered ?src attribution section (hits + register conversions). */
  srcBody: string;
  from: string;
  until: string;
  hours: number;
};

const BOT_SIGNATURES: [RegExp, string][] = [
  [/better stack|uptime/i, "Better Stack uptime"],
  [/facebookexternalhit/i, "Facebook"],
  [/elevenlabscrawler|elevenlabsbot/i, "ElevenLabs"],
  [/exasearchbot|exabot|exa\.ai/i, "Exa"],
  [/bunnycdn/i, "BunnyCDN"],
  [/googlebot/i, "Googlebot"],
  [/bingbot/i, "Bingbot"],
  [/gptbot|oai-searchbot|chatgpt-user|openai/i, "GPTBot"],
  [/claudebot|claude-searchbot|claude-user|anthropic/i, "ClaudeBot"],
  [/perplexity/i, "Perplexity"],
  [/moneyagentpoller/i, "MoneyAgentPoller"],
  [/agentkarma/i, "AgentKarma"],
  [/curl|wget|python-requests|go-http|node-fetch|axios/i, "HTTP client"],
  [/bot|crawler|spider|scraper/i, "Other bot"],
];

/**
 * SLICE-206-17: AI-training/agent crawlers we explicitly welcome in
 * robots.txt. The report section answers "do they actually fetch us?"
 * — hits + most-visited paths per crawler class.
 */
export const AI_CRAWLER_SIGNATURES: [RegExp, string][] = [
  [/gptbot|oai-searchbot|chatgpt-user|openai/i, "OpenAI (GPTBot/Search/ChatGPT)"],
  [/claudebot|claude-searchbot|claude-user|anthropic/i, "Anthropic (Claude)"],
  [/perplexity/i, "Perplexity"],
  [/elevenlabscrawler|elevenlabsbot/i, "ElevenLabs"],
  [/exasearchbot|exabot|exa\.ai/i, "Exa"],
  [/google-extended/i, "Google-Extended"],
  [/ccbot/i, "Common Crawl"],
  [/cohere-ai|cohere/i, "Cohere"],
];

export type AiCrawlerStat = {
  crawler: string;
  hits: number;
  topPaths: [string, number][];
};

/** Aggregate rows into per-AI-crawler hit counts + top paths. */
export function aiCrawlerStats(rows: TrafficRow[]): AiCrawlerStat[] {
  const out = new Map<string, { hits: number; paths: Map<string, number> }>();
  for (const { payload: p } of rows) {
    const ua = p.ua ?? "";
    const sig = AI_CRAWLER_SIGNATURES.find(([re]) => re.test(ua));
    if (!sig) continue;
    const slot = out.get(sig[1]) ?? { hits: 0, paths: new Map<string, number>() };
    slot.hits++;
    const path = p.path ?? "?";
    slot.paths.set(path, (slot.paths.get(path) ?? 0) + 1);
    out.set(sig[1], slot);
  }
  return [...out.entries()]
    .map(([crawler, s]) => ({
      crawler,
      hits: s.hits,
      topPaths: top(s.paths, 3) as [string, number][],
    }))
    .sort((a, b) => b.hits - a.hits);
}

/** Render the AI-crawler section as a report body block. */
export function aiCrawlerSection(rows: TrafficRow[]): string {
  const stats = aiCrawlerStats(rows);
  if (stats.length === 0) return "  (no AI-crawler hits in window)";
  const lines: string[] = [];
  for (const s of stats) {
    lines.push(`  ${s.crawler.padEnd(34)} ${s.hits}`);
    for (const [p, n] of s.topPaths) lines.push(`      ${p} (${n})`);
  }
  return lines.join("\n");
}

// SLICE-206-12: ?src= aggregation/section lives in src-attribution-report.ts
// (max-lines) — re-exported here for the single import surface.
export {
  SRC_CONVERSION_PATHS,
  srcAttributionStats,
  srcAttributionSection,
  type SrcStat,
} from "./src-attribution-report";
import { srcAttributionSection } from "./src-attribution-report";

export function classifyUa(ua: string | null | undefined): string {
  if (!ua) return "(no UA)";
  for (const [re, name] of BOT_SIGNATURES) if (re.test(ua)) return name;
  return "Human/other";
}

function top<K>(m: Map<K, number>, n: number): [K, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Aggregate raw http_traffic rows into report stats. */
export function collectStats(rows: TrafficRow[], hours: number): TrafficStats {
  const byClass = new Map<string, number>();
  const byUaClass = new Map<string, number>();
  const byPath = new Map<string, number>();
  const byPathUa = new Map<string, number>();
  const errors = new Map<string, number>();
  const hourly = new Array<number>(24).fill(0);
  let errorTotal = 0;

  for (const { payload: p, createdAt } of rows) {
    const status = p.status ?? 0;
    const klass = `${Math.floor(status / 100)}xx`;
    byClass.set(klass, (byClass.get(klass) ?? 0) + 1);
    const uaClass = classifyUa(p.ua);
    byUaClass.set(uaClass, (byUaClass.get(uaClass) ?? 0) + 1);
    const path = p.path ?? "?";
    byPath.set(path, (byPath.get(path) ?? 0) + 1);
    const key = `${uaClass} → ${path}`;
    byPathUa.set(key, (byPathUa.get(key) ?? 0) + 1);
    if (status >= 400) {
      errorTotal++;
      const k = `${status} ${p.method ?? "GET"} ${path}`;
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
    hourly[new Date(createdAt).getUTCHours()]++;
  }

  return {
    total: rows.length,
    byClass,
    byUaClass,
    byPath,
    byPathUa,
    errors,
    errorTotal,
    hourly,
    aiCrawlerBody: aiCrawlerSection(rows),
    srcBody: srcAttributionSection(rows),
    from: new Date(Date.now() - hours * 3600_000).toISOString(),
    until: new Date().toISOString(),
    hours,
  };
}

const table = (rows: [string, number][], a: string, b: string): string => {
  if (rows.length === 0) return "  (none)";
  const w = Math.max(a.length, ...rows.map(([k]) => String(k).length));
  return [
    `  ${a.padEnd(w)}  ${b}`,
    ...rows.map(([k, v]) => `  ${String(k).padEnd(w)}  ${v}`),
  ].join("\n");
};

/** Legacy plain-text body (Resend email / --dry stdout). */
export function formatTextReport(s: TrafficStats): string {
  return [
    `AgentBadge traffic report — ${s.from} → ${s.until}`,
    `Total requests: ${s.total}`,
    "",
    "Status classes:",
    table(top(s.byClass, 10), "class", "count"),
    "",
    "Top clients (UA classes):",
    table(top(s.byUaClass, 15), "client", "count"),
    "",
    "Top paths:",
    table(top(s.byPath, 20), "path", "count"),
    "",
    "Top client → path:",
    table(top(s.byPathUa, 15), "client → path", "count"),
    "",
    "AI crawlers (welcomed in robots.txt):",
    s.aiCrawlerBody,
    "",
    "Registry attribution (?src=):",
    s.srcBody,
    "",
    `Errors (4xx/5xx): ${s.errorTotal}`,
    table(top(s.errors, 20), "status path", "count"),
    "",
    "Requests per UTC hour:",
    s.hourly
      .map(
        (n, h) =>
          `  ${String(h).padStart(2, "0")}:00  ${"█".repeat(
            Math.ceil((n / Math.max(1, s.total)) * 200),
          )} ${n}`,
      )
      .join("\n"),
  ].join("\n");
}

const TG_LIMIT = 4096;
const ELLIPSIS = "\n… truncated";

/**
 * Telegram message: bold section titles + monospace <pre> tables.
 * Sections are appended while they fit TG_LIMIT; the rest is truncated.
 */
export function formatTelegramReport(s: TrafficStats): string {
  const section = (title: string, body: string): string =>
    `<b>${escHtml(title)}</b>\n<pre>${escHtml(body)}</pre>\n`;

  const pre = (title: string, rows: [string, number][], a: string): string =>
    section(title, table(rows, a, "count"));

  const hourlyBody = s.hourly
    .map((n, h) => `${String(h).padStart(2, "0")}:00 ${n}`)
    .join("  ");

  const parts = [
    `<b>AgentBadge traffic report</b>\n${escHtml(
      `${s.from.slice(0, 16)} → ${s.until.slice(0, 16)} UTC — Total requests: ${s.total}`,
    )}\n`,
    pre("Status classes", top(s.byClass, 10), "class"),
    pre("Top clients", top(s.byUaClass, 10), "client"),
    pre("Top paths", top(s.byPath, 15), "path"),
    pre("Top client → path", top(s.byPathUa, 10), "client → path"),
    section("AI crawlers (robots.txt allowlist)", s.aiCrawlerBody),
    section("Registry attribution (?src=)", s.srcBody),
    pre(`Errors (4xx/5xx): ${s.errorTotal}`, top(s.errors, 12), "status path"),
    section("Requests per UTC hour", hourlyBody),
  ];

  let out = "";
  for (const part of parts) {
    if (out.length + part.length + ELLIPSIS.length > TG_LIMIT) {
      out += ELLIPSIS;
      break;
    }
    out += part;
  }
  if (out.length > TG_LIMIT) out = out.slice(0, TG_LIMIT - ELLIPSIS.length) + ELLIPSIS;
  return out.trimEnd();
}
