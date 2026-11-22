import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

export const registry = new Registry();

registry.setDefaultLabels({
  service: "agentbadge",
});

// Process/runtime metrics: heap, event loop lag, GC, CPU, fds, uptime.
collectDefaultMetrics({ register: registry });

export const httpRequestTotal = new Counter({
  name: "agentbadge_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "path", "status"],
  registers: [registry],
});

export const httpDurationMs = new Histogram({
  name: "agentbadge_http_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["path"],
  buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [registry],
});

export const scansTotal = new Counter({
  name: "agentbadge_scans_total",
  help: "Total scans performed",
  labelNames: ["result"],
  registers: [registry],
});

export const scanDurationMs = new Histogram({
  name: "agentbadge_scan_duration_ms",
  help: "Scan duration in milliseconds",
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
  registers: [registry],
});

/**
 * SLICE-201-13: Knowledge Object consumption signals.
 * agent_json_request{slug, ua_class} — requests to /blog/:slug.json.
 * ua_class: crawl (AI crawler bots) | fetch (curl/browsers/API) | unknown.
 * NOTE (D-201-19): signals, not proof of real agent usage — report as
 * "agent_json_requests", never "agents used".
 */
export const agentJsonRequests = new Counter({
  name: "agent_json_requests_total",
  help: "Requests to /blog/:slug.json Knowledge Objects (signal, not proof of agent usage)",
  labelNames: ["slug", "ua_class"],
  registers: [registry],
});

export const activeScans = new Gauge({
  name: "agentbadge_active_scans",
  help: "Currently running scans",
  registers: [registry],
});

/** SLICE-156-5: share of gateway payments that expired unpaid (rising
 *  ⇒ buyers underfund their unified balance). Recomputed on terminal. */
export const gatewayExpiryRate = new Gauge({
  name: "agentbadge_gateway_expiry_rate",
  help: "Expired / all terminal cross-chain gateway payments (0..1)",
  registers: [registry],
});

export const cacheHits = new Counter({
  name: "agentbadge_cache_hits_total",
  help: "Cache hits",
  labelNames: ["layer"],
  registers: [registry],
});

export const cacheMisses = new Counter({
  name: "agentbadge_cache_misses_total",
  help: "Cache misses",
  registers: [registry],
});

/** EPIC-230 (SLICE-230-7, spec §17.3): Review Performance metrics.
 *  Wired in server/wiring/feedback-review.ts off the post-commit
 *  event hooks — a metric failure must never break a write. */
export const reviewPending = new Gauge({
  name: "agentbadge_review_pending",
  help: "Review cases awaiting operator attention (PENDING_TRIAGE + REOPENED)",
  registers: [registry],
});

export const reviewDurationSeconds = new Histogram({
  name: "agentbadge_review_duration_seconds",
  help: "Submission-to-decision latency of review cases",
  buckets: [60, 300, 900, 3600, 14400, 86400, 259200],
  registers: [registry],
});

export const reviewsDecidedTotal = new Counter({
  name: "agentbadge_reviews_decided_total",
  help: "Review decisions appended (reviews per operator)",
  labelNames: ["operator", "outcome"],
  registers: [registry],
});

export const reviewsReopenedTotal = new Counter({
  name: "agentbadge_reviews_reopened_total",
  help: "Review cases reopened after a decision",
  registers: [registry],
});

export const reviewsSubmittedTotal = new Counter({
  name: "agentbadge_reviews_submitted_total",
  help: "Review requests submitted by agents",
  labelNames: ["review_type"],
  registers: [registry],
});

export const feedbackReceivedTotal = new Counter({
  name: "agentbadge_feedback_received_total",
  help: "Agent feedback submissions",
  labelNames: ["kind", "target"],
  registers: [registry],
});

export const knowledgeConversionsTotal = new Counter({
  name: "agentbadge_knowledge_conversions_total",
  help: "Feedback/review outcomes converted to knowledge drafts",
  labelNames: ["source"],
  registers: [registry],
});
