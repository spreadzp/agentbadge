/**
 * EPIC-263-3: draft v0.5-clamp run report — deterministic markdown,
 * same metric-separation discipline as report-gen.ts (K-track and
 * KD-track counted separately, never a single "21/21").
 */
import type { VectorResult } from "./result";
import { DRAFT_CORPUS_VERSION } from "./result";
import {
  summarizeMetric,
  type MetricSummary,
} from "./report-gen";

const STATUSES = [
  "PASS",
  "DIVERGENCE-BUG",
  "DIVERGENCE-MODEL",
  "NOT_MAPPABLE",
  "GATE_EXCEPTION",
  "HARNESS_ERROR",
] as const;
const EQUIVS = ["Exact", "Partial", "None"] as const;

const fmt = (r: Record<string, number>, keys: readonly string[]) =>
  keys
    .filter((s) => r[s])
    .map((s) => `${s} ${r[s]}`)
    .join(" · ");

export function renderClampReport(
  core: VectorResult[],
  delegation: VectorResult[],
  manifest: { commit_sha: string; fetched_at: string; files: Record<string, string> },
): string {
  const s: Record<string, MetricSummary> = {
    "clamp-core (K)": summarizeMetric(core),
    "clamp-delegation (KD)": summarizeMetric(delegation),
  };
  const row = (name: string) =>
    `| ${name} | ${s[name].n} | ${fmt(s[name].by_status, STATUSES)} | ${fmt(s[name].by_equivalence, EQUIVS)} |`;
  const nm = [...core, ...delegation].filter(
    (v) => v.result === "NOT_MAPPABLE",
  );
  const nmLines = nm
    .map(
      (v) =>
        `- **${v.vector_id}** — ${v.notes ?? "mechanism absent"}`,
    )
    .join("\n");
  return `# MMF v0.5-clamp DRAFT — conformance run (EPIC-263)

Corpus: Mandata MMF **${DRAFT_CORPUS_VERSION}** — pin commit
\`${manifest.commit_sha}\` (branch draft/v0.5-clamp, FROZEN), fetched
${manifest.fetched_at}. sha256 per file in MANIFEST.json + results
corpus_sha256 fields.

Third implementation overall, first written against the spec rather
than alongside it. Same discipline as the v0.4.24 run: *we test the
implementation we actually have* — nothing was emulated to conform.

## Metrics (separate per decision)

| Metric | n | Status | Equivalence |
|---|---|---|---|
${row("clamp-core (K)")}
${row("clamp-delegation (KD)")}

## NOT_MAPPABLE (mechanism absent — honest non-coverage)

${nmLines}

## Notes

- Shape 2: allowed+clamped decisions carry check=CAP_EXCEEDED (the
  bound that adjusted the amount); WITHIN stays for unadjusted allows.
- K11 velocity counts the clamped authorization as one issued auth —
  passes via maxTxPerHour (Partial window equivalence).
- Golden evidence-hash vectors for §6 produced by our canonicalizer:
  draft-v05-clamp/golden-evidence-clamped.json (E-series format, KE01–03).
- Old corpus results untouched: this run writes results/clamp.json
  only (separate file, separate corpus_version).

*Machine-readable: results/clamp.json.*
`;
}
