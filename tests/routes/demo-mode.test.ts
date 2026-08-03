import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import demo from "../../src/server/routes/demo";

const app = new Hono();
app.route("/api/demo", demo);

describe("Demo endpoints migration — mode param", () => {
  const originalDatahubUrl = process.env.DATAHUB_UI_URL;

  beforeAll(() => {
    process.env.DATAHUB_UI_URL = "http://test-datahub:9002";
  });

  afterAll(() => {
    process.env.DATAHUB_UI_URL = originalDatahubUrl;
  });

  it("generate-and-process: default mode is agent", async () => {
    const res = await app.request("/api/demo/medical-data/generate-and-process", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("agent");
    expect(body.taskId).toBeDefined();
    expect(body.status).toBe("posted");
  });

  it("generate-and-process: demo mode returns simple response", async () => {
    const res = await app.request("/api/demo/medical-data/generate-and-process?mode=demo", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("demo");
    expect(body.data).toBeDefined();
    expect(body.analysis).toBeDefined();
    expect(body.taskId).toBeUndefined();
  });

  it("generate-and-process: agent mode includes hashscanUrl and datahubLinks", async () => {
    const res = await app.request("/api/demo/medical-data/generate-and-process?mode=agent", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("agent");
    expect(body.hashscanUrl).toContain("hashscan.io");
    expect(body.datahubLinks).toBeDefined();
    expect(body.datahubLinks.dataset).toContain("test-datahub");
    expect(body.datahubLinks.lineage).toContain("test-datahub");
  });

  it("generate-and-report: demo mode returns HTML", async () => {
    const res = await app.request("/api/demo/medical-data/generate-and-report?mode=demo", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("html");
  });

  it("generate-and-report: agent mode returns JSON with enriched fields", async () => {
    const res = await app.request("/api/demo/medical-data/generate-and-report?mode=agent", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("agent");
    expect(body.taskId).toBeDefined();
    expect(body.htmlReport).toBeDefined();
    expect(body.hashscanUrl).toContain("hashscan.io");
    expect(body.datahubLinks).toBeDefined();
    expect(body.datahubLinks.glossary).toContain("test-datahub");
    expect(body.datahubLinks.assertions).toContain("test-datahub");
  });

  it("task-with-patient: default mode is agent", async () => {
    const patientId = "P001";

    const res = await app.request(`/api/demo/marketplace/task-with-patient/${patientId}`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("agent");
    expect(body.taskId).toBeDefined();
    expect(body.hashscanUrl).toContain("hashscan.io");
    expect(body.datahubLinks).toBeDefined();
  });

  it("task-with-patient: demo mode returns simple response", async () => {
    const patientId = "P001";

    const res = await app.request(`/api/demo/marketplace/task-with-patient/${patientId}?mode=demo`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("demo");
    expect(body.hashscanUrl).toBeUndefined();
  });

  it("task-with-patient: agent mode includes verifierType in task", async () => {
    const patientId = "P001";

    const res = await app.request(`/api/demo/marketplace/task-with-patient/${patientId}?mode=agent`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.verifierType).toBe("datahub");
  });

  it("task-with-patient: demo mode does not include verifierType", async () => {
    const patientId = "P001";

    const res = await app.request(`/api/demo/marketplace/task-with-patient/${patientId}?mode=demo`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.verifierType).toBeUndefined();
  });
});
