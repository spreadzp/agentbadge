// EPIC-140 (SLICE-140-18): rule-engine.ts split — evidence collection extracted
// from RuleEngineClass private methods into standalone functions (pure moves).
import type { AgentReadinessRule } from "../rule.schema";
import type { SourceState } from "../scanner/source-state";
import type { ResponseSnapshot } from "../scanner/snapshot";
import type { Evidence } from "./evidence.types";
import { OpenApiParser } from "./openapi-parser";
import { classifyEvidence } from "./source-hierarchy";
import { SEMANTIC_CHECKERS } from "./semantic-checkers";
import { collectCrossEvidence } from "./cross-evidence";

/**
 * Map a target path to a snapshot key by checking if any snapshot URL contains the target.
 */
export function targetToSnapshotKey(target: string, snapshots: Record<string, ResponseSnapshot | null>): string | null {
  // Direct key match
  if (snapshots[target]) return target;

  // Substring matching for common targets
  const targetMap: Record<string, string> = {
    "robots": "robots",
    "sitemap": "sitemap",
    "agent-guide": "guide",
    "openapi": "openapi",
    "mcp": "mcp",
    "llms-full": "llms_full",
    "llms": "llms",
    "skill": "skill",
    "agents.txt": "agents_txt",
    "webmcp": "webmcp",
    "x402": "x402",
    "content_negotiation": "content_negotiation",
    "rss": "rss_feed",
    "feed": "rss_feed",
    "did.json": "identity",
    "webfinger": "identity",
    "oauth": "bot_auth",
    "oauth-authorization-server": "identity",
    "http-message-signatures": "bot_auth",
    "infrastructure": "infrastructure",
    "agent-card": "a2a",
    "homepage": "homepage_meta",
    "heartbeat": "heartbeat",
    "skill_json": "skill_json",
    "error_catalog": "error_catalog",
    "agent_feeds": "agent_feeds",
    "favicon": "favicon",
    "favicon.svg": "favicon",
    "og-image": "content_negotiation",
    "nonexistent": "content_negotiation",
    "pricing": "pricing",
    "pricing.json": "pricing",
    "passport": "l402",
    "passport/request": "l402",
  };

  for (const [substr, key] of Object.entries(targetMap)) {
    if (target.includes(substr) && snapshots[key]) return key;
  }

  // Check all snapshot URLs for target substring
  for (const [key, snap] of Object.entries(snapshots)) {
    if (snap && snap.url.includes(target)) return key;
  }

  return null;
}

/**
 * Enrich evidence with captured_at (from snapshot) and source_class.
 * Single enrichment pass — less invasive than editing every construction site.
 */
export function enrichEvidence(evidence: Evidence[], rule: AgentReadinessRule): void {
  for (const ev of evidence) {
    if (!ev.source_class) {
      ev.source_class = classifyEvidence(ev, rule.check.type);
    }
  }
  // For cross evidence, compute captured_at as max of member sources
  for (const ev of evidence) {
    if (ev.type === "cross" && !ev.captured_at) {
      const memberTimestamps = ev.sources
        .map((s) => s.captured_at)
        .filter((t): t is string => typeof t === "string" && t.length > 0);
      if (memberTimestamps.length > 0) {
        ev.captured_at = memberTimestamps.reduce((max, t) => (t > max ? t : max), memberTimestamps[0]);
      }
    }
  }
}

/**
 * Collect evidence from source state for a rule.
 */
