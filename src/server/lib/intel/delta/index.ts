// EPIC-262 (SLICE-262-12): month-over-month delta — the shared
// rule-status diff + report-level MoM delta (D-UX-Q4: new/closed/
// unchanged findings + score delta, only under a compatible ruleset).

import type { IntelReport } from "../report/schema";

export type FindingStatus = "pass" | "fail" | "warn" | "unknown";

export interface StatusTransition {
  rule_id: string;
  from: FindingStatus;
  to: FindingStatus;
}

export interface RuleStatusDiff {
  /** became open (fail|warn) — absent, pass or unknown before */
  newOpen: string[];
  /** was open, now pass/unknown/absent — resolved */
  closed: string[];
  /** open in both periods */
  stillOpen: string[];
  /** same rule, different status (includes open→open warn↔fail) */
  transitions: StatusTransition[];
}

const OPEN: ReadonlySet<string> = new Set(["fail", "warn"]);
const isOpen = (s: string | undefined) => s !== undefined && OPEN.has(s);

/** Diff two rule→status maps. The honest core shared by scan-level
 *  and client-report deltas — statuses are facts, the diff derives. */
export function diffRuleStatuses(
  prev: Record<string, FindingStatus>,
  cur: Record<string, FindingStatus>,
): RuleStatusDiff {
  const newOpen: string[] = [];
  const closed: string[] = [];
  const stillOpen: string[] = [];
  const transitions: StatusTransition[] = [];
  for (const [rule, curStatus] of Object.entries(cur)) {
    const prevStatus = prev[rule];
    if (isOpen(curStatus)) {
      if (isOpen(prevStatus)) stillOpen.push(rule);
      else newOpen.push(rule);
    } else if (isOpen(prevStatus)) {
      closed.push(rule);
    }
    if (prevStatus !== undefined && prevStatus !== curStatus)
      transitions.push({ rule_id: rule, from: prevStatus, to: curStatus });
  }
  // rules that vanished from the current report count as closed when
  // they were open — absence under a compatible ruleset = resolved
  for (const [rule, prevStatus] of Object.entries(prev)) {
    if (!(rule in cur) && isOpen(prevStatus)) closed.push(rule);
  }
  const sort = (a: string[]) => a.sort();
  return {
    newOpen: sort(newOpen),
    closed: sort(closed),
    stillOpen: sort(stillOpen),
    transitions: transitions.sort((a, b) => a.rule_id.localeCompare(b.rule_id)),
  };
}

/** rule→status map straight from a signed report */
export function ruleStatusMap(
  report: Pick<IntelReport, "findings">,
): Record<string, FindingStatus> {
  const out: Record<string, FindingStatus> = {};
  for (const f of report.findings) out[f.rule_id] = f.status;
  return out;
}

export const rulesetsCompatible = (
  a: { name: string; version: string },
  b: { name: string; version: string },
): boolean => a.name === b.name && a.version === b.version;

export interface MoMDelta {
  readinessDelta: number | null; // null when either score null
  exposureDelta: number | null;
  newOpen: string[];
  closed: string[];
  stillOpen: string[];
  transitions: StatusTransition[];
}

/** Report-level delta — null when rulesets differ (scores/findings
 *  not comparable) or either side missing. D-UX-Q4 gate. */
export function computeMoMDelta(
  prev: IntelReport | null,
  cur: IntelReport,
): MoMDelta | null {
  if (!prev) return null;
  if (!rulesetsCompatible(prev.ruleset, cur.ruleset)) return null;
  const diff = diffRuleStatuses(ruleStatusMap(prev), ruleStatusMap(cur));
  return {
    readinessDelta:
      prev.scores.readiness.score !== null && cur.scores.readiness.score !== null
        ? cur.scores.readiness.score - prev.scores.readiness.score
        : null,
    exposureDelta:
      prev.scores.exposure.score !== null && cur.scores.exposure.score !== null
        ? cur.scores.exposure.score - prev.scores.exposure.score
        : null,
    newOpen: diff.newOpen,
    closed: diff.closed,
    stillOpen: diff.stillOpen,
    transitions: diff.transitions,
  };
}
