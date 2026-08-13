import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-58-8: Total scan results display", () => {
  it("scanner page has SSE client JS for total-scan", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("total-scan-form");
    expect(html).toContain("fetch('/api/total-scan'");
    expect(html).toContain("getReader");
  });

  it("scanner page has renderReport function", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("renderReport");
    expect(html).toContain("score");
    expect(html).toContain("grade");
    expect(html).toContain("categories");
    expect(html).toContain("top_missing");
  });

  it("scanner page has progress text updates", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("Fetching resources");
    expect(html).toContain("Evaluating rules");
  });

  it("scanner page has error handling", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("catch");
    expect(html).toContain("Error:");
  });

  it("scanner page re-enables submit button after scan", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("finally");
    expect(html).toContain("Start Full Scan");
  });

  it("passport page does not have total-scan JS", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).not.toContain("total-scan-form");
    expect(html).not.toContain("renderReport");
  });
});
