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

function jsonSchemaEvidence(s: ResponseSnapshot, schemaKeys: string[], valid: boolean): Evidence {
  return {
    type: "json_schema",
    url: s.url,
    schema_keys: schemaKeys,
    valid,
  };
}

function crossEvidence(sources: Evidence[], matchKeys: string[], conflictReason: string): Evidence {
  return {
    type: "cross",
    sources,
    match_keys: matchKeys,
    conflict_reason: conflictReason,
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

// ─── AB-104: Blog article OpenGraph type ─────────────────────────────────────
export function checkAb104(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.og_meta) return [];
  const body = snaps.og_meta.body;
  if (!body) return [htmlEvidence(snaps.og_meta, "")];
  try {
    const parsed = JSON.parse(body);
    return [htmlEvidence(snaps.og_meta, parsed.data?.ogType ?? "")];
  } catch {
    return [htmlEvidence(snaps.og_meta, "")];
  }
}

// ─── AB-105: Article author and date meta tags ────────────────────────────────
export function checkAb105(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.og_meta) return [];
  const body = snaps.og_meta.body;
  if (!body) return [htmlEvidence(snaps.og_meta, "")];
  try {
    const parsed = JSON.parse(body);
    return [htmlEvidence(snaps.og_meta, parsed.data?.articleAuthor ?? "")];
  } catch {
    return [htmlEvidence(snaps.og_meta, "")];
  }
}

// ─── AB-106: AEO short-answer summary block ───────────────────────────────────
export function checkAb106(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.aeo_content) return [];
  const body = snaps.aeo_content.body;
  if (!body) return [htmlEvidence(snaps.aeo_content, "")];
  try {
    const parsed = JSON.parse(body);
    return [htmlEvidence(snaps.aeo_content, parsed.data?.hasShortAnswer ? "short-answer" : "")];
  } catch {
    return [htmlEvidence(snaps.aeo_content, "")];
  }
}

// ─── AB-107: Semantic definition lists in guide content ───────────────────────
export function checkAb107(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.semantic_html) return [];
  const body = snaps.semantic_html.body;
  if (!body) return [htmlEvidence(snaps.semantic_html, "")];
  try {
    const parsed = JSON.parse(body);
    return [htmlEvidence(snaps.semantic_html, parsed.data?.hasDefinitionList ? "definition-list" : "")];
  } catch {
    return [htmlEvidence(snaps.semantic_html, "")];
  }
}

// ─── AB-108: OG image alt text brand consistency ──────────────────────────────
export function checkAb108(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.og_meta) return [];
  const body = snaps.og_meta.body;
  if (!body) return [htmlEvidence(snaps.og_meta, "")];
  try {
    const parsed = JSON.parse(body);
    return [htmlEvidence(snaps.og_meta, parsed.data?.ogImageAlt ?? "")];
  } catch {
    return [htmlEvidence(snaps.og_meta, "")];
  }
}

// ─── AB-109: Agent Card version 1.0.0+ ────────────────────────────────────────
export function checkAb109(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.agent_card) return [];
  const body = snaps.agent_card.body;
  if (!body) return [jsonSchemaEvidence(snaps.agent_card, [], false)];
  try {
    const parsed = JSON.parse(body);
    const version = parsed.version ?? "";
    const valid = /^\d+\.\d+\.\d+$/.test(version) &&
      [...version.split(".").map(Number)][0] >= 1;
    return [jsonSchemaEvidence(snaps.agent_card, Object.keys(parsed), valid)];
  } catch {
    return [jsonSchemaEvidence(snaps.agent_card, [], false)];
  }
}

// ─── AB-110: Blog articles in AI sitemap ───────────────────────────────────────
export function checkAb110(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.ai_sitemap) return [];
  const body = snaps.ai_sitemap.body;
  if (!body) return [sitemapEvidence(snaps.ai_sitemap, 0, [])];
  const urls: string[] = [];
  const matches = body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
  for (const m of matches) urls.push(m[1].trim());
  const blogUrls = urls.filter((u) => /\/blog\//i.test(u));
  return [sitemapEvidence(snaps.ai_sitemap, blogUrls.length, blogUrls.slice(0, 50))];
}

// ─── AB-111: Crawl-delay directive in robots.txt ───────────────────────────────
export function checkAb111(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.robots) return [];
  const body = snaps.robots.body;
  if (!body) return [robotsEvidence(snaps.robots, true, [])];
  const hasCrawlDelay = /^crawl-delay\s*:/im.test(body);
  return [robotsEvidence(snaps.robots, hasCrawlDelay, [])];
}

// ─── AB-112: OAuth Authorization Server metadata (RFC 9728) ────────────────────
export function checkAb112(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.oauth_authorization_server) return [];
  return [httpEvidence(snaps.oauth_authorization_server)];
}

// ─── AB-113: LLM policy file ───────────────────────────────────────────────────
export function checkAb113(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.llm_policy) return [];
  return [httpEvidence(snaps.llm_policy)];
}

// ─── AB-114: AI sitemap content type coverage ──────────────────────────────────
export function checkAb114(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  const evidence: Evidence[] = [];
  let aiCount = 0;
  let sitemapCount = 0;
  if (snaps.ai_sitemap) {
    const body = snaps.ai_sitemap.body;
    if (body) {
      const matches = body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
      aiCount = [...matches].length;
    }
    evidence.push(sitemapEvidence(snaps.ai_sitemap, aiCount, []));
  }
  if (snaps.sitemap) {
    const body = snaps.sitemap.body;
    if (body) {
      const matches = body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
      sitemapCount = [...matches].length;
    }
    evidence.push(sitemapEvidence(snaps.sitemap, sitemapCount, []));
  }
  if (evidence.length === 0) return [];
  const conflictReason = aiCount < sitemapCount * 0.5
    ? `ai_sitemap_url_count (${aiCount}) < sitemap_url_count (${sitemapCount}) * 0.5`
    : "no conflict";
  return [crossEvidence(evidence, ["url_count"], conflictReason)];
}

// ─── AB-115: MCP namespace-based tool isolation ────────────────────────────────
export function checkAb115(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.mcp_probe) return [];
  const s = snaps.mcp_probe;
  try {
    const parsed = JSON.parse(s.body ?? "{}");
    const tools = parsed?.data?.toolsList?.tools ?? [];
    for (const tool of tools) {
      if (tool.name && tool.name.includes(".")) {
        // namespaced tool detected
      }
    }
  } catch {
    // invalid JSON — still return http evidence
  }
  return [{
    type: "http",
    url: s.url,
    status: s.status,
    headers: {},
    content_hash: s.bodyHash,
    content_type: s.contentType,
    resolved_ip: s.resolvedIp,
  }];
}

// ─── AB-116: Well-known MCP descriptor ─────────────────────────────────────────
export function checkAb116(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.mcp) return [];
  return [httpEvidence(snaps.mcp)];
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
  "AB-014": checkAb014,
  "AB-104": checkAb104,
  "AB-105": checkAb105,
  "AB-106": checkAb106,
  "AB-107": checkAb107,
  "AB-108": checkAb108,
  "AB-109": checkAb109,
  "AB-110": checkAb110,
  "AB-111": checkAb111,
  "AB-112": checkAb112,
  "AB-113": checkAb113,
  "AB-114": checkAb114,
  "AB-115": checkAb115,
  "AB-116": checkAb116,
};
