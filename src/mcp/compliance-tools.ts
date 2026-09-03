/**
 * SLICE-49-14: MCP tool `check_compliance`
 *
 * Registers a `check_compliance` MCP tool that scans any URL
 * for isitagentready compliance and returns structured JSON:
 * { score, checks: [{ id, name, status, hint }], summary }
 */

import { z } from "zod";
import { type ToolResult, type ToolHandler, type NamespaceRegistry, getNamespace } from "@agentbadge/mcp";

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}
import { scanDomain } from "../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../agent-readiness/scoring/scoring-engine";
import type { Assertion } from "../agent-readiness/rule-engine/assertion-builder";
import { AGENT_READINESS_RULESET } from "../agent-readiness/ruleset";
import { PILLAR_LABELS, PILLAR_QUESTIONS, PILLARS } from "../agent-readiness/scoring/pillar-map";
import { DEFAULT_CATEGORY_WEIGHTS, type PillarScore } from "../agent-readiness/scoring/scoring-types";
import { strongestSource, classifyEvidence, SOURCE_CLASS_LABELS } from "../agent-readiness/rule-engine/source-hierarchy";
import { evidenceSummary } from "../agent-readiness/rule-engine/evidence.types";
import { withFreshness } from "../agent-readiness/rule-engine/freshness";
import { deriveGaps, summarizeGaps } from "../agent-readiness/gap-engine/gap-engine";
import { prioritizeGaps } from "../agent-readiness/gap-engine/gap-priority";
import { annotateFixReadiness } from "../agent-readiness/gap-engine/gap-fix-hints";
import type { AgentReadinessRule } from "../agent-readiness/rule.schema";
import type { Gap } from "../agent-readiness/gap-engine/gap-types";
import type { GapSummary } from "../agent-readiness/gap-engine/gap-engine";

const complianceArgsSchema = z.object({
  url: z
    .string()
    .describe("The URL to scan for agent readiness compliance (e.g. https://agentbadge.xyz)"),
});

interface ComplianceCheck {
  id: string;
  name: string;
  status: "pass" | "fail" | "skip";
  hint?: string;
  category?: string;
  claim?: string;
  verified_at?: string;
  review_level?: string | null;
  source_class?: string | null;
  source_label?: string | null;
  evidence?: Array<{ type: string; captured_at: string | null; source_class: string | null; summary: string }>;
}

interface PillarEntry {
  pillar: string;
  label: string;
  question: string;
  weight: number;
  score: number;
  floorTriggered: boolean;
}

interface EvidenceSummary {
  verified: number;
  inferred: number;
  gap: number;
  conflict: number;
  not_applicable: number;
  stale_count: number;
}

