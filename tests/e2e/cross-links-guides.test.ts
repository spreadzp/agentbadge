import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Cross-links between guide pages (SLICE-53-3)", () => {
  it("agent-guide (HTML) has See Also section", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/see also|related guides|more guides/i);
  });

  it("agent-guide (HTML) links to services", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("/services/");
  });

  it("agent-guide (HTML) links to other guides", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/market-guide|medical-guide|marketplace-guide/i);
  });

  it("market-guide (HTML) has See Also section", async () => {
    const res = await fetch(`${BASE}/market-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/see also|related guides|more guides/i);
  });

  it("market-guide links to agent-guide", async () => {
    const res = await fetch(`${BASE}/market-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("/agent-guide");
  });

  it("service pages link to agent-guide", async () => {
    const res = await fetch(`${BASE}/services/scanner`);
    const html = await res.text();
    expect(html).toContain("/agent-guide");
  });

  it("blog articles link to guide pages", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("/agent-guide");
  });

  it("blog articles have Further Reading section", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/further reading|see also|related/i);
  });
});
