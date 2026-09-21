import type { AgentReadinessRule } from "../rule.schema";
import type { SourceState } from "../scanner/source-state";
import type { ResponseSnapshot } from "../scanner/snapshot";
import { RuleLoader, type LoadedRules } from "./rule-loader";
import { StatusDeterminator, type ApplicabilityPredicate } from "./status-determinator";
import { ConfidenceComputer } from "./confidence";
import { AssertionBuilder, type Assertion } from "./assertion-builder";
import { collectEvidence, enrichEvidence, getSourceUrl, targetToSnapshotKey } from "./evidence-collector";
import { BUNDLE_IDS, resolveBundleIds, rulesForBundles } from "../rule-bundles";
import type { BundleId } from "../rule-bundles";
import { logger } from "@agentbadge/passport";

export interface RuleEngineResult {
  assertions: Assertion[];
  rulesetVersion: string;
  scannedAt: string;
  totalRules: number;
  applicableRules: number;
  /** Resolved bundle ids that scoped this run (all 10 when unscoped). */
  bundles: BundleId[];
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
   * Optional `packs` filter restricts evaluation to rules in the given
   * bundles — accepts canonical BundleIds and legacy PackId aliases
   * (EPIC-133). Unknown ids are ignored with a warn log.
   */
  run(sourceState: SourceState, opts?: { packs?: string[] }): RuleEngineResult {
    if (!this.loadedRules) {
      this.loadedRules = RuleLoader.loadFromManifest();
    }

    let bundles: BundleId[] = [...BUNDLE_IDS];
    let rules = this.loadedRules.rules;
    if (opts?.packs?.length) {
      const { ok, unknown } = resolveBundleIds(opts.packs);
      if (unknown.length > 0) {
        logger.warn("rule-engine.unknown_bundles", { unknown });
      }
      bundles = ok;
      rules = rulesForBundles(ok, this.loadedRules.rules);
    }

    const assertions: Assertion[] = [];
    let applicableCount = 0;

    for (const rule of rules) {
      const isApplicable = this.checkApplicability(rule, sourceState);
      if (isApplicable) applicableCount++;

      const evidence = collectEvidence(rule, sourceState);
      enrichEvidence(evidence, rule);
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
        sourceUrl: getSourceUrl(rule, sourceState),
      });

      assertions.push(assertion);
    }

    // Sort by rule_id
    assertions.sort((a, b) => a.rule_id.localeCompare(b.rule_id));

    return {
      assertions,
      rulesetVersion: this.loadedRules.manifestVersion,
      scannedAt: new Date().toISOString(),
      totalRules: rules.length,
      applicableRules: applicableCount,
      bundles,
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
    return targetToSnapshotKey(target, snapshots) !== null;
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
