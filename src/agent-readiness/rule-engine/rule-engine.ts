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

    // Default: rule is applicable if its check target resource exists in snapshots
    if (!rule.check.target) return true;

    const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;
    const target = rule.check.target;

    // Map common targets to snapshot keys
    if (target.includes("robots") && snapshots.robots) return true;
    if (target.includes("sitemap") && snapshots.sitemap) return true;
    if (target.includes("agent-guide") && snapshots.guide) return true;
    if (target.includes("openapi") && snapshots.openapi) return true;
    if (target.includes("mcp") && snapshots.mcp) return true;
    if (target.includes("llms") && snapshots.llms) return true;

    // Rules without specific resource dependency are always applicable
    if (rule.check.type === "cross_evidence") return true;

    return false;
  }

  /**
   * Collect evidence from source state for a rule.
   */
  private collectEvidence(rule: AgentReadinessRule, sourceState: SourceState): Evidence[] {
    const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;
    const evidence: Evidence[] = [];

    const target = rule.check.target ?? "";

    if (target.includes("robots") && snapshots.robots) {
      evidence.push({
        type: "robots",
        url: snapshots.robots.url,
        status: snapshots.robots.status,
        allows_all: true,
        disallowed_paths: [],
      });
    }

    if (target.includes("sitemap") && snapshots.sitemap) {
      const sitemapUrls: string[] = [];
      const bodyText = snapshots.sitemap.body;
      if (bodyText) {
        const locMatches = bodyText.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
        for (const m of locMatches) {
          sitemapUrls.push(m[1].trim());
        }
      }
      evidence.push({
        type: "sitemap",
        url: snapshots.sitemap.url,
        status: snapshots.sitemap.status,
        url_count: sitemapUrls.length,
        urls: sitemapUrls.slice(0, 100),
      });
    }

    if (target.includes("agent-guide") && snapshots.guide) {
      evidence.push({
        type: "http",
        url: snapshots.guide.url,
        status: snapshots.guide.status,
        headers: {},
        content_hash: snapshots.guide.bodyHash,
        content_type: snapshots.guide.contentType,
        resolved_ip: snapshots.guide.resolvedIp,
      });
    }

    if (target.includes("openapi") && snapshots.openapi) {
      const body = snapshots.openapi.body;
      if (body) {
        const facts = OpenApiParser.parse(body);
        evidence.push({
          type: "openapi",
          url: snapshots.openapi.url,
          paths: facts.paths,
          methods: facts.methods,
        });
      } else {
        evidence.push({
          type: "openapi",
          url: snapshots.openapi.url,
          paths: [],
          methods: [],
        });
      }
    }

    if (target.includes("mcp") && snapshots.mcp) {
      evidence.push({
        type: "http",
        url: snapshots.mcp.url,
        status: snapshots.mcp.status,
        headers: {},
        content_hash: snapshots.mcp.bodyHash,
        content_type: snapshots.mcp.contentType,
        resolved_ip: snapshots.mcp.resolvedIp,
      });
    }

    if (target.includes("llms") && snapshots.llms) {
      evidence.push({
        type: "http",
        url: snapshots.llms.url,
        status: snapshots.llms.status,
        headers: {},
        content_hash: snapshots.llms.bodyHash,
        content_type: snapshots.llms.contentType,
        resolved_ip: snapshots.llms.resolvedIp,
      });
    }

    return evidence;
  }

  /**
   * Get the source URL for a rule from the source state.
   */
  private getSourceUrl(rule: AgentReadinessRule, sourceState: SourceState): string | null {
    const snapshots = sourceState.snapshots as Record<string, ResponseSnapshot | null>;
    const target = rule.check.target ?? "";

    if (target.includes("robots") && snapshots.robots) return snapshots.robots.url;
    if (target.includes("sitemap") && snapshots.sitemap) return snapshots.sitemap.url;
    if (target.includes("agent-guide") && snapshots.guide) return snapshots.guide.url;
    if (target.includes("openapi") && snapshots.openapi) return snapshots.openapi.url;
    if (target.includes("mcp") && snapshots.mcp) return snapshots.mcp.url;
    if (target.includes("llms") && snapshots.llms) return snapshots.llms.url;

    return null;
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
