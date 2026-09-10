/**
 * SLICE-99-2: Monitoring types per spec v0.7 §10.1–10.4.
 *
 * Field-for-field match with spec. Zod validation at CRUD boundary.
 */

import { z } from "zod";

// §10.1 Schedule
export const ScheduleConfigSchema = z.object({
  kind: z.enum(["daily", "weekly"]),
  hour_utc: z.number().int().min(0).max(23),
  day_of_week: z.number().int().min(0).max(6).optional(),
}).refine(
  (data) => data.kind !== "weekly" || data.day_of_week !== undefined,
  { message: "day_of_week is required for weekly schedule" },
);

export interface ScheduleConfig {
  kind: "daily" | "weekly";
  hour_utc: number;
  day_of_week?: number;
}

// §10.4 Channel
export const ChannelConfigSchema = z.object({
  type: z.enum(["webhook", "discord", "telegram", "email"]),
  target: z.string().min(1),
});

export interface ChannelConfig {
  type: "webhook" | "discord" | "telegram" | "email";
  target: string;
}

// §10.3 Thresholds
export const ThresholdsSchema = z.object({
  score_drop: z.number().int().min(0).max(100).default(5),
  asr_drop: z.number().min(0).max(1).default(0.1),
  cooldown_hours: z.number().int().min(1).max(168).default(24),
  min_severity: z.enum(["critical", "warning", "info"]).default("warning"),
});

export interface Thresholds {
  score_drop: number;
  asr_drop: number;
  cooldown_hours: number;
  min_severity: "critical" | "warning" | "info";
}

// §10.1 MonitoredProject
export const ProjectInputSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  schedule: ScheduleConfigSchema,
  channels: z.array(ChannelConfigSchema).min(1),
  thresholds: ThresholdsSchema.optional(),
  plan: z.enum(["free", "paid"]).default("free"),
});

export interface MonitoredProject {
  project_id: string;
  name: string;
  url: string;
  schedule: ScheduleConfig;
  enabled: boolean;
  channels: ChannelConfig[];
  thresholds: Thresholds;
  plan: "free" | "paid";
  created_at: string;
  updated_at: string;
  next_run_at: string;
  webhook_secret?: string;
}

export type ProjectInputResult = ReturnType<typeof ProjectInputSchema.safeParse>;

export function validateProjectInput(input: unknown): ProjectInputResult {
  return ProjectInputSchema.safeParse(input);
}

// §10.2 RunRecord
export interface RunSummary {
  score: number;
  grade: string;
  pillar_scores: Record<string, number>;
  gap_summary: { total: number; by_priority: Record<string, number>; by_type: Record<string, number> };
  status_counts: Record<string, number>;
  asr: number | null;
  /** Per-gap IDs present in this run. Used by regression engine for new_gap/reopened_gap. */
  gap_ids?: string[];
  /** Per-rule status map. Used by regression engine for status_flip/new_conflict. */
  rule_statuses?: Record<string, string>;
}

export interface RunRecord {
  run_id: string;
  project_id: string;
  started_at: string;
  finished_at: string;
  trigger: "scheduled" | "manual";
  outcome: "ok" | "error";
  summary: RunSummary;
  report_ref: string;
}

// §10.3 RegressionReport
export type RegressionRuleType =
  | "score_drop"
  | "new_gap"
  | "reopened_gap"
  | "status_flip"
  | "new_conflict"
  | "asr_drop";

export type Severity = "critical" | "warning" | "info";

export interface RegressionItem {
  rule: RegressionRuleType;
  severity: Severity;
  gap_id?: string;
  rule_id?: string;
  delta: Record<string, unknown>;
}

export interface RegressionReport {
  project_id: string;
  run_id: string;
  findings: RegressionItem[];
}

// §10.4 AlertRecord
export interface AlertRecord {
  alert_id: string;
  project_id: string;
  run_id: string;
  finding: RegressionItem;
  channel: "webhook" | "discord" | "telegram" | "email";
  sent_at: string;
  dedupe_key: string;
}
