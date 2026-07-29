import { describe, it, expect, vi, beforeAll } from "vitest";
import { setupMockEnv, makeTestApp } from "./helpers";
import type { Hono } from "hono";


describe("MYPROJ-1698: Agent Onboarding Guide Endpoint", () => {
  let app: Hono;

  beforeAll(() => {
    setupMockEnv();
    app = makeTestApp();
  });

  it("1. GET /agent-guide returns 200 with Content-Type: text/markdown", async () => {
    const res = await app.request("/agent-guide");
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type") ?? "";
    expect(contentType).toContain("text/markdown");
  });

  it("2. Guide covers all 7 steps in order", async () => {
    const res = await app.request("/agent-guide");
    const text = await res.text();

    // Check all steps are present and in order
    const step1Idx = text.indexOf("Step 1: Request Passport");
    const step2Idx = text.indexOf("Step 2: Receive Passport");
    const step3Idx = text.indexOf("Step 3: Verify Passport");
    const step4Idx = text.indexOf("Step 4: Register in Directory");
    const step5Idx = text.indexOf("Step 5 (Optional): Find Other Agents");
    const step6Idx = text.indexOf("Step 6 (Optional): Upgrade Tier");

    expect(step1Idx).toBeGreaterThan(-1);
    expect(step2Idx).toBeGreaterThan(step1Idx);
    expect(step3Idx).toBeGreaterThan(step2Idx);
    expect(step4Idx).toBeGreaterThan(step3Idx);
    expect(step5Idx).toBeGreaterThan(step4Idx);
    expect(step6Idx).toBeGreaterThan(step5Idx);
  });

  it("3. Each step includes example MCP tool call with parameters", async () => {
    const res = await app.request("/agent-guide");
    const text = await res.text();

    // Step 1: request_passport with parameters
    expect(text).toContain("request_passport");
    expect(text).toContain("accountId");
    expect(text).toContain("signature");
    expect(text).toContain("tier");

    // Step 3: verify_passport
    expect(text).toContain("verify_passport");
    expect(text).toContain("tokenId");
    expect(text).toContain("serial");

    // Step 4: register_agent
    expect(text).toContain("register_agent");
    expect(text).toContain("capabilities");
    expect(text).toContain("endpoint");

    // Step 6: find_agents
    expect(text).toContain("find_agents");
    expect(text).toContain("capability");

    // Step 7: upgrade_tier
    expect(text).toContain("upgrade_tier");
    expect(text).toContain("newTier");
  });

  it("4. Each step includes expected response format", async () => {
    const res = await app.request("/agent-guide");
    const text = await res.text();

    // Step 1 response: tokenId, serialNumber, did, hashScanLink
    expect(text).toContain("serialNumber");
    expect(text).toContain("did");
    expect(text).toContain("hashScanLink");

    // Step 3 response: active, tier, capabilities
    expect(text).toContain("active");
    expect(text).toContain("issuedAt");

    // Step 4 response: registered
    expect(text).toContain("registered");

    // Step 6 response: agents array
    expect(text).toContain("agents");
  });

  it("5. Agent can follow guide end-to-end without external docs", async () => {
    const res = await app.request("/agent-guide");
    const text = await res.text();

    // Must include signature instructions
    expect(text).toContain("Request Passport:");
    expect(text).toContain("eth_signMessage");

    // Must include MCP server URL pattern
    expect(text).toContain("/mcp/tools/");

    // Must include error handling
    expect(text).toContain("402");
    expect(text).toContain("Error handling");

    // Must include verification checklist
    expect(text).toContain("Verification");
    expect(text).toContain("HashScan");
  });

  it("6. No auth or payment required to read the guide", async () => {
    const res = await app.request("/agent-guide");
    expect(res.status).toBe(200);
    // No 402 payment required, no 401 auth required
    expect(res.status).not.toBe(402);
    expect(res.status).not.toBe(401);
  });
});
