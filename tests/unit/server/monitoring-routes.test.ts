import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { createMonitoringStore } from "../../../src/agent-readiness/monitoring/monitoring-store";
import { createMonitoringRoutes, type MonitoringAppDeps } from "../../../src/server/routes/monitoring";
import { FREE_LIMITS, resolvePlan, checkProjectLimit, checkScheduleAllowed, checkChannelsAllowed } from "../../../src/agent-readiness/monitoring/tiers";

/**
 * SLICE-99-7: Monitoring API + tier gating tests.
 */

function makeProjectInput(overrides?: Record<string, unknown>) {
  return {
    name: "Test API",
    url: "https://api.example.com",
    schedule: { kind: "daily", hour_utc: 6 },
    channels: [{ type: "webhook", target: "https://hook.example.com/abc" }],
    plan: "free",
    ...overrides,
  };
}

describe("SLICE-99-7: tiers.ts — FREE_LIMITS", () => {
  it("free limits: 1 project, daily only, webhook+email only", () => {
    expect(FREE_LIMITS.max_projects).toBe(1);
    expect(FREE_LIMITS.allowed_schedule_kinds).toEqual(["daily"]);
    expect(FREE_LIMITS.allowed_channel_types).toEqual(["webhook", "email"]);
  });

  it("resolvePlan returns free by default", () => {
    expect(resolvePlan({})).toBe("free");
  });

  it("checkProjectLimit: free with 0 projects → ok", () => {
    const result = checkProjectLimit("free", 0);
    expect(result.allowed).toBe(true);
  });

  it("checkProjectLimit: free with 1 project → blocked", () => {
    const result = checkProjectLimit("free", 1);
    expect(result.allowed).toBe(false);
    expect(result.error).toMatch(/upgrade/i);
  });

  it("checkProjectLimit: paid with 10 projects → ok", () => {
    const result = checkProjectLimit("paid", 10);
    expect(result.allowed).toBe(true);
  });

  it("checkScheduleAllowed: free + daily → ok", () => {
    const result = checkScheduleAllowed("free", "daily");
    expect(result.allowed).toBe(true);
  });

  it("checkScheduleAllowed: free + weekly → blocked", () => {
    const result = checkScheduleAllowed("free", "weekly");
    expect(result.allowed).toBe(false);
  });

  it("checkScheduleAllowed: paid + weekly → ok", () => {
    const result = checkScheduleAllowed("paid", "weekly");
    expect(result.allowed).toBe(true);
  });

  it("checkChannelsAllowed: free + webhook → ok", () => {
    const result = checkChannelsAllowed("free", [{ type: "webhook", target: "https://hook.example.com" }]);
    expect(result.allowed).toBe(true);
  });

  it("checkChannelsAllowed: free + discord → blocked", () => {
    const result = checkChannelsAllowed("free", [{ type: "discord", target: "https://discord.example.com" }]);
    expect(result.allowed).toBe(false);
  });

  it("checkChannelsAllowed: paid + discord → ok", () => {
    const result = checkChannelsAllowed("paid", [{ type: "discord", target: "https://discord.example.com" }]);
    expect(result.allowed).toBe(true);
  });
});

describe("SLICE-99-7: Monitoring routes — CRUD", () => {
  let app: Hono;
  let store: ReturnType<typeof createMonitoringStore>;
  let deps: MonitoringAppDeps;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "mon-routes-"));
    store = createMonitoringStore(dir);
    deps = {
      store,
      now: () => new Date("2026-09-04T06:00:00Z"),
      scanFn: async () => ({
        url: "https://api.example.com",
        score: 72,
        grade: "C",
        total_rules: 36,
        verified: 28,
        missing: 8,
        gap: 8,
        not_applicable: 0,
        skipped: 0,
        categories: [],
        top_missing: [],
        summary: "ok",
        pillars: [],
        floorTriggered: false,
        floorReason: null,
        assertions: [],
        gaps: [],
        gap_summary: { total: 0, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 } },
      }),
      onDueProject: async () => ({ outcome: "ok" as const }),
    };
    app = createMonitoringRoutes(deps);
  });

  it("POST /monitoring/projects creates a project", async () => {
    const res = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.project_id).toBeDefined();
    expect(body.name).toBe("Test API");
    expect(body.plan).toBe("free");
  });

  it("GET /monitoring/projects lists projects", async () => {
    await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const res = await app.request("/monitoring/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
  });

  it("GET /monitoring/projects/:id returns project detail", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const created = await createRes.json();
    const res = await app.request(`/monitoring/projects/${created.project_id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project_id).toBe(created.project_id);
  });

  it("PATCH /monitoring/projects/:id updates schedule", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const created = await createRes.json();
    const res = await app.request(`/monitoring/projects/${created.project_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule: { kind: "daily", hour_utc: 12 } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule.hour_utc).toBe(12);
  });

  it("DELETE /monitoring/projects/:id removes project", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const created = await createRes.json();
    const res = await app.request(`/monitoring/projects/${created.project_id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    // Verify deleted
    const getRes = await app.request(`/monitoring/projects/${created.project_id}`);
    expect(getRes.status).toBe(404);
  });

  it("POST rejects bad URL", async () => {
    const res = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput({ url: "not-a-url" })),
    });
    expect(res.status).toBe(400);
  });

  it("free-tier: second project blocked", async () => {
    await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const res = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput({ name: "Second API" })),
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toMatch(/upgrade|limit/i);
  });

  it("free-tier: weekly schedule rejected", async () => {
    const res = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput({ schedule: { kind: "weekly", hour_utc: 6, day_of_week: 1 } })),
    });
    expect(res.status).toBe(402);
  });

  it("free-tier: discord channel rejected", async () => {
    const res = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput({ channels: [{ type: "discord", target: "https://discord.example.com" }] })),
    });
    expect(res.status).toBe(402);
  });

  it("POST /monitoring/projects/:id/run triggers manual run", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const created = await createRes.json();
    const res = await app.request(`/monitoring/projects/${created.project_id}/run`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe("ok");
    expect(body.run_id).toBeDefined();
  });

  it("GET /monitoring/projects/:id/runs returns timeline", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const created = await createRes.json();
    // Trigger a run
    await app.request(`/monitoring/projects/${created.project_id}/run`, { method: "POST" });
    const res = await app.request(`/monitoring/projects/${created.project_id}/runs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
  });

  it("GET /monitoring/projects/:id/alerts returns alert log", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput()),
    });
    const created = await createRes.json();
    const res = await app.request(`/monitoring/projects/${created.project_id}/alerts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toEqual([]);
  });

  it("POST /monitoring/projects/:id/test-alert sends test alert", async () => {
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makeProjectInput({ channels: [{ type: "webhook", target: "http://127.0.0.1:1/test" }] })),
    });
    const created = await createRes.json();
    const res = await app.request(`/monitoring/projects/${created.project_id}/test-alert`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBeDefined();
  });
});
