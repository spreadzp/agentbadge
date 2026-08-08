/**
 * SLICE-49-14: MCP tool `check_compliance`
 *
 * Registers a `check_compliance` MCP tool that scans any URL
 * for isitagentready compliance and returns structured JSON:
 * { score, checks: [{ id, name, status, hint }], summary }
 */

import { z } from "zod";
import { registerTool, type ToolResult, type ToolHandler } from "@agentgate-hedera/mcp";
import { scanDomain } from "../agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../agent-readiness/ruleset";

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

interface ComplianceResult {
  score: number;
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
      },
    };

    const scoreResult = runScoringEngine({
      assertions: ruleEngineResult.assertions as any,
      rulesetManifest: manifest,
    });

    const checks: ComplianceCheck[] = (ruleEngineResult.assertions as any[]).map(
      (assertion) => ({
        id: assertion.rule_id ?? assertion.id ?? "unknown",
        name: assertion.rule_name ?? assertion.name ?? assertion.rule_id ?? "unknown",
        status: assertion.status === "VERIFIED" || assertion.status === "INFERRED"
          ? "pass"
          : assertion.status === "NOT_APPLICABLE"
            ? "skip"
            : "fail",
        hint: assertion.hint ?? assertion.fix_hint ?? undefined,
        category: assertion.category ?? undefined,
      }),
    );

    const passed = checks.filter((c) => c.status === "pass").length;
    const failed = checks.filter((c) => c.status === "fail").length;
    const skipped = checks.filter((c) => c.status === "skip").length;

    const result: ComplianceResult = {
      score: typeof scoreResult.total === "number"
        ? scoreResult.total
        : (scoreResult.total as any).score ?? (scoreResult.total as any).rawScore ?? 0,
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

export function registerComplianceTools(): void {
  registerTool(
    "check_compliance",
    "Scan any URL for isitagentready compliance. Returns a structured JSON report with score (0-100), individual check results (id, name, status, hint), and summary (totalChecks, passed, failed, skipped). Use this to verify agent-readiness of any website.",
    {
      url: z
        .string()
        .describe("The URL to scan for agent readiness compliance (e.g. https://agentbadge.xyz)"),
    },
    checkComplianceHandler,
  );
}
