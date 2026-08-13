import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-58-4: URL input form reveal on scanner page", () => {
  it("scanner page has hidden scan-form-wrapper", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("scan-form-wrapper");
    expect(html).toContain("hidden");
  });

  it("scanner page has URL input with type=url and required", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain('type="url"');
    expect(html).toContain('id="total-scan-url"');
    expect(html).toContain("required");
  });

  it("scanner page has Start Full Scan submit button", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("Start Full Scan");
    expect(html).toContain('id="total-scan-submit"');
  });

  it("scanner page has Cancel button to hide form", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("Cancel");
  });

  it("scanner CTA button has onclick to reveal form", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("scanner-cta-btn");
    expect(html).toContain("scan-form-wrapper");
    // onclick should toggle hidden class
    expect(html).toMatch(/scanner-cta-btn.*scan-form-wrapper|scan-form-wrapper.*scanner-cta-btn/);
  });

  it("passport page still uses anchor link (not button)", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    // Should have an <a tag for CTA, not a <button id="scanner-cta-btn"
    expect(html).not.toContain("scanner-cta-btn");
    expect(html).not.toContain("scan-form-wrapper");
  });
});
