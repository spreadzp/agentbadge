import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("SLICE-119-1: AgentReadyProofSection on homepage", () => {
  let html: string;

  it("GET / returns 200", async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    html = await res.text();
  });

  it("contains id='agent-ready-proof' section", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('id="agent-ready-proof"');
  });

  it("contains headline 'We don't just measure Agent Readiness'", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain("We don't just measure Agent Readiness");
  });

  it("contains 6 evidence card links", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    const section = html.match(/id="agent-ready-proof"[\s\S]*?<\/section>/)?.[0] ?? "";
    const cardLinks = section.match(/<a href="[^"]*" class="group block rounded-xl/g) ?? [];
    expect(cardLinks.length).toBe(6);
  });

  it("contains card link to /robots.txt", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('href="/robots.txt"');
  });

  it("contains card link to /llms.txt", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('href="/llms.txt"');
  });

  it("contains card link to /openapi.json", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('href="/openapi.json"');
  });

  it("contains card link to /hackathon/webmcp", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('href="/hackathon/webmcp"');
  });

  it("contains card link to /agent-guide/", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('href="/agent-guide/"');
  });

  it("contains card link to /agent-guide/knowledge-map.json", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain('href="/agent-guide/knowledge-map.json"');
  });

  it("contains CTA button linking to /hackathon/webmcp", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain("See the agent architecture");
    expect(html).toContain('href="/hackathon/webmcp"');
  });

  it("contains status badges (200 OK, 6 tools, Live)", async () => {
    if (!html) html = await (await fetch(`${BASE}/`)).text();
    expect(html).toContain("200 OK");
    expect(html).toContain("6 tools");
    expect(html).toContain("Live");
  });

  // Verify linked endpoints are live
  describe("Linked endpoints return 200", () => {
    const endpoints = [
      "/robots.txt",
      "/llms.txt",
      "/openapi.json",
      "/hackathon/webmcp",
      "/agent-guide/",
      "/agent-guide/knowledge-map.json",
    ];

    for (const endpoint of endpoints) {
      it(`GET ${endpoint} returns 200`, async () => {
        const res = await fetch(`${BASE}${endpoint}`);
        expect(res.status).toBe(200);
      });
    }
  });
});
