// EPIC-262 (SLICE-262-31): intel-specific prom-client metrics on the
// shared registry — scan outcomes/duration, pull-job lifecycle,
// evidence volume. Labels stay low-cardinality: status, capability
// probe id, outcome — NEVER site/tenant ids (that's what the
// correlation_id + security-events are for).
import { Counter, Histogram } from "prom-client";
import { registry } from "../../metrics/metrics";

export const intelScansTotal = new Counter({
  name: "agentbadge_intel_scans_total",
  help: "Intel deep-scan jobs by terminal status",
  labelNames: ["status"],
  registers: [registry],
});

export const intelScanDurationMs = new Histogram({
  name: "agentbadge_intel_scan_duration_ms",
  help: "Intel deep-scan wall time, queued→terminal",
  labelNames: [],
  buckets: [500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000, 120_000],
  registers: [registry],
});

export const intelEnvelopesTotal = new Counter({
  name: "agentbadge_intel_envelopes_total",
  help: "Evidence envelopes minted, by provenance class",
  labelNames: ["provenance"],
  registers: [registry],
});

export const intelPullJobsTotal = new Counter({
  name: "agentbadge_intel_pull_jobs_total",
  help: "Pull-job lifecycle outcomes (created/claimed/result_*/expired)",
  labelNames: ["outcome"],
  registers: [registry],
});

export const intelSecurityEventsTotal = new Counter({
  name: "agentbadge_intel_security_events_total",
  help: "Append-only security events by type",
  labelNames: ["type"],
  registers: [registry],
});
