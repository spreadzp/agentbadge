import type { AgentReadinessRule } from "../rule.schema";
import type { SourceState } from "../scanner/source-state";
import type { ResponseSnapshot } from "../scanner/snapshot";
import { RuleLoader, type LoadedRules } from "./rule-loader";
import { StatusDeterminator, type ApplicabilityPredicate } from "./status-determinator";
import { ConfidenceComputer } from "./confidence";
import { AssertionBuilder, type Assertion } from "./assertion-builder";
import type { Evidence } from "./evidence.types";
import { OpenApiParser } from "./openapi-parser";

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
      "http-message-signatures": "bot_auth",
      "infrastructure": "infrastructure",
      "agent-card": "a2a",
      "homepage": "homepage_meta",
      "favicon": "content_negotiation",
      "og-image": "content_negotiation",
      "nonexistent": "content_negotiation",
      "passport": "x402",
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
   * Collect evidence from source state for a rule.
   */
  private collectEvidence(rule: AgentReadinessRule, sourceState: SourceState): Evidence[] {
    const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;
    const evidence: Evidence[] = [];

    const target = rule.check.target ?? "";

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
          });
        } else {
          evidence.push({
            type: "openapi",
            url: snap.url,
            paths: [],
            methods: [],
          });
        }
        continue;
      }

      // Generic HTTP evidence for all other snapshot types
      evidence.push({
        type: "http",
        url: snap.url,
        status: snap.status,
        headers: {},
        content_hash: snap.bodyHash,
        content_type: snap.contentType,
        resolved_ip: snap.resolvedIp,
      });
    }

    return evidence;
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
