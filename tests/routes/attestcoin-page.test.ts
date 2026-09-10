process.env.MOCK_HEDERA = "true";
process.env.HEDERA_OPERATOR_ID = "0.0.1234567";
process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420test-key";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
process.env.AUDIT_TOPIC_ID = "0.0.1234568";
process.env.DIRECTORY_TOPIC_ID = "0.0.1234569";
process.env.x402_FACILITATOR_URL = "https://example.com";
process.env.x402_FEE_PAYER = "0.0.1234570";
process.env.x402_TREASURY = "0.0.1234571";
process.env.IPFS_API_KEY = "test-key";
process.env.IPFS_API_SECRET = "test-secret";

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { hackathonRoutes } from "../../src/server/routes/hackathon";

function makeApp() {
  const app = new Hono();
  app.route("/", hackathonRoutes);
  return app;
}

describe("Attestcoin hackathon page", () => {
  it("GET /hackathon/attestcoin returns 200", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/attestcoin");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Cross-Chain Verified");
    expect(html).toContain("Task Marketplace");
  });

  it("page contains architecture section", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/attestcoin");
    const html = await res.text();
    expect(html).toContain("Architecture");
    expect(html).toContain("Ethereum Sepolia");
    expect(html).toContain("Creditcoin");
    expect(html).toContain("Worker B");
  });

  it("page contains live task list section", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/attestcoin");
    const html = await res.text();
    expect(html).toContain("Live Task List");
    expect(html).toContain("attestcoin-tasks-body");
    expect(html).toContain("Auto-refresh");
  });

  it("page contains block explorer links", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/attestcoin");
    const html = await res.text();
    expect(html).toContain("Block Explorer Links");
    expect(html).toContain("sepolia.etherscan.io");
    expect(html).toContain("creditcoin.blockscout.com");
  });

  it("page contains worker status section", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/attestcoin");
    const html = await res.text();
    expect(html).toContain("Worker Status");
    expect(html).toContain("worker-a-status");
    expect(html).toContain("worker-b-status");
    expect(html).toContain("ai-agent-status");
  });

  it("page contains auto-refresh script", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/attestcoin");
    const html = await res.text();
    expect(html).toContain("setInterval(loadTasks, 5000)");
    expect(html).toContain("fetch('/api/attestcoin/tasks')");
    expect(html).toContain("fetch('/api/attestcoin/status')");
  });

  it("unknown hackathon name returns 404", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/nonexistent");
    expect(res.status).toBe(404);
  });

  it("existing webmcp hackathon still works", async () => {
    const app = makeApp();
    const res = await app.request("/hackathon/webmcp");
    expect(res.status).toBe(200);
  });
});
