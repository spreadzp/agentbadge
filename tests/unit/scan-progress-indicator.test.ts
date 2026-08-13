import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-58-9: Scan progress indicator", () => {
  it("scanner page has indigo progress bar for fetching phase", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("bg-indigo-500");
    expect(html).toContain("Fetching resources");
  });

  it("scanner page has emerald progress bar for evaluating phase", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("bg-emerald-500");
    expect(html).toContain("Evaluating rules");
  });

  it("progress bar has transition-all duration-300", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("transition-all duration-300");
  });

  it("progress bar shows percentage text", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("pct + '%");
  });

  it("progress bar shows resource name during fetching", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("data.resource");
  });

  it("progress bar has rounded-full bg-slate-800 track", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("rounded-full bg-slate-800");
  });
});