interface ComplianceResult {
  score: number;
  scoringModel: string;
  pillars: PillarEntry[];
  checks: ComplianceCheck[];
  summary: {
    totalChecks: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  evidence_summary?: EvidenceSummary;
  gaps?: Gap[];
  gap_summary?: GapSummary;
}

function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Validation error: ${message}` }],
  };
}

function serviceError(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : "Unknown error";
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

export const checkComplianceHandler: ToolHandler = async (args) => {
  const parsed = complianceArgsSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(parsed.error.message);
  }

  const { url } = parsed.data;

  try {
    new URL(url);
  } catch {
    return validationError(`Invalid URL: ${url}`);
  }

  try {
    const sourceState = await scanDomain(url, { noCache: true });

    const ruleEngineResult = RuleEngine.run(sourceState);

    const manifest = {
      name: AGENT_READINESS_RULESET.name,
      version: AGENT_READINESS_RULESET.version,
      scoring: AGENT_READINESS_RULESET.scoring,
      categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
    };

    const scoreResult = runScoringEngine({
      assertions: ruleEngineResult.assertions as Assertion[],
      rulesetManifest: manifest,
    });

    const checks: ComplianceCheck[] = (ruleEngineResult.assertions as unknown as Array<Record<string, unknown>>).map(
      (assertion) => {
        const a = assertion as unknown as Assertion;
        const strongest = a.evidence.length > 0 ? strongestSource(a.evidence) : null;
        const sourceClass = strongest?.sourceClass ?? null;
        const sourceLabel = sourceClass ? (SOURCE_CLASS_LABELS[sourceClass] ?? null) : null;
        return {
          id: (assertion.rule_id as string) ?? (assertion.id as string) ?? "unknown",
          name: (assertion.rule_name as string) ?? (assertion.name as string) ?? (assertion.rule_id as string) ?? "unknown",
          status: assertion.status === "VERIFIED" || assertion.status === "INFERRED"
            ? "pass"
            : assertion.status === "NOT_APPLICABLE"
              ? "skip"
              : "fail",
          hint: (assertion.hint as string | undefined) ?? (assertion.fix_hint as string | undefined) ?? undefined,
          category: (assertion.category as string | undefined) ?? undefined,
          claim: a.claim ?? a.name ?? a.rule_id,
          verified_at: a.verified_at ?? a.timestamp ?? null,
          review_level: a.review_level ?? null,
          source_class: sourceClass,
          source_label: sourceLabel,
          evidence: a.evidence.map((e) => ({
            type: e.type,
            captured_at: e.captured_at ?? null,
            source_class: e.source_class ?? classifyEvidence(e),
            summary: evidenceSummary(e),
          })),
        };
      },
    );

    const passed = checks.filter((c) => c.status === "pass").length;
    const failed = checks.filter((c) => c.status === "fail").length;
    const skipped = checks.filter((c) => c.status === "skip").length;

    const pillars: PillarEntry[] = [];
    for (const key of PILLARS) {
      const ps = scoreResult.pillars?.[key] as PillarScore | undefined;
      if (!ps) continue;
      pillars.push({
        pillar: ps.pillar,
        label: PILLAR_LABELS[key],
        question: PILLAR_QUESTIONS[key],
        weight: ps.weight,
        score: ps.score,
        floorTriggered: ps.floorTriggered,
      });
    }

    // SLICE-94-9: evidence_summary block
    const allAssertions = ruleEngineResult.assertions as Assertion[];
    const evidenceSummaryBlock: EvidenceSummary = {
      verified: allAssertions.filter((a) => a.status === "VERIFIED").length,
      inferred: allAssertions.filter((a) => a.status === "INFERRED").length,
      gap: allAssertions.filter((a) => a.status === "GAP").length,
      conflict: allAssertions.filter((a) => a.status === "CONFLICT").length,
      not_applicable: allAssertions.filter((a) => a.status === "NOT_APPLICABLE").length,
      stale_count: allAssertions.filter((a) => withFreshness(a).stale).length,
    };

    // EPIC-96: gap roadmap
    const rawGaps = deriveGaps(allAssertions, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
    const ruleSeverities = AGENT_READINESS_RULESET.rules.map((r) => ({ rule_id: r.rule_id, severity: r.severity as "critical" | "high" | "medium" | "low" }));
    const prioritizedGaps = prioritizeGaps(rawGaps, DEFAULT_CATEGORY_WEIGHTS, ruleSeverities);
    const annotatedGaps = annotateFixReadiness(prioritizedGaps, AGENT_READINESS_RULESET.rules as unknown as AgentReadinessRule[]);
    const gapSummary = summarizeGaps(annotatedGaps);

    const result: ComplianceResult = {
      score: typeof scoreResult.total === "number"
        ? scoreResult.total
        : scoreResult.total.score ?? scoreResult.total.rawScore ?? 0,
      scoringModel: "v2-pillars",
      pillars,
      checks,
      summary: {
        totalChecks: checks.length,
        passed,
        failed,
        skipped,
      },
      evidence_summary: evidenceSummaryBlock,
      gaps: annotatedGaps,
      gap_summary: gapSummary,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return serviceError(err);
  }
};

export function registerComplianceTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "check_compliance",
    "Scan any URL for isitagentready compliance. Returns a structured JSON report with score (0-100), four-pillar breakdown (Discovery/Understandability/Executability/Verifiability — where the service stands for agent use), individual check results (id, name, status, hint, claim, verified_at, review_level, source_class, source_label, evidence entries with captured_at/summary), evidence_summary (verified, inferred, gap, conflict, not_applicable, stale_count), summary (totalChecks, passed, failed, skipped), and gaps (prioritized gap roadmap with fix hints — what the agent is missing and how to fix it). GAP status indicates information gaps where no evidence was found. Use this to verify agent-readiness of any website.",
    {
      url: z
        .string()
        .describe("The URL to scan for agent readiness compliance (e.g. https://agentbadge.xyz)"),
    },
    checkComplianceHandler,
  );
}
