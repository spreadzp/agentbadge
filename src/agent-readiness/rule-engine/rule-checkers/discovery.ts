import type { SourceState } from "../../scanner/source-state";
import type { Evidence } from "../evidence.types";
import { OpenApiParser } from "../openapi-parser";
import { getSnapshots, httpEvidence, robotsEvidence, sitemapEvidence, openapiEvidence } from "./helpers";

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
  const bodyText = snaps.sitemap.body;
  const urls: string[] = [];
  if (bodyText) {
    const matches = bodyText.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
    for (const m of matches) urls.push(m[1].trim());
  }
  return [sitemapEvidence(snaps.sitemap, urls.length, urls.slice(0, 100))];
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
  const body = snaps.openapi.body;
  if (body) {
    return [OpenApiParser.parseToEvidence(body, snaps.openapi.url)];
  }
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
  if (snaps.openapi) {
    const body = snaps.openapi.body;
    if (body) evidence.push(OpenApiParser.parseToEvidence(body, snaps.openapi.url));
    else evidence.push(openapiEvidence(snaps.openapi, [], []));
  }
  return evidence;
}

// ─── AB-008: auth declared ─────────────────────────────────────────────────
export function checkAb008(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  const body = snaps.openapi.body;
  if (body) return [OpenApiParser.parseToEvidence(body, snaps.openapi.url)];
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
  if (snaps.openapi) {
    const body = snaps.openapi.body;
    if (body) evidence.push(OpenApiParser.parseToEvidence(body, snaps.openapi.url));
    else evidence.push(openapiEvidence(snaps.openapi, [], []));
  }
  return evidence;
}

// ─── AB-011: rate limits declared ──────────────────────────────────────────
export function checkAb011(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  const body = snaps.openapi.body;
  if (body) return [OpenApiParser.parseToEvidence(body, snaps.openapi.url)];
  return [openapiEvidence(snaps.openapi, [], [])];
}

// ─── AB-012: structured error schema declared ──────────────────────────────
export function checkAb012(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.openapi) return [];
  const body = snaps.openapi.body;
  if (body) return [OpenApiParser.parseToEvidence(body, snaps.openapi.url)];
  return [openapiEvidence(snaps.openapi, [], [])];
}

// ─── AB-013: owner verification status (passive) ───────────────────────────
export function checkAb013(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.guide) return [];
  return [httpEvidence(snaps.guide)];
}

// ─── AB-014: llms.txt present ───────────────────────────────────────────────
export function checkAb014(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.llms) return [];
  return [httpEvidence(snaps.llms)];
}
