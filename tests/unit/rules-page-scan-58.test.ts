import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { scanRuleRoutes } from "../../src/server/routes/scan-rule-api";

const app = new Hono();
app.route("/api", scanRuleRoutes);

describe("SLICE-58-1/58-2: Scan Rule API Integration", () => {
  it("response includes summary and completeness_pct", async () => {
    const res = await app.request("/api/scan-rule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", rule_id: "AB-001" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeDefined();
    expect(typeof data.summary).toBe("string");
    expect(data.completeness_pct).toBeDefined();
    expect(typeof data.completeness_pct).toBe("number");
  });

  it("response does NOT include evidence field", async () => {
    const res = await app.request("/api/scan-rule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", rule_id: "AB-001" }),
    });
    const data = await res.json();
    expect(data.evidence).toBeUndefined();
  });

  it("response includes checks_performed count", async () => {
    const res = await app.request("/api/scan-rule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", rule_id: "AB-001" }),
    });
    const data = await res.json();
    expect(data.checks_performed).toBeDefined();
    expect(typeof data.checks_performed).toBe("number");
  });

  it("response includes status field", async () => {
    const res = await app.request("/api/scan-rule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", rule_id: "AB-001" }),
    });
    const data = await res.json();
    expect(data.status).toBeDefined();
    expect(["VERIFIED", "INFERRED", "GAP", "NOT_APPLICABLE", "CONFLICT", "SKIPPED"]).toContain(data.status);
  });
});
