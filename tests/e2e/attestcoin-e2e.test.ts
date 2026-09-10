import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("E2E: Attestcoin demo page + API (SLICE-127-19)", () => {
  it("GET /hackathon/attestcoin returns 200 with full page", async () => {
    const res = await fetch(`${BASE}/hackathon/attestcoin`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Cross-Chain Verified");
    expect(html).toContain("Architecture");
    expect(html).toContain("Live Task List");
    expect(html).toContain("Block Explorer Links");
    expect(html).toContain("Worker Status");
    expect(html).toContain("attestcoin-tasks-body");
    expect(html).toContain("setInterval(loadTasks, 5000)");
  });

  it("GET /hackathon/attestcoin page contains API endpoint links", async () => {
    const res = await fetch(`${BASE}/hackathon/attestcoin`);
    const html = await res.text();
    expect(html).toContain("/api/attestcoin/tasks");
    expect(html).toContain("/api/attestcoin/status");
  });

  it("GET /hackathon/attestcoin page contains explorer links", async () => {
    const res = await fetch(`${BASE}/hackathon/attestcoin`);
    const html = await res.text();
    expect(html).toContain("sepolia.etherscan.io");
    expect(html).toContain("creditcoin.blockscout.com");
  });

  it("GET /hackathon/webmcp still works (no regression)", async () => {
    const res = await fetch(`${BASE}/hackathon/webmcp`);
    expect(res.status).toBe(200);
  });

  it("GET /hackathon/datahub still works (no regression)", async () => {
    const res = await fetch(`${BASE}/hackathon/datahub`);
    expect(res.status).toBe(200);
  });

  it("GET /hackathon/unknown returns 404", async () => {
    const res = await fetch(`${BASE}/hackathon/unknown`);
    expect(res.status).toBe(404);
  });

  it("sitemap includes /hackathon/attestcoin", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/hackathon/attestcoin");
  });
});
