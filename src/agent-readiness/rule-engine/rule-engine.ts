import type { AgentReadinessRule } from "../rule.schema";
import type { SourceState } from "../scanner/source-state";
import type { ResponseSnapshot } from "../scanner/snapshot";
import { RuleLoader, type LoadedRules } from "./rule-loader";
import { StatusDeterminator, type ApplicabilityPredicate } from "./status-determinator";
import { ConfidenceComputer } from "./confidence";
import { AssertionBuilder, type Assertion } from "./assertion-builder";
import type { Evidence } from "./evidence.types";
import { OpenApiParser } from "./openapi-parser";
import { classifyEvidence } from "./source-hierarchy";

export interface RuleEngineResult {
  assertions: Assertion[];
  rulesetVersion: string;
  scannedAt: string;
  totalRules: number;
  applicableRules: number;
}

class RuleEngineClass {
  private loadedRules: LoadedRules | null = null;
  private applicabilityPredicates: Map<string, ApplicabilityPredicate> = new Map();

  /**
   * Register a custom applicability predicate for a rule.
   */
  registerApplicability(ruleId: string, predicate: ApplicabilityPredicate): void {
    this.applicabilityPredicates.set(ruleId, predicate);
  }

  /**
   * Run all rules against a source state and return assertions.
   */
  run(sourceState: SourceState): RuleEngineResult {
    if (!this.loadedRules) {
      this.loadedRules = RuleLoader.loadFromManifest();
    }

    const assertions: Assertion[] = [];
    let applicableCount = 0;

    for (const rule of this.loadedRules.rules) {
      const isApplicable = this.checkApplicability(rule, sourceState);
      if (isApplicable) applicableCount++;

      const evidence = this.collectEvidence(rule, sourceState);
      this.enrichEvidence(evidence, rule);
      const statusResult = StatusDeterminator.determine({
        rule,
        evidence,
        isApplicable,
      });

      const confidence = ConfidenceComputer.compute({
        rule,
        evidence,
        status: statusResult.status,
      });

      const assertion = AssertionBuilder.build({
        rule,
        evidence,
        status: statusResult.status,
        confidence: confidence ?? 0,
        reason: statusResult.reason,
        sourceUrl: this.getSourceUrl(rule, sourceState),
      });

      assertions.push(assertion);
    }

    // Sort by rule_id
    assertions.sort((a, b) => a.rule_id.localeCompare(b.rule_id));

    return {
      assertions,
      rulesetVersion: this.loadedRules.manifestVersion,
      scannedAt: new Date().toISOString(),
      totalRules: this.loadedRules.rules.length,
      applicableRules: applicableCount,
    };
  }

  /**
   * Check if a rule applies to the given source state.
   */
  private checkApplicability(rule: AgentReadinessRule, sourceState: SourceState): boolean {
    const predicate = this.applicabilityPredicates.get(rule.rule_id);
    if (predicate) {
      return predicate(rule, sourceState);
    }

    // Rules without specific resource dependency are always applicable
    if (!rule.check.target && !rule.check.sources) return true;
    if (rule.check.type === "cross_evidence") return true;

    const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;

    // Use rule.check.sources if available (preferred — explicit mapping)
    if (rule.check.sources && rule.check.sources.length > 0) {
      for (const src of rule.check.sources) {
        if (snapshots[src]) return true;
      }
      return false;
    }

    // Fallback: map target substrings to snapshot keys (backward compat)
    const target = rule.check.target ?? "";
    return this.targetToSnapshotKey(target, snapshots) !== null;
  }

