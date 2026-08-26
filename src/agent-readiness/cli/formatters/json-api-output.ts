/**
 * SLICE-69-11: Competitor-compatible JSON API output formatter
 */

import type { Assertion } from "../../rule-engine/assertion-builder";
import type { CategoryScore } from "../../scoring/scoring-types";

export interface JsonApiInput {
  url: string;
  score: number;
  grade: string;
  assertions: Assertion[];
  categoryScores: CategoryScore[];
  compact?: boolean;
  reportUrl?: string;
  funnel?: import("../../scoring/funnel-computer").FunnelResult;
  authProbe?: unknown;
  endpointProbe?: unknown;
  operationalDiscovery?: unknown;
}

const CATEGORY_LABELS: Record<string, string> = {
  discovery: "Discovery",
  documentation: "Documentation",
  actionability: "Actionability",
  machine_readable: "Machine Readable",
  verification: "Verification",
  content_negotiation: "Content Negotiation",
  payments: "Payments",
  bazaar: "Bazaar",
  openapi: "OpenAPI",
  skills: "Skills",
  agents_txt: "Agents.txt",
  webmcp: "Web MCP",
  identity: "Identity",
  bot_auth: "Bot Auth",
  infrastructure: "Infrastructure",
  seo_aeo: "SEO / AEO",
  accessibility: "Accessibility",
  active_probing: "Active Probing",
};

function isPassed(status: string): boolean {
  return status === "VERIFIED" || status === "INFERRED";
}

function isApplicable(status: string): boolean {
  return status !== "NOT_APPLICABLE";
}

export function formatJsonApiOutput(input: JsonApiInput): string {
  const applicable = input.assertions.filter((a) => isApplicable(a.status));
  const passed = applicable.filter((a) => isPassed(a.status)).length;
  const failed = applicable.length - passed;

  const byCategory = new Map<string, Assertion[]>();
  for (const a of input.assertions) {
    if (!isApplicable(a.status)) continue;
    const list = byCategory.get(a.category) ?? [];
    list.push(a);
    byCategory.set(a.category, list);
  }

  const categories = Array.from(byCategory.entries()).map(([key, checks]) => {
    const catPassed = checks.filter((a) => isPassed(a.status)).length;
    const total = checks.length;
    const pct = total > 0 ? Math.round((catPassed / total) * 100) : 0;

    const mappedChecks = checks.map((a) => {
      const check: Record<string, unknown> = {
        rule_id: a.rule_id,
        label: a.name ?? a.rule_id,
        passed: isPassed(a.status),
        optional: !isApplicable(a.status) || a.confidence < 1.0,
      };
      if (!check.passed && a.fix?.note) {
        check.hint = a.fix.note;
      }
      return check;
    });

    return {
      key,
      label: CATEGORY_LABELS[key] ?? key,
      passed: catPassed,
      total,
      pct,
      checks: mappedChecks,
    };
  });

  const output: Record<string, unknown> = {
    url: input.url,
    score: input.score,
    grade: input.grade,
    checks: {
      passed,
      failed,
      total: applicable.length,
    },
    categories,
  };

  if (input.reportUrl) {
    output.reportUrl = input.reportUrl;
  }

  if (input.funnel) {
    output.funnel = input.funnel;
  }

  if (input.authProbe !== undefined) {
    output.auth_probe = input.authProbe;
  }

  if (input.endpointProbe !== undefined) {
    output.endpoint_probe = input.endpointProbe;
  }

  if (input.operationalDiscovery !== undefined) {
    output.operational_discovery = input.operationalDiscovery;
  }

  const space = input.compact ? 0 : 2;
  return JSON.stringify(output, null, space);
}
