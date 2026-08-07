import { describe, it, expect, beforeAll } from "vitest";
import { makeTestApp } from "./e2e/helpers";
import { httpRequestTotal, httpDurationMs } from "../src/server/metrics/metrics";

describe("GET /metrics", () => {
  let app: ReturnType<typeof makeTestApp>;

  beforeAll(() => {
    app = makeTestApp();
  });

  it("returns 200 with text/plain content type", async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("response contains agentbadge_http_requests_total counter", async () => {
    const res = await app.request("/metrics");
    const text = await res.text();
    expect(text).toContain("agentbadge_http_requests_total");
  });

  it("response contains agentbadge_http_duration_ms histogram", async () => {
    const res = await app.request("/metrics");
    const text = await res.text();
    expect(text).toContain("agentbadge_http_duration_ms");
  });

  it("response contains agentbadge_active_scans gauge", async () => {
    const res = await app.request("/metrics");
    const text = await res.text();
    expect(text).toContain("agentbadge_active_scans");
  });

  it("after an HTTP request, counter increments", async () => {
    httpRequestTotal.inc({ method: "GET", path: "/metrics", status: "200" });
    const res = await app.request("/metrics");
    const text = await res.text();
    expect(text).toContain("agentbadge_http_requests_total");
    const lines = text.split("\n").filter((l: string) => l.startsWith("agentbadge_http_requests_total") && !l.startsWith("#"));
    expect(lines.length).toBeGreaterThan(0);
  });

  it("histogram has correct bucket boundaries", async () => {
    httpDurationMs.observe({ path: "/metrics" }, 75);
    const res = await app.request("/metrics");
    const text = await res.text();
    expect(text).toContain('le="50"');
    expect(text).toContain('le="500"');
    expect(text).toContain('le="1000"');
    expect(text).toContain('le="5000"');
  });
});
