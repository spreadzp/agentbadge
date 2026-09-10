/**
 * SLICE-99-6: Alert engine — processes run results, dedupes, delivers.
 *
 * processRunResult(project, runRecord, deps) → AlertOutcome
 *
 * Flow:
 * 1. Get prev ok run from store
 * 2. detectRegressions(prev, now, history, thresholds)
 * 3. No regression → silent (no alert, no AlertRecord)
 * 4. Severity filter: findings below min_severity → suppressed
 * 5. Dedupe + cooldown: per-key, if cooldown_until > now → suppress
 * 6. Deliver to all configured channels (isolation: one failure doesn't block others)
 * 7. Persist AlertRecords
 */

import { randomUUID } from "node:crypto";
import type { MonitoringStore } from "./monitoring-store";
import type {
  MonitoredProject,
  RunRecord,
  RegressionReport,
  RegressionItem,
  AlertRecord,
  Severity,
} from "./monitoring-types";
import { detectRegressions, DEFAULT_THRESHOLDS } from "./regression";
import { sendWebhook } from "./channels/webhook";

export interface AlertOutcome {
  alerted: boolean;
  alertRecords: AlertRecord[];
  suppressed: RegressionItem[];
  channelFailures: { channel: string; error: string }[];
}

export interface ProcessRunDeps {
  store: MonitoringStore;
  now: () => Date;
  prevRun?: RunRecord;
  history: string[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Generate dedupe key: f(project_id, rule_type, gap_id|rule_id)
 */
export function makeDedupeKey(
  project_id: string,
  rule: string,
  gap_id?: string,
  rule_id?: string,
): string {
  const id = gap_id ?? rule_id ?? "";
  return `${project_id}|${rule}|${id}`;
}

/**
 * Format a regression alert as deterministic text.
 * Markdown-flavored for webhook/discord; plain for email.
 */
export function formatRegressionAlert(
  project: MonitoredProject,
  report: RegressionReport,
  prevRun: RunRecord,
  nowRun: RunRecord,
): string {
  const lines: string[] = [];
  lines.push(`# AgentBadge Alert: ${project.name}`);
  lines.push(``);
  lines.push(`**Score:** ${prevRun.summary.score} → ${nowRun.summary.score}`);
  lines.push(`**Findings:** ${report.findings.length}`);
  lines.push(``);

  for (const f of report.findings) {
    const id = f.gap_id ?? f.rule_id ?? "";
    const deltaStr = Object.entries(f.delta)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(`- **${f.rule}** ${id} (${f.severity}) — ${deltaStr}`);
  }

  lines.push(``);
  lines.push(`**Report:** ${nowRun.report_ref}`);
  lines.push(`**Timeline:** ${project.project_id}/timeline`);
  lines.push(`**Time:** ${nowRun.finished_at}`);

  return lines.join("\n");
}

/**
 * Process a run result: detect regressions, dedupe, alert.
 */
export async function processRunResult(
  project: MonitoredProject,
  nowRun: RunRecord,
  deps: ProcessRunDeps,
): Promise<AlertOutcome> {
  const { store, now, history } = deps;
  const prevRun = deps.prevRun;

  // Need a previous ok run to diff against
  if (!prevRun || prevRun.outcome !== "ok") {
    return { alerted: false, alertRecords: [], suppressed: [], channelFailures: [] };
  }

  // Detect regressions
  const report = detectRegressions({
    prev: prevRun,
    now: nowRun,
    history,
    thresholds: project.thresholds ?? DEFAULT_THRESHOLDS,
  });

  // Noop: no regression → silent
  if (!report) {
    return { alerted: false, alertRecords: [], suppressed: [], channelFailures: [] };
  }

  const nowTime = now();
  const cooldownMs = (project.thresholds?.cooldown_hours ?? 24) * 60 * 60 * 1000;
  const minSeverity = project.thresholds?.min_severity ?? "warning";
  const minSeverityLevel = SEVERITY_ORDER[minSeverity] ?? 2;

  // Severity filter + dedupe + cooldown
  const toAlert: RegressionItem[] = [];
  const suppressed: RegressionItem[] = [];

  for (const finding of report.findings) {
    // Severity filter
    if ((SEVERITY_ORDER[finding.severity] ?? 0) < minSeverityLevel) {
      suppressed.push(finding);
      continue;
    }

    // Dedupe + cooldown
    const key = makeDedupeKey(project.project_id, finding.rule, finding.gap_id, finding.rule_id);
    const cooldownUntil = store.getCooldown(project.project_id, key);
    if (cooldownUntil && new Date(cooldownUntil) > nowTime) {
      suppressed.push(finding);
      continue;
    }

    toAlert.push(finding);
    // Set cooldown
    const cooldownUntilIso = new Date(nowTime.getTime() + cooldownMs).toISOString();
    store.setCooldown(project.project_id, key, cooldownUntilIso);
  }

  if (toAlert.length === 0) {
    return { alerted: false, alertRecords: [], suppressed, channelFailures: [] };
  }

  // Deliver to channels
  const alertText = formatRegressionAlert(project, report, prevRun, nowRun);
  const channelFailures: { channel: string; error: string }[] = [];
  const alertRecords: AlertRecord[] = [];

  for (const channel of project.channels) {
    const sentAt = now().toISOString();
    const alertId = randomUUID();
    const dedupeKey = makeDedupeKey(project.project_id, toAlert[0].rule, toAlert[0].gap_id, toAlert[0].rule_id);

    try {
      if (channel.type === "webhook") {
        const result = await sendWebhook(
          channel.target,
          {
            project: project.name,
            project_id: project.project_id,
            severity: toAlert[0].severity,
            items: toAlert,
            text: alertText,
            report_ref: nowRun.report_ref,
          },
          project.webhook_secret,
        );

        if (!result.ok) {
          channelFailures.push({ channel: "webhook", error: result.error ?? "unknown" });
          continue;
        }
      } else if (channel.type === "discord") {
        // Discord uses webhook-style URL too
        const result = await sendWebhook(channel.target, { content: alertText }, undefined);
        if (!result.ok) {
          channelFailures.push({ channel: "discord", error: result.error ?? "unknown" });
          continue;
        }
      } else if (channel.type === "telegram") {
        // Telegram bot API — stub for now, wired in 99-7
        channelFailures.push({ channel: "telegram", error: "not implemented yet" });
        continue;
      } else if (channel.type === "email") {
        // Email — stub for now, wired in 99-7
        channelFailures.push({ channel: "email", error: "not implemented yet" });
        continue;
      }

      // Persist AlertRecord for successful delivery
      const record: AlertRecord = {
        alert_id: alertId,
        project_id: project.project_id,
        run_id: nowRun.run_id,
        finding: toAlert[0],
        channel: channel.type,
        sent_at: sentAt,
        dedupe_key: dedupeKey,
      };
      store.appendAlert(record);
      alertRecords.push(record);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channelFailures.push({ channel: channel.type, error: msg });
    }
  }

  return {
    alerted: alertRecords.length > 0,
    alertRecords,
    suppressed,
    channelFailures,
  };
}
