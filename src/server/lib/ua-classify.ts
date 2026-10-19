/**
 * SLICE-201-13: UA classification for agent_json_request metric.
 * Best-effort, never blocks the request:
 *   crawl — known AI crawler bots (fetch content on their own schedule)
 *   fetch — interactive fetchers (curl, browsers, API clients, agents on request)
 *   unknown — missing/unrecognizable UA
 */
export type UaClass = "crawl" | "fetch" | "unknown";

/** Known AI crawler tokens (extend as new bots appear). */
const AI_CRAWLERS = [
  "gptbot",
  "claudebot",
  "anthropic-ai",
  "perplexitybot",
  "perplexity-user",
  "ccbot",
  "google-extended",
  "applebot-extended",
  "cohere-ai",
  "meta-externalagent",
  "amazonbot",
  "ai2bot",
  "bytespider",
  "diffbot",
  "youbot",
];

/** Generic bot markers used when no specific crawler matched. */
const GENERIC_BOTS = ["bot/", "+bot", "spider", "crawler", "scraper"];

/** Interactive fetcher tokens — checked before bots so a real client isn't mislabeled. */
const FETCHERS = [
  "curl/",
  "wget/",
  "node-fetch",
  "undici",
  "python-requests",
  "httpie/",
  "mozilla/", // browsers (also many bots, caught earlier if known)
  "postmanruntime",
];

export function classifyUserAgent(ua: string | undefined | null): UaClass {
  if (!ua) return "unknown";
  const s = ua.toLowerCase();
  if (s.trim().length < 3) return "unknown";
  // Known AI crawlers first — their UAs often embed Mozilla/browser tokens.
  for (const b of AI_CRAWLERS) {
    if (s.includes(b)) return "crawl";
  }
  for (const b of GENERIC_BOTS) {
    if (s.includes(b)) return "crawl";
  }
  for (const f of FETCHERS) {
    if (s.includes(f)) return "fetch";
  }
  return "unknown";
}
