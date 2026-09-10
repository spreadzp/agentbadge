/**
 * SLICE-99-7: Monitoring API routes.
 *
 * POST   /monitoring/projects          — create (zod-validated, tier-checked)
 * GET    /monitoring/projects          — list
 * GET    /monitoring/projects/:id      — detail
 * PATCH  /monitoring/projects/:id      — update
 * DELETE /monitoring/projects/:id      — remove (runs kept, orphaned)
 * POST   /monitoring/projects/:id/run  — manual trigger
 * GET    /monitoring/projects/:id/runs — timeline
 * GET    /monitoring/projects/:id/alerts — alert log
 * POST   /monitoring/projects/:id/test-alert — test alert
 *
 * Auth: public MVP (no API key) — input validation + tier enforcement.
 * Future: API key per project for mutations.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { MonitoringStore } from "../../agent-readiness/monitoring/monitoring-store";
import type { MonitoredProject, RunRecord, RegressionItem } from "../../agent-readiness/monitoring/monitoring-types";
import { validateProjectInput } from "../../agent-readiness/monitoring/monitoring-types";
import { computeNextRun } from "../../agent-readiness/monitoring/scheduler";
import { executeMonitoredRun, getTimeline } from "../../agent-readiness/monitoring/run-pipeline";
import { processRunResult } from "../../agent-readiness/monitoring/alert-engine";
import { detectRegressions, DEFAULT_THRESHOLDS } from "../../agent-readiness/monitoring/regression";
import { sendWebhook } from "../../agent-readiness/monitoring/channels/webhook";
import {
  resolvePlan,
  checkProjectLimit,
  checkScheduleAllowed,
  checkChannelsAllowed,
  type Plan,
} from "../../agent-readiness/monitoring/tiers";
import type { ScanReport } from "../../agent-readiness/report-formatter";
import { MonitoringPage, MonitoringProjectDetail, type MonitoringPageData, type MonitoringDetailData } from "../../views/monitoring-page";

export interface MonitoringAppDeps {
  store: MonitoringStore;
  now: () => Date;
  scanFn: (url: string) => Promise<ScanReport>;
  onDueProject?: (project: MonitoredProject, trigger: "scheduled" | "manual") => Promise<{ outcome: "ok" | "error" }>;
}

export function createMonitoringRoutes(deps: MonitoringAppDeps): Hono {
  const app = new Hono();
  const { store, now, scanFn } = deps;

  // POST /monitoring/projects — create
  app.post("/monitoring/projects", async (c) => {
    const body = await c.req.json();
    const validation = validateProjectInput(body);
    if (!validation.success) {
      return c.json({ error: "Validation failed", details: validation.error.issues }, 400);
    }

    const input = validation.data;
    const plan = resolvePlan({ plan: input.plan });

    // Tier checks
    const existingProjects = store.listProjects();
    const limitCheck = checkProjectLimit(plan, existingProjects.length);
    if (!limitCheck.allowed) {
      return c.json({ error: limitCheck.error }, 402);
    }

    const scheduleCheck = checkScheduleAllowed(plan, input.schedule.kind);
    if (!scheduleCheck.allowed) {
      return c.json({ error: scheduleCheck.error }, 402);
    }

    const channelsCheck = checkChannelsAllowed(plan, input.channels);
    if (!channelsCheck.allowed) {
      return c.json({ error: channelsCheck.error }, 402);
    }

    const projectId = randomUUID();
    const nowTime = now().toISOString();
    const nextRun = computeNextRun(input.schedule, now());

    const project: MonitoredProject = {
      project_id: projectId,
      name: input.name,
      url: input.url,
      schedule: input.schedule,
      enabled: true,
      channels: input.channels,
      thresholds: input.thresholds ?? { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
      plan,
      created_at: nowTime,
      updated_at: nowTime,
      next_run_at: nextRun.toISOString(),
      webhook_secret: (body as Record<string, unknown>).webhook_secret as string | undefined,
    };

    store.upsertProject(project);
    return c.json(project, 201);
  });

  // GET /monitoring/projects — list
  app.get("/monitoring/projects", (c) => {
    const projects = store.listProjects();
    return c.json({ projects });
  });

  // GET /monitoring/projects/:id — detail
  app.get("/monitoring/projects/:id", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    return c.json(project);
  });

  // PATCH /monitoring/projects/:id — update
  app.patch("/monitoring/projects/:id", async (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const body = await c.req.json();
    const updated: MonitoredProject = { ...project, ...body, updated_at: now().toISOString() };

    // Recompute next_run if schedule changed
    if (body.schedule) {
      const scheduleCheck = checkScheduleAllowed(updated.plan, updated.schedule.kind);
      if (!scheduleCheck.allowed) {
        return c.json({ error: scheduleCheck.error }, 402);
      }
      updated.next_run_at = computeNextRun(updated.schedule, now()).toISOString();
    }

    if (body.channels) {
      const channelsCheck = checkChannelsAllowed(updated.plan, updated.channels);
      if (!channelsCheck.allowed) {
        return c.json({ error: channelsCheck.error }, 402);
      }
    }

    store.upsertProject(updated);
    return c.json(updated);
  });

  // DELETE /monitoring/projects/:id — remove (runs kept, orphaned)
  app.delete("/monitoring/projects/:id", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    store.deleteProject(c.req.param("id"));
    return c.json({ deleted: true, note: "Runs preserved (orphaned, still queryable)" });
  });

  // POST /monitoring/projects/:id/run — manual trigger
  app.post("/monitoring/projects/:id/run", async (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const run = await executeMonitoredRun(project, "manual", {
      store,
      now,
      scanFn,
    });

    // Chain alert engine
    const prevRuns = store.getLatestRuns(project.project_id, 2);
    const prevRun = prevRuns.length > 1 ? prevRuns[1] : undefined;
    const history = store.getGapHistory(project.project_id);

    await processRunResult(project, run, {
      store,
      now,
      prevRun,
      history,
    });

    return c.json(run);
  });

  // GET /monitoring/projects/:id/runs — timeline
  app.get("/monitoring/projects/:id/runs", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!, 10) : undefined;
    const runs = getTimeline(store, project.project_id, limit);
    return c.json({ runs });
  });

  // GET /monitoring/projects/:id/runs/:run_id — one record
  app.get("/monitoring/projects/:id/runs/:run_id", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const runs = store.getLatestRuns(project.project_id, 1000);
    const run = runs.find((r) => r.run_id === c.req.param("run_id"));
    if (!run) return c.json({ error: "Run not found" }, 404);
    return c.json(run);
  });

  // GET /monitoring/projects/:id/alerts — alert log
  app.get("/monitoring/projects/:id/alerts", (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);
    const alerts = store.getAlerts(project.project_id);
    return c.json({ alerts });
  });

  // POST /monitoring/projects/:id/test-alert — test alert
  app.post("/monitoring/projects/:id/test-alert", async (c) => {
    const project = store.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    let sent = 0;
    const failures: { channel: string; error: string }[] = [];

    for (const channel of project.channels) {
      try {
        if (channel.type === "webhook" || channel.type === "discord") {
          const result = await sendWebhook(
            channel.target,
            { project: project.name, test: true, text: `Test alert from AgentBadge for ${project.name}` },
            project.webhook_secret,
          );
          if (result.ok) {
            sent++;
          } else {
            failures.push({ channel: channel.type, error: result.error ?? "unknown" });
          }
        } else {
          failures.push({ channel: channel.type, error: "not implemented yet" });
        }
      } catch (err) {
        failures.push({ channel: channel.type, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return c.json({ sent, failures });
  });

  // View routes — registered after API routes to avoid shadowing
  // GET /monitoring — dashboard view (HTML)
  app.get("/monitoring", (c) => {
    const projects = store.listProjects().map((p) => {
      const runs = store.getLatestRuns(p.project_id, 10);
      const latest = runs[0];
      const scoreHistory = runs.filter((r) => r.outcome === "ok").map((r) => r.summary.score).reverse();
      return {
        ...p,
        latest_score: latest?.outcome === "ok" ? latest.summary.score : undefined,
        latest_grade: latest?.outcome === "ok" ? latest.summary.grade : undefined,
        latest_outcome: latest?.outcome,
        score_history: scoreHistory,
      };
    });
    const html = MonitoringPage({ projects });
    return c.html(html);
  });

  // GET /monitoring/:id — project detail view (HTML)
  // Note: must be after /monitoring/projects, /monitoring/projects/:id etc.
  app.get("/monitoring/:id", (c) => {
    const id = c.req.param("id");
    // Skip if this matches an API path segment
    if (id === "projects") return c.notFound();
    const project = store.getProject(id);
    if (!project) return c.html("<h1>Project not found</h1>", 404);

    const runs = store.getLatestRuns(project.project_id, 50);
    const alerts = store.getAlerts(project.project_id);

    const okRuns = runs.filter((r) => r.outcome === "ok");
    let regressions: RegressionItem[] = [];
    if (okRuns.length >= 2) {
      const history = store.getGapHistory(project.project_id);
      const report = detectRegressions({
        prev: okRuns[1],
        now: okRuns[0],
        history,
        thresholds: project.thresholds ?? DEFAULT_THRESHOLDS,
      });
      regressions = report?.findings ?? [];
    }

    const detailData: MonitoringDetailData = {
      project: {
        ...project,
        latest_score: okRuns[0]?.summary.score,
        latest_grade: okRuns[0]?.summary.grade,
        latest_outcome: okRuns[0]?.outcome,
        score_history: okRuns.map((r) => r.summary.score).reverse(),
      },
      runs,
      alerts: alerts.map((a) => ({
        alert_id: a.alert_id,
        channel: a.channel,
        sent_at: a.sent_at,
        finding: { rule: a.finding.rule, severity: a.finding.severity },
      })),
      regressions,
    };
    const html = MonitoringProjectDetail(detailData);
    return c.html(String(html));
  });

  return app;
}
