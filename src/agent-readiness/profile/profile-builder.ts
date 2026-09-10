import type { ScanReport } from "../report-formatter";
import type { Assertion } from "../rule-engine/assertion-builder";
import type { ScoreResult } from "../scoring/scoring-types";
import type { KnowledgeProfile, EvidenceSummary, Freshness } from "./profile-schema";
import { parseDomain } from "./domain-parser";
import { extractCapabilities } from "./extractors/capability-extractor";
import { extractAuth } from "./extractors/auth-extractor";
import { extractPricing } from "./extractors/payment-extractor";
import { extractLimits } from "./extractors/limits-extractor";
import { extractErrors } from "./extractors/errors-extractor";
import { extractPolicies } from "./extractors/policies-extractor";
import { aggregateFreshness } from "./freshness-aggregator";
import { aggregateConfidence } from "./confidence-aggregator";
import { finalizeSectionMeta } from "./section-meta-finalizer";

/**
 * SLICE-101-2 + 101-6: Profile Builder.
 *
 * Pure function: buildProfile(scanReport, assertions, scoreResult?) → KnowledgeProfile.
 * No I/O, no side effects. Same input always produces same output.
 *
 * Wires extractors (101-3..5), freshness aggregator, confidence aggregator,
 * and section meta finalizer to produce a complete KnowledgeProfile.
 */

export interface BuildProfileInput {
  scanReport: ScanReport;
  assertions: Assertion[];
  scoreResult?: ScoreResult;
  reportId?: string;
}

export function buildProfile(input: BuildProfileInput): KnowledgeProfile {
  const { scanReport, assertions, scoreResult, reportId } = input;

  const domain = parseDomain(scanReport.url);
  const now = new Date().toISOString();

  // Service section
  const discoveryVerified = assertions.find(
    (a) => a.category === "discovery" && a.status === "VERIFIED",
  );
  const latestTimestamp = assertions
    .map((a) => a.timestamp)
    .sort()
    .pop() ?? now;

  const service = {
    domain,
    base_url: scanReport.url,
    name: discoveryVerified?.name ?? domain,
    description: scanReport.summary,
    verified_at: latestTimestamp,
    scan_id: reportId ?? generateId(),
  };

  // Readiness section
  const categories: Record<string, number> = {};
  if (scoreResult) {
    for (const [cat, score] of Object.entries(scoreResult.categories)) {
      categories[cat] = score.score;
    }
  } else {
    for (const cat of scanReport.categories) {
      categories[cat.category] = cat.completeness_pct;
    }
  }

  const conflictCount = assertions.filter((a) => a.status === "CONFLICT").length;

  const readiness = {
    score: scanReport.score,
    grade: scanReport.grade,
    categories,
    verified_rules: scanReport.verified,
    total_rules: scanReport.total_rules,
    gaps: scanReport.missing,
    conflicts: conflictCount,
  };

  // Evidence summary section
  const byStatus: Record<string, number> = {};
  for (const a of assertions) {
    byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  }

  const bySourceClass: Record<string, number> = {};
  for (const a of assertions) {
    for (const e of a.evidence) {
      const sc = (e as { source_class?: string }).source_class;
      if (sc) {
        bySourceClass[sc] = (bySourceClass[sc] ?? 0) + 1;
      }
    }
  }

  const confidenceRange = aggregateConfidence(assertions);

  const evidenceSummary: EvidenceSummary = {
    total_assertions: assertions.length,
    by_status: byStatus,
    by_source_class: bySourceClass,
    confidence_range: confidenceRange,
  };

  // Run extractors (101-3..5)
  const capabilities = extractCapabilities(assertions);
  const auth = extractAuth(assertions);
  const pricing = extractPricing(assertions);
  const limits = extractLimits(assertions);
  const errors = extractErrors(assertions);
  const policies = extractPolicies(assertions);

  // Finalize section meta (set stale flags)
  const nowDate = new Date(now);
  const sectionMap: Record<string, any> = { capabilities, auth, pricing, limits, errors, policies };
  finalizeSectionMeta(sectionMap, nowDate);

  // Freshness section — aggregate across all populated sections
  const sectionFreshnessInputs: { name: string; verified_at: string; source_class?: string }[] = [];
  for (const [name, section] of Object.entries(sectionMap)) {
    if (section) {
      // Extract primary source_class from source field
      const sourceClasses = (section.source as string).split(", ").filter(Boolean);
      sectionFreshnessInputs.push({
        name,
        verified_at: section.verified_at,
        source_class: sourceClasses[0],
      });
    }
  }
  const freshnessResult = aggregateFreshness(sectionFreshnessInputs, nowDate);

  const freshness: Freshness = {
    profile_generated_at: now,
    oldest_evidence_days: freshnessResult.oldest_evidence_days,
    stale_sections: freshnessResult.stale_sections,
  };

  return {
    profile_version: "1.0.0",
    schema_version: "0.9.0",
    service,
    readiness,
    capabilities,
    auth,
    pricing,
    limits,
    errors,
    policies,
    freshness,
    evidence_summary: evidenceSummary,
  };
}

// ─── Helpers ───

function generateId(): string {
  return "profile-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
