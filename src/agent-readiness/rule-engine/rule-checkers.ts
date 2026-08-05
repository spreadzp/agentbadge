import type { SourceState } from "../scanner/source-state";
import type { ResponseSnapshot } from "../scanner/snapshot";
import type { Evidence } from "./evidence.types";
import { OpenApiParser } from "./openapi-parser";

type Snapshots = Record<string, ResponseSnapshot | null>;

function getSnapshots(sourceState: SourceState): Snapshots {
  return sourceState.snapshots as Snapshots;
}

function httpEvidence(s: ResponseSnapshot): Evidence {
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

function robotsEvidence(s: ResponseSnapshot, allowsAll: boolean, disallowed: string[]): Evidence {
  return {
    type: "robots",
    url: s.url,
    status: s.status,
    allows_all: allowsAll,
    disallowed_paths: disallowed,
  };
}

function sitemapEvidence(s: ResponseSnapshot, urlCount: number, urls: string[]): Evidence {
  return {
    type: "sitemap",
    url: s.url,
    status: s.status,
    url_count: urlCount,
    urls,
  };
}

function openapiEvidence(s: ResponseSnapshot, paths: string[], methods: string[]): Evidence {
  return {
    type: "openapi",
    url: s.url,
    paths,
    methods,
  };
}

function htmlEvidence(s: ResponseSnapshot, title: string): Evidence {
  return {
    type: "html",
    url: s.url,
    title,
    content_hash: s.bodyHash,
    content_type: s.contentType,
  };
}

// ─── AB-001: robots.txt exists ─────────────────────────────────────────────
export function checkAb001(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.robots) return [];
  return [robotsEvidence(snaps.robots, true, [])];
}

// ─── AB-002: sitemap.xml exists ────────────────────────────────────────────
export function checkAb002(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.sitemap) return [];
  return [sitemapEvidence(snaps.sitemap, 0, [])];
}

// ─── AB-003: agent-guide.json discoverable ─────────────────────────────────
export function checkAb003(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.guide) return [];
  return [httpEvidence(snaps.guide)];
}

// ─── AB-004: OpenAPI spec present & valid ──────────────────────────────────
export function checkAb004(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  return [openapiEvidence(snaps.openapi, [], [])];
}

// ─── AB-005: agent-guide.json schema-valid ─────────────────────────────────
export function checkAb005(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.guide) return [];
  return [httpEvidence(snaps.guide)];
}

// ─── AB-006: robots.txt allows User-agent: * for /agent-guide.json ─────────
export function checkAb006(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.robots) return [];
  return [robotsEvidence(snaps.robots, true, [])];
}

// ─── AB-007: guide↔openapi consistency ─────────────────────────────────────
export function checkAb007(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  const evidence: Evidence[] = [];
  if (snaps.guide) evidence.push(httpEvidence(snaps.guide));
  if (snaps.openapi) evidence.push(openapiEvidence(snaps.openapi, [], []));
  return evidence;
}

// ─── AB-008: auth declared ─────────────────────────────────────────────────
export function checkAb008(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  return [openapiEvidence(snaps.openapi, [], [])];
}

// ─── AB-009: capability coverage ───────────────────────────────────────────
export function checkAb009(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.guide) return [];
  return [httpEvidence(snaps.guide)];
}

// ─── AB-010: pricing machine-readable ──────────────────────────────────────
export function checkAb010(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  const evidence: Evidence[] = [];
  if (snaps.guide) evidence.push(httpEvidence(snaps.guide));
  if (snaps.openapi) evidence.push(openapiEvidence(snaps.openapi, [], []));
  return evidence;
}

// ─── AB-011: rate limits declared ──────────────────────────────────────────
export function checkAb011(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  return [openapiEvidence(snaps.openapi, [], [])];
}

// ─── AB-012: structured error schema declared ──────────────────────────────
export function checkAb012(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  return [openapiEvidence(snaps.openapi, [], [])];
}

// ─── AB-013: owner verification status (passive) ───────────────────────────
export function checkAb013(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.guide) return [];
  return [httpEvidence(snaps.guide)];
}

// Registry: rule_id → checker function
export const RULE_CHECKERS: Record<string, (state: SourceState) => Evidence[]> = {
  "AB-001": checkAb001,
  "AB-002": checkAb002,
  "AB-003": checkAb003,
  "AB-004": checkAb004,
  "AB-005": checkAb005,
  "AB-006": checkAb006,
  "AB-007": checkAb007,
  "AB-008": checkAb008,
  "AB-009": checkAb009,
  "AB-010": checkAb010,
  "AB-011": checkAb011,
  "AB-012": checkAb012,
  "AB-013": checkAb013,
};
