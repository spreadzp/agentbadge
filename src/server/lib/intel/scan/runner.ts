// EPIC-262 (SLICE-262-6): scan-job runner — probes → submissions →
// trust boundary (external_scan → EXTERNAL_OBSERVED) → persisted
// envelopes → completeness → canonical signed report. A transport
// failure produces NO evidence (honest) and counts toward partial;
// every probe failing ⇒ failed, no report (EXPLAINED §3).
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import type { CanonicalEnvelope } from "../evidence/envelope";
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import { acceptSubmission } from "../evidence/boundary";
import { computeDedupeHash } from "../evidence/store";
import type { IntelEvidenceStore } from "../evidence/store";
import { INTEL_API_VERSION } from "../keys";
import { assembleIntelReport } from "../report";
import {
  intelEnvelopesTotal,
  intelScanDurationMs,
  intelScansTotal,
} from "../metrics";
import type { IntelRuleset } from "../rules";
import type { ScanFetch, ScanObservation } from "./fetcher";
import { SCAN_PLAN, probeToSubmissions } from "./plan";
import {
  collectAdvertisedUrls,
  fannedToSubmissions,
} from "./declarations";
import type { IntelScanJobStore } from "./store";
import type { ScanJob } from "./types";

const DAY_MS = 86_400_000;
// D-262-Q33: self-observed facts older than this are stale, not
// missing — but they must not feed a fresh report
const SELF_REPORT_FRESHNESS_MS = 48 * 3_600_000;

export interface ScanRunDeps {
  fetch: ScanFetch;
  evidence: IntelEvidenceStore;
  jobs: IntelScanJobStore;
  key: SigningKey;
  ruleset: IntelRuleset;
  evidenceRetentionDays?: number;
  /** injectable clock — tests are deterministic */
  now?: () => Date;
  /**
   * SLICE-262-16: bounded wait for pull-job results tied to this
   * scan (D-262-Q37). Called right before the self-report merge so
   * plugin results that arrived inside the window feed THIS report;
   * late results stay envelopes for the next compatible scan — the
   * signed report never mutates retroactively.
   */
  awaitPullJobs?: (job: ScanJob) => Promise<void>;
}

