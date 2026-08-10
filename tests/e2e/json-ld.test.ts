import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../../src/server/routes/content-pages";
import { servicesRoutes } from "../../src/server/routes/services";
import { landingRoutes } from "../../src/server/routes/landing";

const app = new Hono();
app.route("/", landingRoutes);
app.route("/", contentPageRoutes);
app.route("/", servicesRoutes);

describe("JSON-LD structured data (SLICE-51-9)", () => {
  it("homepage has Organization", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('"@type":"Organization"');
  });

  it("/services/scanner has Service", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain('"@type":"Service"');
  });

  it("/services/passports has Service", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toContain('"@type":"Service"');
  });

  it("/services/marketplace has Service", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toContain('"@type":"Service"');
  });

  it("/faq has FAQPage", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('"@type":"FAQPage"');
  });

  it("/about has Person", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toContain('"@type":"Person"');
  });
});
