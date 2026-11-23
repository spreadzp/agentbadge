// EPIC-259 (SLICE-259-30): ops/monitoring registration split from index.ts
// under the 20KB staged-file cap. Call order contract unchanged — index.ts
// still invokes registerOpsRoutes(app) after wireCirclePayments(app).
import type { Hono } from "hono";
import { metricsApp } from "./observability/metrics";
import { telemetryApp } from "./observability/telemetry";
import { paymentRoutes } from "./payments/payment";
import { createMonitoringRoutes } from "./observability/monitoring";
import { createMonitoringStore } from "../../agent-readiness/monitoring/monitoring-store";

// Ops/monitoring API routes — mounted AFTER wireCirclePayments.
export function registerOpsRoutes(app: Hono): void {
  app.route("/", metricsApp);
  app.route("/", telemetryApp);
  app.route("/", paymentRoutes);

  // Monitoring routes (EPIC-99)
  const monitoringDataDir = process.env.MONITORING_DATA_DIR ?? ".data/monitoring";
  const monitoringStore = createMonitoringStore(monitoringDataDir);
  const monitoringApp = createMonitoringRoutes({
    store: monitoringStore,
    now: () => new Date(),
    scanFn: async (url: string) => {
      const { scanDomain } = await import("../../agent-readiness/scanner/orchestrator");
      const { RuleEngine } = await import("../../agent-readiness/rule-engine/rule-engine");
      const { formatScanReport } = await import("../../agent-readiness/report-formatter");
      const sourceState = await scanDomain(url);
      const result = RuleEngine.run(sourceState);
      return formatScanReport(url, result);
    },
  });
  app.route("/", monitoringApp);
}
