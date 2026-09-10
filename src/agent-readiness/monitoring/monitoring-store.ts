/**
 * SLICE-99-2: File-backed persistent monitoring store per spec v0.7 §10.6.
 *
 * Layout:
 *   {root}/projects.json       — { project_id: MonitoredProject }
 *   {root}/runs/{project_id}.json  — RunRecord[]
 *   {root}/alerts/{project_id}.json — AlertRecord[]
 *   {root}/gap-history/{project_id}.json — string[] (gap_ids)
 *   {root}/cooldowns/{project_id}.json — { key: timestamp }
 *
 * Atomic writes: temp file + rename.
 * Single-writer assumption: one server process.
 * Storage root configurable via env MONITORING_DATA_DIR (default .data/monitoring/).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import type { MonitoredProject, RunRecord, AlertRecord } from "./monitoring-types";

export interface MonitoringStore {
  // Project CRUD
  upsertProject(project: MonitoredProject): void;
  getProject(project_id: string): MonitoredProject | null;
  listProjects(): MonitoredProject[];
  deleteProject(project_id: string): void;

  // Runs
  appendRun(run: RunRecord): void;
  getLatestRun(project_id: string): RunRecord | null;
  getLatestRuns(project_id: string, n: number): RunRecord[];

  // Alerts
  appendAlert(alert: AlertRecord): void;
  getAlerts(project_id: string): AlertRecord[];

  // Cooldowns
  setCooldown(project_id: string, key: string, timestamp: string): void;
  getCooldown(project_id: string, key: string): string | null;

  // Gap history
  addToGapHistory(project_id: string, gap_id: string): void;
  getGapHistory(project_id: string): string[];
}

function atomicWrite(filePath: string, data: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + ".tmp";
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) {
    return fallback;
  }
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function createMonitoringStore(rootDir?: string): MonitoringStore {
  const root = rootDir ?? process.env.MONITORING_DATA_DIR ?? ".data/monitoring";

  // Ensure root exists
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  const projectsPath = join(root, "projects.json");
  const runsDir = join(root, "runs");
  const alertsDir = join(root, "alerts");
  const gapHistoryDir = join(root, "gap-history");
  const cooldownsDir = join(root, "cooldowns");

  return {
    upsertProject(project) {
      const all = readJson<Record<string, MonitoredProject>>(projectsPath, {});
      all[project.project_id] = project;
      atomicWrite(projectsPath, JSON.stringify(all, null, 2));
    },

    getProject(project_id) {
      const all = readJson<Record<string, MonitoredProject>>(projectsPath, {});
      return all[project_id] ?? null;
    },

    listProjects() {
      const all = readJson<Record<string, MonitoredProject>>(projectsPath, {});
      return Object.values(all);
    },

    deleteProject(project_id) {
      const all = readJson<Record<string, MonitoredProject>>(projectsPath, {});
      delete all[project_id];
      atomicWrite(projectsPath, JSON.stringify(all, null, 2));
    },

    appendRun(run) {
      const path = join(runsDir, `${run.project_id}.json`);
      const runs = readJson<RunRecord[]>(path, []);
      runs.push(run);
      atomicWrite(path, JSON.stringify(runs, null, 2));
    },

    getLatestRun(project_id) {
      const path = join(runsDir, `${project_id}.json`);
      const runs = readJson<RunRecord[]>(path, []);
      if (runs.length === 0) return null;
      return runs[runs.length - 1];
    },

    getLatestRuns(project_id, n) {
      const path = join(runsDir, `${project_id}.json`);
      const runs = readJson<RunRecord[]>(path, []);
      return runs.slice(-n).reverse();
    },

    appendAlert(alert) {
      const path = join(alertsDir, `${alert.project_id}.json`);
      const alerts = readJson<AlertRecord[]>(path, []);
      alerts.push(alert);
      atomicWrite(path, JSON.stringify(alerts, null, 2));
    },

    getAlerts(project_id) {
      const path = join(alertsDir, `${project_id}.json`);
      return readJson<AlertRecord[]>(path, []);
    },

    setCooldown(project_id, key, timestamp) {
      const path = join(cooldownsDir, `${project_id}.json`);
      const all = readJson<Record<string, string>>(path, {});
      all[key] = timestamp;
      atomicWrite(path, JSON.stringify(all, null, 2));
    },

    getCooldown(project_id, key) {
      const path = join(cooldownsDir, `${project_id}.json`);
      const all = readJson<Record<string, string>>(path, {});
      return all[key] ?? null;
    },

    addToGapHistory(project_id, gap_id) {
      const path = join(gapHistoryDir, `${project_id}.json`);
      const history = readJson<string[]>(path, []);
      if (!history.includes(gap_id)) {
        history.push(gap_id);
        atomicWrite(path, JSON.stringify(history, null, 2));
      }
    },

    getGapHistory(project_id) {
      const path = join(gapHistoryDir, `${project_id}.json`);
      return readJson<string[]>(path, []);
    },
  };
}
