import type { SourceState } from "../../scanner/source-state";
import type { Evidence } from "../evidence.types";
import { getSnapshots, httpEvidence, robotsEvidence, sitemapEvidence, htmlEvidence, jsonSchemaEvidence, crossEvidence } from "./helpers";

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
  return [robotsEvidence(snaps.robots, true, [], hasCrawlDelay)];
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

// ─── AB-117: Image alt text coverage ───────────────────────────────────────────
export function checkAb117(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.accessibility) return [];
  return [httpEvidence(snaps.accessibility)];
}

// ─── AB-118: Lazy loading on below-fold images ─────────────────────────────────
export function checkAb118(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.accessibility) return [];
  return [httpEvidence(snaps.accessibility)];
}

// ─── AB-098: Content-Security-Policy header ────────────────────────────────────
export function checkAb098(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.infrastructure) return [];
  return [httpEvidence(snaps.infrastructure)];
}

// ─── AB-099: Referrer-Policy header ────────────────────────────────────────────
export function checkAb099(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.infrastructure) return [];
  return [httpEvidence(snaps.infrastructure)];
}

// ─── AB-100: Service page content depth ───────────────────────────────────────
export function checkAb100(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.content_depth) return [];
  return [httpEvidence(snaps.content_depth)];
}

// ─── AB-101: Breadcrumb navigation on service pages ────────────────────────────
export function checkAb101(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.semantic_html) return [];
  return [httpEvidence(snaps.semantic_html)];
}

// ─── AB-102: MCP tools and REST endpoints parity ──────────────────────────────
export function checkAb102(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  const evidence: Evidence[] = [];
  let mcpToolCount = 0;
  let openapiEndpointCount = 0;

  if (snaps.mcp_probe) {
    try {
      const parsed = JSON.parse(snaps.mcp_probe.body ?? "{}");
      mcpToolCount = parsed?.data?.toolsList?.tools?.length ?? 0;
      evidence.push(httpEvidence(snaps.mcp_probe));
    } catch {
      evidence.push(httpEvidence(snaps.mcp_probe));
    }
  }

  if (snaps.openapi) {
    try {
      const parsed = JSON.parse(snaps.openapi.body ?? "{}");
      openapiEndpointCount = Object.keys(parsed?.paths ?? {}).length;
      evidence.push(httpEvidence(snaps.openapi));
    } catch {
      evidence.push(httpEvidence(snaps.openapi));
    }
  }

  if (evidence.length === 0) return [];
  const conflictReason = mcpToolCount < openapiEndpointCount * 0.5
    ? `mcp_tool_count (${mcpToolCount}) < openapi_endpoint_count (${openapiEndpointCount}) * 0.5`
    : "no conflict";
  return [crossEvidence(evidence, ["tool_count", "endpoint_count"], conflictReason)];
}

// ─── AB-103: check_compliance MCP tool available ───────────────────────────────
export function checkAb103(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.mcp_probe) return [];
  return [httpEvidence(snaps.mcp_probe)];
}