export async function runScanJob(
  job: ScanJob,
  deps: ScanRunDeps,
): Promise<ScanJob> {
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();

  job = { ...job, status: "running", updatedAt: iso() };
  await deps.jobs.update(job);

  const collectorId = `external_scan@${job.siteId}`;
  const envelopes: CanonicalEnvelope[] = [];
  let probeFailures = 0;

  const mint = async (sub: ReturnType<typeof probeToSubmissions>[number]) => {
    const envelope = acceptSubmission(
      sub,
      {
        collector: {
          type: "external_scan",
          id: collectorId,
          version: INTEL_API_VERSION,
        },
        site_id: job.siteId,
      },
      deps.key,
      now(),
    );
    envelopes.push(envelope);
    const receivedAt = envelope.received_at;
    const days = deps.evidenceRetentionDays ?? 0;
    await deps.evidence.insert({
      id: envelope.envelope_id,
      schemaVersion: envelope.schema_version,
      siteId: job.siteId,
      scanId: job.scanId,
      collectorId,
      provenance: envelope.provenance,
      dedupeHash: computeDedupeHash(sub, job.siteId),
      receivedAt,
      expiresAt:
        days > 0
          ? new Date(new Date(receivedAt).getTime() + days * DAY_MS).toISOString()
          : null,
      envelope,
    });
  };

  for (const probe of SCAN_PLAN) {
    const url = new URL(probe.path, job.baseUrl).href;
    let obs;
    try {
      obs = await deps.fetch(url, probe.ua);
    } catch {
      probeFailures += 1; // transport failure ⇒ no evidence, honestly
      continue;
    }
    for (const sub of probeToSubmissions({
      siteId: job.siteId,
      scanId: job.scanId,
      collectorId,
      collectedAt: iso(),
      probe,
      url,
      obs,
      nowIso: iso(),
    })) {
      await mint(sub);
    }
  }

  // SLICE-262-4 corpus: bounded advertised-URL fan-out — the
  // declarations a site publishes are probed same-origin ≤8 (dead
  // advertised URLs + real 402 prices are findings, not guesses).
  for (const url of collectAdvertisedUrls(envelopes, job.baseUrl)) {
    let obs: ScanObservation | null = null;
    try {
      obs = await deps.fetch(url);
    } catch {
      obs = null; // transport failure ⇒ reachable:false marker, not silence
    }
    for (const sub of fannedToSubmissions({
      siteId: job.siteId,
      scanId: job.scanId,
      collectorId,
      collectedAt: iso(),
      url,
      obs,
    })) {
      await mint(sub);
    }
  }

  job = { ...job, probeFailures, probeTotal: SCAN_PLAN.length };

  if (envelopes.length === 0) {
    job = {
      ...job,
      status: "failed",
      error: "all probes failed — no evidence collected",
      finishedAt: iso(),
      updatedAt: iso(),
    };
    intelScansTotal.labels("failed").inc();
    return deps.jobs.update(job);
  }

  const completeness = probeFailures > 0 ? "partial" : "complete";
  // MoM chain (262-12): link to the site's previous report hash so
  // tampering with history breaks the chain — genesis = null
  const priors = (await deps.jobs.forSite(job.siteId))
    .filter((j) => j.id !== job.id && j.report !== null && j.createdAt < job.createdAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  // SLICE-262-14: plugin self-report envelopes submitted between
  // scans still feed the ruleset — bounded by the freshness
  // window (48h, D-262-Q33) and deduped to the latest accepted
  // value per fact, so a stale superseded value can't poison a
  // rule that already saw the newer one
  // SLICE-262-16: bounded wait (~90s in the route) for pull-job
  // results bound to this scanId — collected-in-window facts feed
  // THIS report; anything later rides the next scan (G3)
  await deps.awaitPullJobs?.(job);
  const selfReported = await freshSelfReportedEvidence(deps, job);
  const report = assembleIntelReport([...envelopes, ...selfReported], {
    site_id: job.siteId,
    scan_id: job.scanId,
    completeness,
    generated_at: iso(),
    report_id: generateReportId(),
    previous_hash: priors[0]?.report?.integrity.content_hash ?? null,
    ruleset: deps.ruleset,
    key: deps.key,
  });

  job = {
    ...job,
    status: completeness,
    reportId: report.report_id,
    report,
    finishedAt: iso(),
    updatedAt: iso(),
  };
  // SLICE-262-31 — terminal metrics: status, wall time, evidence
  // volume by provenance class (labels stay low-cardinality).
  intelScansTotal.labels(completeness).inc();
  intelScanDurationMs.observe(
    Math.max(0, Date.parse(iso()) - Date.parse(job.createdAt)),
  );
  for (const e of envelopes) {
    intelEnvelopesTotal.labels(e.provenance).inc();
  }
  return deps.jobs.update(job);
}

/** Subject identity used to dedupe repeated self-reports of one fact. */
function selfReportKey(e: {
  payload: { type: string } & Record<string, unknown>;
  subject: Record<string, unknown>;
}): string {
  const p = e.payload;
  const s = e.subject;
  if (p.type === "wp_option_read") return `opt:${String(s.name ?? p.name)}`;
  if (p.type === "file_presence") return `file:${String(s.path ?? p.path)}`;
  if (p.type === "http_observation") return `obs:${String(s.url ?? p.url)}`;
  if (p.type === "document_fact") return `doc:${String(s.url ?? p.doc_type)}`;
  return `${p.type}:${JSON.stringify(s)}`;
}

/**
 * PLUGIN_SELF_REPORTED envelopes accepted in the last 48h for this
 * site, deduped to the newest received_at per fact. Self-report can
 * only ever add PLUGIN_SELF_REPORTED evidence — never upgrade it.
 */
async function freshSelfReportedEvidence(
  deps: ScanRunDeps,
  job: ScanJob,
) {
  const cutoff = (deps.now?.() ?? new Date()).getTime() - SELF_REPORT_FRESHNESS_MS;
  const latest = new Map<string, (typeof all)[number]>();
  const all = (await deps.evidence.forSite(job.siteId)).filter(
    (e) =>
      e.provenance === "PLUGIN_SELF_REPORTED" &&
      // pull-job results carry THIS scanId and belong to this report;
      // periodic self-reports carry their own `self-*`/prior scan ids
      // and ride the same 48h freshness window either way
      Date.parse(e.receivedAt) > cutoff,
  );
  for (const rec of all) {
    const k = selfReportKey(rec.envelope);
    const prev = latest.get(k);
    if (!prev || Date.parse(rec.receivedAt) > Date.parse(prev.receivedAt)) {
      latest.set(k, rec);
    }
  }
  return [...latest.values()].map((r) => r.envelope);
}
