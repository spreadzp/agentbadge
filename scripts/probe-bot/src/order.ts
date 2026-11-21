/**
 * probe-order.yaml — remote order schema + safety-lint
 * (D-234-38-Q16, Q17).
 *
 * A slice can embed a ready order block; an implementing session
 * copies it into a LOCAL-QUERY .req (ARG = file path or single-line
 * JSON — JSON ⊆ YAML, same validator). Invalid order → LOCAL-ANSWER
 * with schema error.
 *
 * Lint result decides bridge routing: clean order → auto-execute;
 * violation → human-queue.
 */

import YAML from "yaml";
import type { ProbeOrder } from "./types";
import { checkTarget } from "./safety";

const ORDER_KEYS = new Set([
  "target", "endpoints", "scenarios", "layer", "dbVerify",
  "deliverTo", "maxRequests", "rps", "dryRun", "allowMutations",
]);

export interface OrderIssue { field: string; problem: string }

export function validateOrder(raw: unknown): { order?: ProbeOrder; issues: OrderIssue[] } {
  const issues: OrderIssue[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { issues: [{ field: "<root>", problem: "order must be a mapping" }] };
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ORDER_KEYS.has(k)) issues.push({ field: k, problem: "unknown field" });
  }
  if (typeof o.target !== "string" || !o.target) {
    issues.push({ field: "target", problem: "required string" });
  }
  for (const listKey of ["endpoints", "scenarios"] as const) {
    const v = o[listKey];
    if (v !== undefined && (!Array.isArray(v) || v.some(x => typeof x !== "string"))) {
      issues.push({ field: listKey, problem: "must be string[]" });
    }
  }
  if (o.layer !== undefined && o.layer !== "contract" && o.layer !== "security") {
    issues.push({ field: "layer", problem: "contract|security" });
  }
  if (o.deliverTo !== undefined && !["session", "file", "tg"].includes(String(o.deliverTo))) {
    issues.push({ field: "deliverTo", problem: "session|file|tg" });
  }
  for (const numKey of ["maxRequests", "rps"] as const) {
    const v = o[numKey];
    if (v !== undefined && (typeof v !== "number" || v <= 0)) {
      issues.push({ field: numKey, problem: "positive number" });
    }
  }
  for (const boolKey of ["dbVerify", "dryRun", "allowMutations"] as const) {
    if (o[boolKey] !== undefined && typeof o[boolKey] !== "boolean") {
      issues.push({ field: boolKey, problem: "boolean" });
    }
  }
  if (issues.length) return { issues };
  return { order: o as unknown as ProbeOrder, issues };
}

/** Parse order from YAML text OR single-line JSON (bridge ARG). */
export function parseOrder(text: string): { order?: ProbeOrder; issues: OrderIssue[]; error?: string } {
  let raw: unknown;
  try {
    raw = YAML.parse(text); // JSON parses fine through YAML parser
  } catch (e) {
    return { issues: [], error: `parse error: ${(e as Error).message.slice(0, 200)}` };
  }
  return { ...validateOrder(raw) };
}

export interface LintDecision {
  mode: "auto" | "queue";
  reasons: string[];
}

/**
 * Safety-lint for remote orders (Q17): clean → auto-execute,
 * violation → human-queue. mutating scenarios are checked later at
 * runner level — here we gate on declared flags + caps.
 */
export function lintOrder(order: ProbeOrder, opts: {
  allowedHosts?: string[];
  maxRequestsCap: number;
  mutatingRequested: boolean;
}): LintDecision {
  const reasons: string[] = [];
  const t = checkTarget(order.target, opts.allowedHosts ?? []);
  if (!t.ok) reasons.push(`target: ${t.reason}`);
  if ((order.maxRequests ?? 300) > opts.maxRequestsCap) {
    reasons.push(`maxRequests ${order.maxRequests} > cap ${opts.maxRequestsCap}`);
  }
  if ((order.rps ?? 2) > 5) reasons.push(`rps ${order.rps} > 5`);
  if (order.allowMutations || opts.mutatingRequested) {
    reasons.push("mutating scenarios requested");
  }
  if (order.dryRun !== true && order.target.includes("agentbadge.xyz") && (order.maxRequests ?? 300) > opts.maxRequestsCap) {
    reasons.push("prod run exceeds cap");
  }
  return { mode: reasons.length ? "queue" : "auto", reasons };
}
