// EPIC-262 (SLICE-262-6): the hosted deep-scan probe plan — a fixed
// allowlist of paths WE fetch from outside (no code is ever sent to a
// collector; this runner is the collector). Each probe produces one
// CollectorSubmission; facts keys follow the wp-profile conventions.

import type { CollectorSubmission } from "../evidence/submission";
import type { ScanObservation } from "./fetcher";

export interface ScanProbe {
  /** path appended to baseUrl */
  path: string;
  /** document kind when the body is parseable (2xx) */
  docType?: "robots" | "sitemap" | "llms_txt" | "well_known" | "html" | "wp_json";
  /** file_presence semantics: status<400 ⇒ present (sensitive paths) */
  asFilePresence?: boolean;
  /** probe with this User-Agent instead of the default */
  ua?: string;
}

export const SCAN_UAS = ["GPTBot", "ClaudeBot", "AgentBadge-Probe"] as const;

// Keep in sync with INTEL_WP_PROFILE_V1 selectors — every rule should
// have at least one probe that can feed it.
export const SCAN_PLAN: ScanProbe[] = [
  { path: "/", docType: "html" },
  ...SCAN_UAS.map((ua): ScanProbe => ({ path: "/", ua })),
  { path: "/robots.txt", docType: "robots" },
  { path: "/sitemap.xml", docType: "sitemap" },
  { path: "/llms.txt", docType: "llms_txt" },
  { path: "/.well-known/agent.json", docType: "well_known" },
  { path: "/wp-json/", docType: "wp_json" },
  { path: "/wp-json/wp/v2/users" },
  { path: "/wp-content/uploads/", docType: "html" },
  { path: "/xmlrpc.php" },
  { path: "/wp-content/debug.log", asFilePresence: true },
  { path: "/debug.log", asFilePresence: true },
  { path: "/.env", asFilePresence: true },
  { path: "/wp-config.php.bak", asFilePresence: true },
  { path: "/wp-config.txt", asFilePresence: true },
  { path: "/readme.html", asFilePresence: true },
  { path: "/phpinfo.php", asFilePresence: true },
  { path: "/wp-content/plugins/akismet/akismet.php", asFilePresence: true },
];

// ─── body → document facts ──────────────────────────────────────────
// Minimal honest parsers: they only extract what rules consume; a
// parse failure leaves facts empty rather than inventing values.

const AGENT_UAS = ["GPTBot", "ClaudeBot", "OAI-SearchBot", "Google-Extended", "CCBot", "anthropic-ai"];

export function robotsFacts(bodyText: string): Record<string, unknown> {
  const blocked = new Set<string>();
  let currentAgents: string[] = [];
  const sitemaps: string[] = [];
  for (const raw of bodyText.split("\n")) {
    const line = raw.split("#")[0].trim();
    const m = /^([^:]+):\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      currentAgents = value === "*" ? AGENT_UAS : [value];
    } else if (key === "disallow" && value === "/") {
      for (const a of currentAgents) blocked.add(a);
    } else if (key === "sitemap") {
      sitemaps.push(value);
    }
  }
  const blockedUas = [...blocked].filter((a) => AGENT_UAS.includes(a));
  return {
    blocked_uas: blockedUas,
    ai_agents_blocked:
      blockedUas.length >= AGENT_UAS.length || blocked.has("*"),
    sitemaps,
  };
}

export function sitemapFacts(
  bodyText: string,
  nowIso: string,
): Record<string, unknown> {
  const urls = (bodyText.match(/<loc>/g) ?? []).length;
  let latestLastmodDays: number | null = null;
  for (const m of bodyText.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
    const t = Date.parse(m[1]);
    if (Number.isNaN(t)) continue;
    const days = Math.floor((Date.parse(nowIso) - t) / 86_400_000);
    latestLastmodDays =
      latestLastmodDays === null ? days : Math.min(latestLastmodDays, days);
  }
  return { urls, latest_lastmod_days: latestLastmodDays };
}

export function llmsFacts(bodyText: string): Record<string, unknown> {
  return { non_empty: bodyText.trim().length > 0 };
}

