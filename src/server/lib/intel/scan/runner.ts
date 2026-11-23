// EPIC-262 (SLICE-262-6): scan-job runner — probes → submissions →
// trust boundary (external_scan → EXTERNAL_OBSERVED) → persisted
// envelopes → completeness → canonical signed report. A transport
// failure produces NO evidence (honest) and counts toward partial;
// every probe failing ⇒ failed, no report (EXPLAINED §3).
import type { SigningKey } from "../../../../agent-readiness/integrity/key-manager";
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import { acceptSubmission } from "../evidence/boundary";
import { computeDedupeHash } from "../evidence/store";
import type { IntelEvidenceStore } from "../evidence/store";
import { INTEL_API_VERSION } from "../keys";
import { assembleIntelReport } from "../report";
import type { IntelRuleset } from "../rules";
import type { ScanFetch } from "./fetcher";
import { SCAN_PLAN, probeToSubmission } from "./plan";
import type { IntelScanJobStore } from "./store";
import type { ScanJob } from "./types";

const DAY_MS = 86_400_000;

export interface ScanRunDeps {
  fetch: ScanFetch;
  evidence: IntelEvidenceStore;
  jobs: IntelScanJobStore;
  key: SigningKey;
  ruleset: IntelRuleset;
  evidenceRetentionDays?: number;
  /** injectable clock — tests are deterministic */
  now?: () => Date;
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
  const envelopes = [];
  let probeFailures = 0;

  for (const probe of SCAN_PLAN) {
    const url = new URL(probe.path, job.baseUrl).href;
    let obs;
    try {
      obs = await deps.fetch(url, probe.ua);
    } catch {
      probeFailures += 1; // transport failure ⇒ no evidence, honestly
      continue;
    }
    const sub = probeToSubmission({
      siteId: job.siteId,
      scanId: job.scanId,
      collectorId,
      collectedAt: iso(),
      probe,
      url,
      obs,
      nowIso: iso(),
    });
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
    return deps.jobs.update(job);
  }

  const completeness = probeFailures > 0 ? "partial" : "complete";
  // MoM chain (262-12): link to the site's previous report hash so
  // tampering with history breaks the chain — genesis = null
  const priors = (await deps.jobs.forSite(job.siteId))
    .filter((j) => j.id !== job.id && j.report !== null && j.createdAt < job.createdAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const report = assembleIntelReport(envelopes, {
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
  return deps.jobs.update(job);
}
