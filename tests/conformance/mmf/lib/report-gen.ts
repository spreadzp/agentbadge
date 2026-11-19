/**
 * SLICE-255-6: consolidated report generator — reads the four
 * results artifacts (spend/lifecycle/crypto/own-invariants) and
 * produces report.json + report.md. Pure functions; deterministic
 * (no timestamps — re-runs are byte-identical).
 *
 * Metrics stay SEPARATE per D-255-Q25: spend-decision (36 core),
 * delegation (18 D*), lifecycle (29), crypto-evidence (9) — never
 * a single "92/92" number. own-invariants is a fifth, non-MMF count.
 */
import type { VectorResult } from "./result";
import { RESULT_SCHEMA_VERSION, CORPUS_VERSION } from "./result";

/** Delegation vectors live inside spend.json but carry
 *  track:"delegation"; the metric splits on the track field with a
 *  D-prefix/spendAsDelegate fallback for older artifacts. */
export function metricOf(v: VectorResult): string {
  if (v.track === "lifecycle") return "lifecycle";
  if (v.track === "crypto") return "crypto-evidence";
  if (
    v.track === "delegation" ||
    v.vector_id.startsWith("D") ||
    v.production_path.includes("spendAsDelegate")
  ) {
    return "delegation";
  }
  return "spend-decision";
}

const STATUSES = [
  "PASS",
  "DIVERGENCE-BUG",
  "DIVERGENCE-MODEL",
  "NOT_MAPPABLE",
  "GATE_EXCEPTION",
  "HARNESS_ERROR",
] as const;
const EQUIVS = ["Exact", "Partial", "None"] as const;

export interface MetricSummary {
  n: number;
  by_status: Record<string, number>;
  by_equivalence: Record<string, number>;
}

export function summarizeMetric(vectors: VectorResult[]): MetricSummary {
  const by_status: Record<string, number> = {};
  const by_equivalence: Record<string, number> = {};
  for (const s of STATUSES) by_status[s] = 0;
  for (const e of EQUIVS) by_equivalence[e] = 0;
  for (const v of vectors) {
    by_status[v.result] = (by_status[v.result] ?? 0) + 1;
    by_equivalence[v.equivalence] = (by_equivalence[v.equivalence] ?? 0) + 1;
  }
  for (const k of Object.keys(by_status)) {
    if (by_status[k] === 0) delete by_status[k];
  }
  for (const k of Object.keys(by_equivalence)) {
    if (by_equivalence[k] === 0) delete by_equivalence[k];
  }
  return { n: vectors.length, by_status, by_equivalence };
}

export interface ConsolidatedReport {
  schema_version: typeof RESULT_SCHEMA_VERSION;
  corpus_version: typeof CORPUS_VERSION;
  corpus_sha256: Record<string, string>;
  summary: Record<string, MetricSummary>;
  vectors: Array<VectorResult & { metric: string }>;
  findings: {
    bugs: Array<{ vector_id: string; note: string }>;
    gate_exceptions: string[];
    not_mappable_count: number;
  };
}

export function buildReport(
  all: VectorResult[],
  corpusSha256: Record<string, string>,
): ConsolidatedReport {
  const metrics = new Map<string, VectorResult[]>();
  const tagged = all.map((v) => {
    const metric = metricOf(v);
    if (!metrics.has(metric)) metrics.set(metric, []);
    metrics.get(metric)!.push(v);
    return { ...v, metric };
  });
  const summary: Record<string, MetricSummary> = {};
  for (const [name, vecs] of metrics) {
    summary[name] = summarizeMetric(vecs);
  }
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    corpus_version: CORPUS_VERSION,
    corpus_sha256: corpusSha256,
    summary,
    vectors: tagged,
    findings: {
      bugs: tagged
        .filter((v) => v.result === "DIVERGENCE-BUG")
        .map((v) => ({
          vector_id: v.vector_id,
          note: v.notes ?? JSON.stringify(v.actual).slice(0, 200),
        })),
      gate_exceptions: tagged
        .filter((v) => v.result === "GATE_EXCEPTION")
        .map((v) => v.vector_id),
      not_mappable_count: tagged.filter(
        (v) => v.result === "NOT_MAPPABLE",
      ).length,
    },
  };
}

