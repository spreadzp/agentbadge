import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe('meta name="robots" for AI Overviews (SLICE-53-6)', () => {
  it("homepage has meta robots with AI directives", async () => {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    expect(html).toMatch(/meta name=["']robots["']/i);
    expect(html).toContain("max-image-preview:large");
    expect(html).toContain("max-snippet:-1");
    expect(html).toContain("max-video-preview:-1");
  });

  it("about page has meta robots", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toMatch(/meta name=["']robots["']/i);
    expect(html).toContain("max-image-preview:large");
  });

  it("faq page has meta robots", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toMatch(/meta name=["']robots["']/i);
  });

  it("agent-guide has meta robots", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/meta name=["']robots["']/i);
    expect(html).toContain("max-image-preview:large");
  });

  it("services/scanner has meta robots", async () => {
    const res = await fetch(`${BASE}/services/scanner`);
    const html = await res.text();
    expect(html).toMatch(/meta name=["']robots["']/i);
  });

  it("blog article has meta robots", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/meta name=["']robots["']/i);
    expect(html).toContain("max-image-preview:large");
  });
});