  /**
   * Map a target path to a snapshot key by checking if any snapshot URL contains the target.
   */
  private targetToSnapshotKey(target: string, snapshots: Record<string, ResponseSnapshot | null>): string | null {
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
  private enrichEvidence(evidence: Evidence[], rule: AgentReadinessRule): void {
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
  private collectEvidence(rule: AgentReadinessRule, sourceState: SourceState): Evidence[] {
    const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;
    const evidence: Evidence[] = [];

    const target = rule.check.target ?? "";

    // Handle cross_evidence check type specially
    if (rule.check.type === "cross_evidence") {
      return this.collectCrossEvidence(rule, snapshots);
    }

    // Determine which snapshot keys to collect evidence from
    const sourceKeys: string[] = [];
    if (rule.check.sources && rule.check.sources.length > 0) {
      sourceKeys.push(...rule.check.sources);
    } else {
      const key = this.targetToSnapshotKey(target, snapshots);
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
   * Collect cross-evidence from multiple sources and compare them.
   * Used for cross_evidence check type (e.g., AB-007: Guide ↔ OpenAPI consistency).
   */
  private collectCrossEvidence(
    rule: AgentReadinessRule,
    snapshots: Record<string, ResponseSnapshot | null>,
  ): Evidence[] {
    const sourceKeys = rule.check.sources ?? [];
    const subEvidence: Evidence[] = [];

    // Collect evidence from each source
    for (const srcKey of sourceKeys) {
      const snap = snapshots[srcKey];
      if (!snap) continue;

      if (srcKey === "openapi") {
        const body = snap.body;
        if (body) {
          const facts = OpenApiParser.parse(body);
          subEvidence.push({
            type: "openapi",
            url: snap.url,
            paths: facts.paths,
            methods: facts.methods,
            captured_at: snap.fetchedAt,
          });
        }
      } else if (srcKey === "guide") {
        // Parse guide body for endpoint mentions
        const body = snap.body ?? "";
        const paths: string[] = [];
        const methods: string[] = [];

        // Try parsing as JSON first — agent-guide.json has api_endpoints array
        try {
          const guideJson = JSON.parse(body);
          if (guideJson.api_endpoints && Array.isArray(guideJson.api_endpoints)) {
            for (const ep of guideJson.api_endpoints) {
              const parts = String(ep).split(/\s+/);
              if (parts.length >= 2) {
                methods.push(parts[0].toUpperCase());
                paths.push(parts[1]);
              }
            }
          }
        } catch {
          // Not JSON, fall through to regex parsing
        }

        // Also extract endpoint-like patterns from text (e.g., "GET /api/foo", "POST /bar")
        if (paths.length === 0) {
          const endpointPattern = /(?:^|\s)(GET|POST|PUT|DELETE|PATCH)\s+(\/[^\s]+)/gmi;
          let m: RegExpExecArray | null;
          while ((m = endpointPattern.exec(body)) !== null) {
            methods.push(m[1].toUpperCase());
            paths.push(m[2]);
          }
        }
        subEvidence.push({
          type: "openapi",
          url: snap.url,
          paths,
          methods,
          captured_at: snap.fetchedAt,
        });
      } else {
        // Generic HTTP evidence for other sources
        subEvidence.push({
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
    }

    if (subEvidence.length < 2) {
      return subEvidence;
    }

    // Compare endpoints across OpenAPI-type evidence
    const openApiEvidence = subEvidence.filter((e) => e.type === "openapi") as Extract<Evidence, { type: "openapi" }>[];
    if (openApiEvidence.length >= 2) {
      const matchKeys = rule.check.match_keys ?? [];
      let hasConflict = false;
      let conflictReason = "";

      if (matchKeys.includes("path")) {
        // Compare paths between sources
        const paths1 = new Set(openApiEvidence[0].paths);
        const paths2 = new Set(openApiEvidence[1].paths);
        const onlyIn1 = [...paths1].filter((p) => !paths2.has(p));
        const onlyIn2 = [...paths2].filter((p) => !paths1.has(p));

        // Fuzzy matching: if one source is a subset (guide ⊂ openapi), treat as verified
        // Guide is expected to be a subset of OpenAPI, not a 1:1 match
        const maxLen = Math.max(paths1.size, paths2.size);
        const overlap = maxLen - onlyIn1.length - onlyIn2.length;
        const coverage = maxLen > 0 ? overlap / maxLen : 1;

        // If coverage >= 80%, no conflict (guide covers most OpenAPI paths)
        if (coverage < 0.8 && (onlyIn1.length > 0 || onlyIn2.length > 0)) {
          hasConflict = true;
          conflictReason = `Paths differ: only in ${openApiEvidence[0].url}: [${onlyIn1.join(", ")}], only in ${openApiEvidence[1].url}: [${onlyIn2.join(", ")}]`;
        }
      }

      if (!hasConflict && matchKeys.includes("method")) {
        // Compare methods for matching paths
        const ev1 = openApiEvidence[0];
        const ev2 = openApiEvidence[1];
        const methods1 = new Set(ev1.methods);
        const methods2 = new Set(ev2.methods);
        const onlyIn1 = [...methods1].filter((m) => !methods2.has(m));
        const onlyIn2 = [...methods2].filter((m) => !methods1.has(m));
        if (onlyIn1.length > 0 || onlyIn2.length > 0) {
          hasConflict = true;
          conflictReason = `Methods differ: only in ${ev1.url}: [${onlyIn1.join(", ")}], only in ${ev2.url}: [${onlyIn2.join(", ")}]`;
        }
      }

      if (hasConflict) {
        return [{
          type: "cross",
          sources: subEvidence,
          match_keys: matchKeys,
          conflict_reason: conflictReason || rule.check.conflict_when || "sources disagree",
        }];
      }

      // No conflict — return cross evidence with no conflict
      return [{
        type: "cross",
        sources: subEvidence,
        match_keys: matchKeys,
        conflict_reason: "",
      }];
    }

    return subEvidence;
  }

  /**
   * Get the source URL for a rule from the source state.
   */
  private getSourceUrl(rule: AgentReadinessRule, sourceState: SourceState): string | null {
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
    const key = this.targetToSnapshotKey(target, snapshots);
    return key ? snapshots[key]!.url : null;
  }

  /**
   * Reset the engine state (useful for testing).
   */
  reset(): void {
    this.loadedRules = null;
    this.applicabilityPredicates.clear();
  }
}

export const RuleEngine = new RuleEngineClass();
export { RuleEngineClass };