/* ------------------------------ markdown ------------------------------- */

const fmt = (r: Record<string, number>, keys: readonly string[]) =>
  keys
    .filter((s) => r[s])
    .map((s) => `${s} ${r[s]}`)
    .join(" · ");

export function renderMarkdown(
  report: ConsolidatedReport,
  ownInvariants: {
    race: { db_barrier: { overshootUsd: number; allowed: number; n: number }; memory_stress: { overshootUsd: number; allowed: number; n: number } };
    findings: Array<{ id: string; title: string; severity: string }>;
  },
): string {
  const s = report.summary;
  const metricRow = (name: string) => {
    const m = s[name];
    return m
      ? `| ${name} | ${m.n} | ${fmt(m.by_status, STATUSES)} | ${fmt(m.by_equivalence, EQUIVS)} |`
      : `| ${name} | 0 | — | — |`;
  };
  const bugLines = report.findings.bugs
    .map((b) => `- **${b.vector_id}** — ${b.note}`)
    .join("\n");
  const ownLines = ownInvariants.findings
    .map((f) => `- **${f.id}** (${f.severity}) — ${f.title}`)
    .join("\n");
  return `# MMF Conformance — consolidated report

Corpus: Mandata MMF **${report.corpus_version}** (pin: tag, sha256 in
report.json). Generated from results/{spend,lifecycle,crypto,
own-invariants}.json — deterministic, re-runnable.

Principle: *we test the implementation we actually have, not the
implementation we wish we had.* Production was not changed to conform.

## Metrics (separate per decision)

| Metric | n | Status | Equivalence |
|---|---|---|---|
${metricRow("spend-decision")}
${metricRow("delegation")}
${metricRow("lifecycle")}
${metricRow("crypto-evidence")}
| own-invariants | — | probes, not vectors | — |

Crypto PASS = test-lib canonicalizer byte-exact vs §5.6/§7 — prod has
no Ed25519 credential model nor evidence hash chain (prod-side dims None; canonical_form Partial).

## Divergences — BUG class (candidates for EPIC-234)

${bugLines}

## Divergences — MODEL class (intentional deltas, discussion for note)

- No stored decisions / tx_id dedup — replay re-reserves (REPLAY and
  TX_CONFLICT unemittable). Majority of lifecycle MODEL count.
- No claim/dispatch-slot — settle direct from reserved; CLAIM:*
  check-ids unreachable; \`cancellation\` gate absent.
- Delegate clamp-vs-reject: spendAsDelegate clamps to owner cap
  where MMF expects \`invalid\`.
- Velocity window: MMF 86 400 s vs ours 3 600 s (Partial).
- Revocation ≈ wallet suspend (Partial); mandate-level revoke absent.
- Expiry / currency / allowed_payees / payee checks — not modeled
  (NOT_MAPPABLE ${report.findings.not_mappable_count} vectors total).

## GATE_EXCEPTION

${report.findings.gate_exceptions.map((id) => `- ${id}`).join("\n")}
— registry failure path throws → fail-closed 500, no deny evidence.

## Own-invariant findings (probes, not MMF)

${ownLines}

- race: db-barrier ${ownInvariants.race.db_barrier.allowed}/${ownInvariants.race.db_barrier.n} reserved (+$${ownInvariants.race.db_barrier.overshootUsd} overshoot);
  memory ${ownInvariants.race.memory_stress.allowed}/${ownInvariants.race.memory_stress.n} (+$${ownInvariants.race.memory_stress.overshootUsd}).

*All findings triaged in docs/EPICS/255-mmf-conformance/
EPIC-234-CANDIDATES.md. Machine-readable: report.json.*
`;
}
