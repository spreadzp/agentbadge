import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-58-3/58-4/58-8/58-9: Scanner Page UI Integration", () => {
  it("GET /services/scanner has snake-border class", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("snake-border");
  });

  it("GET /services/scanner does NOT have pulse-glow on scanner button", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("snake-border");
    // The scanner CTA should use snake-border, not pulse-glow
    const ctaSection = html.substring(html.indexOf("scanner-cta-btn"));
    expect(ctaSection).not.toContain("pulse-glow");
  });

  it("GET /services/scanner has hidden scan form", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("scan-form-wrapper");
    expect(html).toContain("hidden");
    expect(html).toContain("total-scan-url");
  });

  it("GET /services/scanner has SSE client JS", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("total-scan-form");
    expect(html).toContain("fetch('/api/total-scan'");
    expect(html).toContain("renderReport");
  });

  it("GET /services/scanner has progress bar with indigo and emerald", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("bg-indigo-500");
    expect(html).toContain("bg-emerald-500");
    expect(html).toContain("transition-all duration-300");
  });

  it("GET /services/scanner has cancel button", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("Cancel");
  });

  it("GET /services/passports does NOT have scanner form", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).not.toContain("total-scan-form");
    expect(html).not.toContain("scanner-cta-btn");
  });
});