export function collectEvidence(rule: AgentReadinessRule, sourceState: SourceState): Evidence[] {
  const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;
  const evidence: Evidence[] = [];

  const target = rule.check.target ?? "";

  // Handle cross_evidence check type specially
  if (rule.check.type === "cross_evidence") {
    return collectCrossEvidence(rule, snapshots);
  }

  // Handle semantic_validation: run named semantic checker, wrap result as http evidence
  if (rule.check.type === "semantic_validation") {
    const semanticId = rule.check.semantic as string | undefined;
    if (!semanticId || !SEMANTIC_CHECKERS[semanticId]) {
      return [];
    }
    const checker = SEMANTIC_CHECKERS[semanticId];
    const result = checker(snapshots);

    // Find the primary source snapshot to attach evidence metadata
    const sourceKeys = rule.check.sources ?? [];
    const primarySnap = sourceKeys.length > 0
      ? snapshots[sourceKeys[0]]
      : null;

    if (!primarySnap) {
      // Source snapshot missing — still produce evidence with no_source outcome
      return [{
        type: "http" as const,
        url: "",
        status: 0,
        headers: {},
        content_hash: "",
        content_type: null,
        resolved_ip: null,
        semantic_outcome: result.outcome,
        semantic_detail: result.detail,
      }];
    }

    return [{
      type: "http" as const,
      url: primarySnap.url,
      status: primarySnap.status,
      headers: primarySnap.headers ?? {},
      content_hash: primarySnap.bodyHash,
      content_type: primarySnap.contentType,
      resolved_ip: primarySnap.resolvedIp,
      captured_at: primarySnap.fetchedAt,
      semantic_outcome: result.outcome,
      semantic_detail: result.detail,
    }];
  }

  // Determine which snapshot keys to collect evidence from
  const sourceKeys: string[] = [];
  if (rule.check.sources && rule.check.sources.length > 0) {
    sourceKeys.push(...rule.check.sources);
  } else {
    const key = targetToSnapshotKey(target, snapshots);
    if (key) sourceKeys.push(key);
  }

  // Collect evidence from each source snapshot
  for (const srcKey of sourceKeys) {
    const snap = snapshots[srcKey];
    if (!snap) continue;

    // Special handling for known types
    if (srcKey === "robots") {
      evidence.push({
        type: "robots",
        url: snap.url,
        status: snap.status,
        allows_all: true,
        disallowed_paths: [],
        captured_at: snap.fetchedAt,
      });
      continue;
    }

    if (srcKey === "sitemap") {
      const sitemapUrls: string[] = [];
      const bodyText = snap.body;
      if (bodyText) {
        const locMatches = bodyText.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
        for (const m of locMatches) {
          sitemapUrls.push(m[1].trim());
        }
      }
      evidence.push({
        type: "sitemap",
        url: snap.url,
        status: snap.status,
        url_count: sitemapUrls.length,
        urls: sitemapUrls.slice(0, 100),
        captured_at: snap.fetchedAt,
      });
      continue;
    }

    if (srcKey === "openapi") {
      const body = snap.body;
      if (body) {
        const facts = OpenApiParser.parse(body);
        evidence.push({
          type: "openapi",
          url: snap.url,
          paths: facts.paths,
          methods: facts.methods,
          captured_at: snap.fetchedAt,
        });
      } else {
        evidence.push({
          type: "openapi",
          url: snap.url,
          paths: [],
          methods: [],
          captured_at: snap.fetchedAt,
        });
      }
      continue;
    }

    // Identity snapshot: parse JSON body and create evidence for each found endpoint
    if (srcKey === "identity") {
      const baseUrl = snap.url.replace(/\/\.well-known\/?$/, "");
      try {
        const parsed = JSON.parse(snap.body ?? "{}");
        // Identity fetcher wraps results in { source, data } structure
        const identityData = parsed.data ?? parsed;
        const endpointMap: Record<string, string> = {
          webfinger: "/.well-known/webfinger",
          hostMeta: "/.well-known/host-meta",
          did: "/.well-known/did.json",
          oauthAuthorizationServer: "/.well-known/oauth-authorization-server",
          appleAppLinks: "/.well-known/apple-app-site-association",
          androidAssetLinks: "/.well-known/assetlinks.json",
        };
        for (const [key, path] of Object.entries(endpointMap)) {
          if (identityData[key]) {
            evidence.push({
              type: "http",
              url: `${baseUrl}${path}`,
              status: 200,
              headers: snap.headers ?? {},
              content_hash: snap.bodyHash,
              content_type: snap.contentType,
              resolved_ip: snap.resolvedIp,
              captured_at: snap.fetchedAt,
            });
          }
        }
      } catch {
        // Fall through to generic evidence
      }
      if (evidence.length === 0) {
        // No parsed endpoints found, create generic evidence
        evidence.push({
          type: "http",
          url: snap.url,
          status: snap.status,
          headers: snap.headers ?? {},
          content_hash: snap.bodyHash,
          content_type: snap.contentType,
          resolved_ip: snap.resolvedIp,
          captured_at: snap.fetchedAt,
        });
      }
      continue;
    }

    // Generic HTTP evidence for all other snapshot types
    evidence.push({
      type: "http",
      url: snap.url,
      status: snap.status,
      headers: snap.headers ?? {},
      content_hash: snap.bodyHash,
      content_type: snap.contentType,
      resolved_ip: snap.resolvedIp,
      captured_at: snap.fetchedAt,
    });
  }

  return evidence;
}

/**
 * Get the source URL for a rule from the source state.
 */
export function getSourceUrl(rule: AgentReadinessRule, sourceState: SourceState): string | null {
  const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;

  // Use rule.check.sources if available
  if (rule.check.sources && rule.check.sources.length > 0) {
    for (const src of rule.check.sources) {
      if (snapshots[src]) return snapshots[src]!.url;
    }
  }

  // Fallback: target-to-snapshot-key mapping
  const target = rule.check.target ?? "";
  if (!target) return null;
  const key = targetToSnapshotKey(target, snapshots);
  return key ? snapshots[key]!.url : null;
}
