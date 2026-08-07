import { Registry, Counter, Histogram, Gauge } from "prom-client";

export const registry = new Registry();

registry.setDefaultLabels({
  service: "agentbadge",
});

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

export const activeScans = new Gauge({
  name: "agentbadge_active_scans",
  help: "Currently running scans",
  registers: [registry],
});

export const cacheHits = new Counter({
  name: "agentbadge_cache_hits_total",
  help: "Cache hits",
  registers: [registry],
});

export const cacheMisses = new Counter({
  name: "agentbadge_cache_misses_total",
  help: "Cache misses",
  registers: [registry],
});
