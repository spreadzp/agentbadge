import { describe, it, expect } from "vitest";
import {
  MonitoringPage,
  MonitoringProjectDetail,
  MonitoringProjectCard,
  MonitoringEmptyState,
  MonitoringAddForm,
  type MonitoringPageData,
} from "../../src/views/monitoring-page";

/**
 * SLICE-99-8: Web monitoring dashboard view tests.
 */

function makeProjectData(overrides?: Partial<MonitoringPageData["projects"][0]>): MonitoringPageData["projects"][0] {
  return {
    project_id: "p1",
    name: "Test API",
    url: "https://api.example.com",
    plan: "free",
    enabled: true,
    schedule: { kind: "daily", hour_utc: 6 },
    channels: [{ type: "webhook", target: "https://hook.example.com" }],
    thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
    next_run_at: "2026-09-04T06:00:00Z",
    latest_score: 72,
    latest_grade: "C",
    latest_outcome: "ok",
    score_history: [80, 75, 72],
    ...overrides,
  };
}

describe("SLICE-99-8: MonitoringPage — projects list", () => {
  it("renders project cards when projects exist", () => {
    const html = MonitoringPage({
      projects: [makeProjectData()],
    });
    const str = html.toString();
    expect(str).toContain("Test API");
    expect(str).toContain("api.example.com");
    expect(str).toContain("72");
    expect(str).toContain("C");
  });

  it("renders empty state when no projects", () => {
    const html = MonitoringPage({ projects: [] });
    const str = html.toString();
    expect(str).toContain("register your first project");
    expect(str).toContain("Monitoring keeps you fixed");
  });

  it("includes no-JS degraded text", () => {
    const html = MonitoringPage({ projects: [makeProjectData()] });
    const str = html.toString();
    expect(str).toContain("noscript");
  });

  it("includes add project form", () => {
    const html = MonitoringPage({ projects: [] });
    const str = html.toString();
    expect(str).toContain("form");
    expect(str).toContain("url");
    expect(str).toContain("name");
  });

  it("shows free-tier limits inline", () => {
    const html = MonitoringPage({ projects: [makeProjectData()] });
    const str = html.toString();
    expect(str).toContain("Free");
    expect(str).toContain("1 project");
    expect(str).toContain("daily");
  });

  it("shows score delta when history available", () => {
    const html = MonitoringPage({
      projects: [makeProjectData({ score_history: [80, 72], latest_score: 72 })],
    });
    const str = html.toString();
    expect(str).toContain("-8"); // 72 - 80 = -8
  });

  it("shows next run time", () => {
    const html = MonitoringPage({
      projects: [makeProjectData({ next_run_at: "2026-09-04T06:00:00Z" })],
    });
    const str = html.toString();
    expect(str).toContain("2026-09-04");
  });
});

describe("SLICE-99-8: MonitoringProjectCard", () => {
  it("renders sparkline from score history", () => {
    const card = MonitoringProjectCard(makeProjectData({ score_history: [80, 75, 72] }));
    const str = card.toString();
    expect(str).toContain("svg");
    expect(str).toContain("polyline");
  });

  it("shows enabled/paused toggle", () => {
    const card = MonitoringProjectCard(makeProjectData({ enabled: true }));
    const str = card.toString();
    expect(str).toContain("enabled");
  });

  it("shows outcome badge", () => {
    const card = MonitoringProjectCard(makeProjectData({ latest_outcome: "ok" }));
    const str = card.toString();
    expect(str).toContain("ok");
  });
});

describe("SLICE-99-8: MonitoringProjectDetail", () => {
  function makeDetailData() {
    return {
      project: makeProjectData(),
      runs: [
        {
          run_id: "r1",
          project_id: "p1",
          started_at: "2026-09-04T06:00:00Z",
          finished_at: "2026-09-04T06:00:05Z",
          trigger: "scheduled",
          outcome: "ok",
          summary: {
            score: 72,
            grade: "C",
            pillar_scores: {},
            gap_summary: { total: 2, by_priority: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 }, by_type: { documentation: 1, semantic: 1, capability: 0, evidence: 0 } },
            status_counts: { verified: 28, missing: 8 },
            asr: null,
          },
          report_ref: "p1/r1",
        },
        {
          run_id: "r2",
          project_id: "p1",
          started_at: "2026-09-03T06:00:00Z",
          finished_at: "2026-09-03T06:00:05Z",
          trigger: "scheduled",
          outcome: "ok",
          summary: {
            score: 80,
            grade: "B",
            pillar_scores: {},
            gap_summary: { total: 1, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 }, by_type: { documentation: 1, semantic: 0, capability: 0, evidence: 0 } },
            status_counts: { verified: 30, missing: 6 },
            asr: null,
          },
          report_ref: "p1/r2",
        },
      ],
      alerts: [],
      regressions: [
        { rule: "score_drop", severity: "warning", delta: { prev: 80, curr: 72, drop: 8 } },
      ],
    };
  }

  it("renders timeline chart from run scores", () => {
    const detail = MonitoringProjectDetail(makeDetailData());
    const str = detail.toString();
    expect(str).toContain("svg");
    expect(str).toContain("80");
    expect(str).toContain("72");
  });

  it("renders run table with trigger, outcome, score", () => {
    const detail = MonitoringProjectDetail(makeDetailData());
    const str = detail.toString();
    expect(str).toContain("scheduled");
    expect(str).toContain("ok");
    expect(str).toContain("72");
    expect(str).toContain("80");
  });

  it("renders regression diff with items", () => {
    const detail = MonitoringProjectDetail(makeDetailData());
    const str = detail.toString();
    expect(str).toContain("score_drop");
    expect(str).toContain("80");
    expect(str).toContain("72");
    expect(str).toContain("warning");
  });

  it("renders alerts log section", () => {
    const detail = MonitoringProjectDetail(makeDetailData());
    const str = detail.toString();
    expect(str).toContain("alert");
  });

  it("renders Run now button", () => {
    const detail = MonitoringProjectDetail(makeDetailData());
    const str = detail.toString();
    expect(str).toContain("Run now");
  });

  it("renders Test alert button", () => {
    const detail = MonitoringProjectDetail(makeDetailData());
    const str = detail.toString();
    expect(str).toContain("Test alert");
  });
});

describe("SLICE-99-8: MonitoringEmptyState", () => {
  it("renders CTA to add first project", () => {
    const html = MonitoringEmptyState();
    const str = html.toString();
    expect(str).toContain("register your first project");
    expect(str).toContain("Monitoring keeps you fixed");
  });
});

describe("SLICE-99-8: MonitoringAddForm", () => {
  it("renders form fields for URL, name, schedule, channels", () => {
    const form = MonitoringAddForm();
    const str = form.toString();
    expect(str).toContain('name="name"');
    expect(str).toContain('name="url"');
    expect(str).toContain('name="schedule"');
    expect(str).toContain('name="channels"');
  });

  it("includes webhook secret field (write-only)", () => {
    const form = MonitoringAddForm();
    const str = form.toString();
    expect(str).toContain('name="webhook_secret"');
    expect(str).toContain('type="password"');
  });

  it("shows free-tier limits inline", () => {
    const form = MonitoringAddForm();
    const str = form.toString();
    expect(str).toContain("Free");
    expect(str).toContain("1 project");
    expect(str).toContain("daily");
  });
});
