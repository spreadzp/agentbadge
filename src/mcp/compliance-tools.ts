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
import type { PillarScore } from "../agent-readiness/scoring/scoring-types";

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
}

interface PillarEntry {
  pillar: string;
  label: string;
  question: string;
  weight: number;
  score: number;
  floorTriggered: boolean;
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
      categoryWeights: {
        discovery: 15,
        documentation: 15,
        actionability: 10,
        machine_readable: 10,
        verification: 5,
        content_negotiation: 10,
        payments: 10,
        bazaar: 5,
        openapi: 10,
        skills: 5,
        agents_txt: 5,
        webmcp: 5,
        identity: 5,
        bot_auth: 5,
        infrastructure: 5,
        seo_aeo: 5,
        accessibility: 4,
        active_probing: 5,
      },
    };

    const scoreResult = runScoringEngine({
      assertions: ruleEngineResult.assertions as Assertion[],
      rulesetManifest: manifest,
    });

    const checks: ComplianceCheck[] = (ruleEngineResult.assertions as unknown as Array<Record<string, unknown>>).map(
      (assertion) => ({
        id: (assertion.rule_id as string) ?? (assertion.id as string) ?? "unknown",
        name: (assertion.rule_name as string) ?? (assertion.name as string) ?? (assertion.rule_id as string) ?? "unknown",
        status: assertion.status === "VERIFIED" || assertion.status === "INFERRED"
          ? "pass"
          : assertion.status === "NOT_APPLICABLE"
            ? "skip"
            : "fail",
        hint: (assertion.hint as string | undefined) ?? (assertion.fix_hint as string | undefined) ?? undefined,
        category: (assertion.category as string | undefined) ?? undefined,
      }),
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
    "Scan any URL for isitagentready compliance. Returns a structured JSON report with score (0-100), four-pillar breakdown (Discovery/Understandability/Executability/Verifiability — where the service stands for agent use), individual check results (id, name, status, hint), and summary (totalChecks, passed, failed, skipped). Use this to verify agent-readiness of any website.",
    {
      url: z
        .string()
        .describe("The URL to scan for agent readiness compliance (e.g. https://agentbadge.xyz)"),
    },
    checkComplianceHandler,
  );
}
