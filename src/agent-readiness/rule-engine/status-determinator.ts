import type { AgentReadinessRule } from "../rule.schema";
import type { Status } from "../shared.schema";
import type { Evidence } from "./evidence.types";

export type AssertionStatus = Status;

export type ApplicabilityPredicate = (
  rule: AgentReadinessRule,
  sourceState: { snapshots: Record<string, unknown> },
) => boolean;

export interface DetermineInput {
  rule: AgentReadinessRule;
  evidence: Evidence[] | null;
  isApplicable: boolean;
}

export interface DetermineResult {
  status: AssertionStatus;
  reason: string;
}

class StatusDeterminatorClass {
  /**
   * Determine assertion status from rule, evidence, and applicability.
   * Applicability check runs BEFORE evidence evaluation.
   */
  determine(input: DetermineInput): DetermineResult {
    if (!input.isApplicable) {
      return {
        status: "NOT_APPLICABLE",
        reason: `Rule ${input.rule.rule_id} does not apply to this source`,
      };
    }

    if (input.evidence === null || input.evidence.length === 0) {
      return {
        status: "MISSING",
        reason: `No evidence found for rule ${input.rule.rule_id}`,
      };
    }

    const hasCross = input.evidence.some((e) => e.type === "cross");
    if (hasCross) {
      const crossEv = input.evidence.find((e) => e.type === "cross") as Extract<Evidence, { type: "cross" }>;
      if (crossEv.conflict_reason) {
        return {
          status: "CONFLICT",
          reason: crossEv.conflict_reason,
        };
      }
      // Cross evidence with no conflict = verified consistency
      return {
        status: "VERIFIED",
        reason: `Cross-evidence confirms rule ${input.rule.rule_id}: sources are consistent`,
      };
    }

    const hasDirect = this.hasDirectEvidence(input.rule, input.evidence);
    if (hasDirect) {
      return {
        status: "VERIFIED",
        reason: `Direct evidence confirms rule ${input.rule.rule_id}`,
      };
    }

    const hasIndirect = this.hasIndirectEvidence(input.rule, input.evidence);
    if (hasIndirect) {
      return {
        status: "INFERRED",
        reason: `Indirect evidence supports rule ${input.rule.rule_id}`,
      };
    }

    return {
      status: "MISSING",
      reason: `Evidence found but does not confirm or contradict rule ${input.rule.rule_id}`,
    };
  }

  /**
   * Check if evidence directly confirms the rule's check target.
   */
  private hasDirectEvidence(rule: AgentReadinessRule, evidence: Evidence[]): boolean {
    const target = rule.check.target;

    for (const e of evidence) {
      if (e.type === "http" && target) {
        if (e.url.includes(target) && e.status >= 200 && e.status < 300) {
          return true;
        }
      }
      if (e.type === "robots" && target?.includes("robots")) {
        if (e.status >= 200 && e.status < 300) return true;
      }
      if (e.type === "sitemap" && target?.includes("sitemap")) {
        if (e.status >= 200 && e.status < 300) return true;
      }
      if (e.type === "openapi" && target?.includes("openapi")) {
        return true;
      }
      if (e.type === "openapi" && rule.check.type === "schema_validation") {
        return true;
      }
      if (e.type === "json_schema" && rule.check.type === "schema_validation") {
        if (e.valid) return true;
      }
      if (e.type === "manual_confirmation") {
        return true;
      }

      // New check types: http_probe, content_parse, header_check
      // All verify when HTTP evidence with 2xx status is found
      if (rule.check.type === "http_probe" && e.type === "http") {
        if (e.status >= 200 && e.status < 300) return true;
      }
      if (rule.check.type === "content_parse" && e.type === "http") {
        if (e.status >= 200 && e.status < 300) return true;
      }
      if (rule.check.type === "header_check" && e.type === "http") {
        if (e.status >= 200 && e.status < 400) return true;
      }

      // http_fetch with match_keys: check if any of the specified headers are present
      if (rule.check.type === "http_fetch" && e.type === "http" && rule.check.match_keys && rule.check.match_keys.length > 0) {
        const headers = e.headers ?? {};
        const hasAnyKey = rule.check.match_keys.some((key: string) => {
          const lowerKey = key.toLowerCase();
          return key in headers || lowerKey in headers;
        });
        if (hasAnyKey && e.status >= 200 && e.status < 300) return true;
      }
    }

    return false;
  }

  /**
   * Check if evidence indirectly supports the rule.
   * E.g., OpenAPI implies endpoints exist; robots.txt implies discovery.
   */
  private hasIndirectEvidence(rule: AgentReadinessRule, evidence: Evidence[]): boolean {
    for (const e of evidence) {
      if (e.type === "openapi" && rule.check.type === "http_fetch") {
        return true;
      }
      if (e.type === "html" && rule.check.type === "http_fetch") {
        return true;
      }
      if (e.type === "github" && rule.check.type === "schema_validation") {
        return true;
      }
    }

    return false;
  }
}

export const StatusDeterminator = new StatusDeterminatorClass();
export { StatusDeterminatorClass };