// ─── observation → submission payloads ──────────────────────────────


// html page → facts the profile consumes: json-ld marker, directory
// listing signature, raw sql-error text (X-015). Only booleans —
// we never store page content in facts.
export function htmlFacts(bodyText: string): Record<string, unknown> {
  const body = bodyText.toLowerCase();
  return {
    has_jsonld: /application\/ld\+json/.test(body),
    directory_listing:
      /index of \//.test(body) || /parent directory/.test(body),
    sql_error:
      /sql syntax|mysql_fetch|mysql_num_rows|ora-\d{4}|sqlstate\[|database error/i.test(
        bodyText,
      ),
  };
}

// /wp-json/ index → namespaces array (WP REST root document)
export function wpJsonFacts(bodyText: string): Record<string, unknown> {
  try {
    const doc = JSON.parse(bodyText) as { namespaces?: unknown };
    return { namespaces: Array.isArray(doc.namespaces) ? doc.namespaces : [] };
  } catch {
    return {};
  }
}

const INTERESTING_HEADERS = [
  "server",
  "x-generator",
  "access-control-allow-origin",
] as const;

function pickHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of INTERESTING_HEADERS) {
    if (headers[h] !== undefined) out[h] = headers[h];
  }
  return out;
}

export function probeToSubmissions(opts: {
  siteId: string;
  scanId: string;
  collectorId: string;
  collectedAt: string;
  probe: ScanProbe;
  url: string;
  obs: ScanObservation;
  nowIso: string;
}): CollectorSubmission[] {
  const { probe, url, obs } = opts;
  const base = {
    site_ref: opts.siteId,
    scan_id: opts.scanId,
    collector_id: opts.collectorId,
    collected_at: opts.collectedAt,
    evidence_refs: [] as CollectorSubmission["evidence_refs"],
  };

  if (probe.asFilePresence) {
    return [
      {
        ...base,
        subject: { type: "file_path", path: probe.path },
        payload: {
          type: "file_presence",
          path: probe.path,
          present: obs.status < 400,
          detail: `http ${obs.status}`,
        },
      },
    ];
  }

  const httpObs: CollectorSubmission = {
    ...base,
    subject: { type: "url", url },
    payload: {
      type: "http_observation",
      url,
      status: obs.status,
      ...(probe.ua ? { ua: probe.ua } : {}),
      headers: pickHeaders(obs.headers),
      content_hash: contentHash(obs.bodyText),
      content_type: obs.headers["content-type"] ?? null,
      resolved_ip: obs.resolvedIp,
    },
  };

  if (probe.docType && obs.status >= 200 && obs.status < 300) {
    const facts =
      probe.docType === "robots"
        ? robotsFacts(obs.bodyText)
        : probe.docType === "sitemap"
          ? sitemapFacts(obs.bodyText, opts.nowIso)
          : probe.docType === "llms_txt"
            ? llmsFacts(obs.bodyText)
            : probe.docType === "html"
              ? htmlFacts(obs.bodyText)
              : probe.docType === "wp_json"
                ? wpJsonFacts(obs.bodyText)
                : {};
    const docFact: CollectorSubmission = {
      ...base,
      subject: { type: "url", url },
      payload: {
        type: "document_fact",
        // submission schema allows robots|sitemap|llms_txt|well_known|
        // other — custom probe kinds map onto "other" (the rules'
        // docWhere("other", …) selectors expect exactly that)
        doc_type:
          probe.docType === "html" || probe.docType === "wp_json"
            ? "other"
            : probe.docType,
        url,
        facts,
      },
    };
    // html/wp_json urls also feed observation rules (status, headers,
    // content) → dual emit; classic doc urls emit the fact only
    return ["html", "wp_json"].includes(probe.docType)
      ? [httpObs, docFact]
      : [docFact];
  }

  return [httpObs];
}

import { createHash } from "node:crypto";
const contentHash = (body: string): string | undefined =>
  body ? createHash("sha256").update(body, "utf8").digest("hex") : undefined;
