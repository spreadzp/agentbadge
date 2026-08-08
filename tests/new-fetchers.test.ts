import { describe, it, expect } from "vitest";
import { DEFAULT_RESOURCES } from "../src/agent-readiness/scanner/orchestrator";
import { fetchContentNegotiation } from "../src/agent-readiness/scanner/fetchers/content-negotiation-fetcher";
import { fetchX402Discovery } from "../src/agent-readiness/scanner/fetchers/x402-fetcher";
import { fetchOpenApiStandard } from "../src/agent-readiness/scanner/fetchers/openapi-standard-fetcher";
import { fetchSkillFile } from "../src/agent-readiness/scanner/fetchers/skill-file-fetcher";
import { fetchAgentsTxt } from "../src/agent-readiness/scanner/fetchers/agents-txt-fetcher";
import { fetchWebMcp } from "../src/agent-readiness/scanner/fetchers/webmcp-fetcher";
import { fetchLlmsFull } from "../src/agent-readiness/scanner/fetchers/llms-full-fetcher";
import { fetchRssFeed } from "../src/agent-readiness/scanner/fetchers/rss-feed-fetcher";

describe("New fetchers — DEFAULT_RESOURCES includes new keys", () => {
  it("includes content_negotiation in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("content_negotiation");
  });

  it("includes x402 in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("x402");
  });

  it("includes openapi_standard in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("openapi_standard");
  });

  it("includes skill in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("skill");
  });

  it("includes agents_txt in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("agents_txt");
  });

  it("includes webmcp in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("webmcp");
  });

  it("includes llms_full in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("llms_full");
  });

  it("includes rss_feed in DEFAULT_RESOURCES", () => {
    expect(DEFAULT_RESOURCES).toContain("rss_feed");
  });
});

describe("New fetchers — graceful error handling", () => {
  const bogusUrl = "http://localhost:99999";

  it("contentNegotiation fetcher returns null body on error", async () => {
    const r = await fetchContentNegotiation(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("x402 fetcher returns null body on error", async () => {
    const r = await fetchX402Discovery(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("openapi standard fetcher returns null body on error", async () => {
    const r = await fetchOpenApiStandard(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("skill file fetcher returns null body on error", async () => {
    const r = await fetchSkillFile(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("agents.txt fetcher returns null body on error", async () => {
    const r = await fetchAgentsTxt(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("webmcp fetcher returns null body on error", async () => {
    const r = await fetchWebMcp(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("llms-full fetcher returns null body on error", async () => {
    const r = await fetchLlmsFull(bogusUrl);
    expect(r.body).toBeNull();
  });

  it("rss feed fetcher returns null body on error", async () => {
    const r = await fetchRssFeed(bogusUrl);
    expect(r.body).toBeNull();
  });
});
