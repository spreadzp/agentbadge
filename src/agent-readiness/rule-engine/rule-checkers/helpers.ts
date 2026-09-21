// EPIC-140 (SLICE-140-18): rule-checkers.ts split by rule category.
// Shared snapshot accessor + Evidence builders used by all checkers.
import type { SourceState } from "../../scanner/source-state";
import type { ResponseSnapshot } from "../../scanner/snapshot";
import type { Evidence } from "../evidence.types";

export type Snapshots = Record<string, ResponseSnapshot | null>;

export function getSnapshots(sourceState: SourceState): Snapshots {
  return sourceState.snapshots as Snapshots;
}

export function httpEvidence(s: ResponseSnapshot): Evidence {
  return {
    type: "http",
    url: s.url,
    status: s.status,
    headers: {},
    content_hash: s.bodyHash,
    content_type: s.contentType,
    resolved_ip: s.resolvedIp,
  };
}

export function robotsEvidence(s: ResponseSnapshot, allowsAll: boolean, disallowed: string[], crawlDelay?: boolean): Evidence {
  return {
    type: "robots",
    url: s.url,
    status: s.status,
    allows_all: allowsAll,
    disallowed_paths: disallowed,
    ...(crawlDelay !== undefined ? { crawl_delay: crawlDelay } : {}),
  };
}

export function sitemapEvidence(s: ResponseSnapshot, urlCount: number, urls: string[]): Evidence {
  return {
    type: "sitemap",
    url: s.url,
    status: s.status,
    url_count: urlCount,
    urls,
  };
}

export function openapiEvidence(s: ResponseSnapshot, paths: string[], methods: string[]): Evidence {
  return {
    type: "openapi",
    url: s.url,
    paths,
    methods,
  };
}

export function htmlEvidence(s: ResponseSnapshot, title: string): Evidence {
  return {
    type: "html",
    url: s.url,
    title,
    content_hash: s.bodyHash,
    content_type: s.contentType,
  };
}

export function jsonSchemaEvidence(s: ResponseSnapshot, schemaKeys: string[], valid: boolean): Evidence {
  return {
    type: "json_schema",
    url: s.url,
    schema_keys: schemaKeys,
    valid,
  };
}

export function crossEvidence(sources: Evidence[], matchKeys: string[], conflictReason: string): Evidence {
  return {
    type: "cross",
    sources,
    match_keys: matchKeys,
    conflict_reason: conflictReason,
  };
}
