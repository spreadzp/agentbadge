import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("SLICE-58-3: Snake border animation on scanner page", () => {
  it("scanner page has snake-border class on CTA button", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("snake-border");
  });

  it("scanner page does not use pulse-glow on CTA button", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    // pulse-glow may still exist in CSS but not on the scanner CTA
    const ctaMatch = html.match(/<[^>]*class="[^"]*snake-border[^"]*"[^>]*>/);
    expect(ctaMatch).not.toBeNull();
    // The CTA should not have pulse-glow class
    const ctaHtml = ctaMatch![0];
    expect(ctaHtml).not.toContain("pulse-glow");
  });

  it("scanner CTA is a button element (not anchor)", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    const ctaMatch = html.match(/<button[^>]*class="[^"]*snake-border[^"]*"[^>]*>/);
    expect(ctaMatch).not.toBeNull();
  });

  it("layout includes snake-crawl keyframes", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("snake-crawl");
    expect(html).toContain("@property --angle");
  });
});
