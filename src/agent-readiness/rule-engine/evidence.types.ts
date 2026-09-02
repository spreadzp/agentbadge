// ─── Evidence Types — 9 Discriminated Union Variants ──────────────────────────
// Source: AGENT-READINESS-SPEC-v0.3.md, §4 Evidence Model

import type { SourceClass } from "./source-hierarchy";

export interface HttpEvidence {
  type: "http";
  url: string;
  status: number;
  headers: Record<string, string>;
  content_hash: string;
  content_type: string | null;
  resolved_ip: string | null;
  captured_at?: string;
  source_class?: SourceClass;
}

export interface OpenApiEvidence {
  type: "openapi";
  url: string;
  paths: string[];
  methods: string[];
  captured_at?: string;
  source_class?: SourceClass;
}

export interface JsonSchemaEvidence {
  type: "json_schema";
  url: string;
  schema_keys: string[];
  valid: boolean;
  captured_at?: string;
  source_class?: SourceClass;
}

export interface HtmlEvidence {
  type: "html";
  url: string;
  title: string | null;
  content_hash: string;
  content_type: string | null;
  captured_at?: string;
  source_class?: SourceClass;
}

export interface RobotsEvidence {
  type: "robots";
  url: string;
  status: number;
  allows_all: boolean;
  disallowed_paths: string[];
  captured_at?: string;
  source_class?: SourceClass;
}

export interface SitemapEvidence {
  type: "sitemap";
  url: string;
  status: number;
  url_count: number;
  urls: string[];
  captured_at?: string;
  source_class?: SourceClass;
}

export interface GithubEvidence {
  type: "github";
  repo: string;
  path: string;
  content_hash: string;
  last_commit: string;
  captured_at?: string;
  source_class?: SourceClass;
}

export interface ManualConfirmationEvidence {
  type: "manual_confirmation";
  confirmed_by: string;
  confirmed_at: string;
  note: string;
  captured_at?: string;
  source_class?: SourceClass;
}

export interface CrossEvidence {
  type: "cross";
  sources: Evidence[];
  match_keys: string[];
  conflict_reason: string;
  captured_at?: string;
  source_class?: SourceClass;
}

export type Evidence =
  | HttpEvidence
  | OpenApiEvidence
  | JsonSchemaEvidence
  | HtmlEvidence
  | RobotsEvidence
  | SitemapEvidence
  | GithubEvidence
  | ManualConfirmationEvidence
  | CrossEvidence;

export type EvidenceType = Evidence["type"];

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isHttpEvidence(e: Evidence): e is HttpEvidence {
  return e.type === "http";
}

export function isOpenApiEvidence(e: Evidence): e is OpenApiEvidence {
  return e.type === "openapi";
}

export function isJsonSchemaEvidence(e: Evidence): e is JsonSchemaEvidence {
  return e.type === "json_schema";
}

export function isHtmlEvidence(e: Evidence): e is HtmlEvidence {
  return e.type === "html";
}

export function isRobotsEvidence(e: Evidence): e is RobotsEvidence {
  return e.type === "robots";
}

export function isSitemapEvidence(e: Evidence): e is SitemapEvidence {
  return e.type === "sitemap";
}

export function isGithubEvidence(e: Evidence): e is GithubEvidence {
  return e.type === "github";
}

export function isManualConfirmationEvidence(e: Evidence): e is ManualConfirmationEvidence {
  return e.type === "manual_confirmation";
}

export function isCrossEvidence(e: Evidence): e is CrossEvidence {
  return e.type === "cross";
}

// ─── Evidence Summary Helper ──────────────────────────────────────────────────

export function evidenceSummary(e: Evidence): string {
  switch (e.type) {
    case "http":
      return `HTTP ${e.status} ${e.url} (${e.content_type ?? "unknown"}) hash=${e.content_hash.slice(0, 12)}`;
    case "openapi":
      return `OpenAPI ${e.url} — ${e.paths.length} paths, ${e.methods.length} methods`;
    case "json_schema":
      return `JSON Schema ${e.url} — ${e.schema_keys.length} keys, valid=${e.valid}`;
    case "html":
      return `HTML ${e.url} — title="${e.title ?? "none"}" hash=${e.content_hash.slice(0, 12)}`;
    case "robots":
      return `robots.txt ${e.url} — status=${e.status}, allows_all=${e.allows_all}, ${e.disallowed_paths.length} disallowed`;
    case "sitemap":
      return `sitemap.xml ${e.url} — status=${e.status}, ${e.url_count} URLs`;
    case "github":
      return `GitHub ${e.repo}/${e.path} — commit=${e.last_commit.slice(0, 8)} hash=${e.content_hash.slice(0, 12)}`;
    case "manual_confirmation":
      return `Manual confirmation by ${e.confirmed_by} at ${e.confirmed_at}: ${e.note}`;
    case "cross":
      return `Cross-evidence — ${e.sources.length} sources, keys=[${e.match_keys.join(", ")}], conflict: ${e.conflict_reason}`;
    default: {
      const _: never = e;
      return `Unknown evidence type: ${JSON.stringify(_)}`;
    }
  }
}
