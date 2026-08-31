import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock the MCP server module
vi.mock("@agentbadge/mcp", async () => {
  const actual: Record<string, unknown> = await vi.importActual("@agentbadge/mcp");
  return {
    ...actual,
    registerDiscoveryTools: vi.fn(),
    getAgentCardHandler: vi.fn(),
    searchAgentsHandler: vi.fn(),
    getServerInfoHandler: vi.fn(),
    getAiSitemapHandler: vi.fn(),
  };
});

import {
  registerDiscoveryTools,
  getAgentCardHandler,
  searchAgentsHandler,
  getServerInfoHandler,
  getAiSitemapHandler,
} from "@agentbadge/mcp";

describe("MCP Discovery Tools (SLICE-17-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registerDiscoveryTools is exported and callable", () => {
    expect(typeof registerDiscoveryTools).toBe("function");
    registerDiscoveryTools();
    expect(registerDiscoveryTools).toHaveBeenCalled();
  });

  it("getAgentCardHandler is exported", () => {
    expect(typeof getAgentCardHandler).toBe("function");
  });

  it("searchAgentsHandler is exported", () => {
    expect(typeof searchAgentsHandler).toBe("function");
  });

  it("getServerInfoHandler is exported", () => {
    expect(typeof getServerInfoHandler).toBe("function");
  });

  it("getAiSitemapHandler is exported", () => {
    expect(typeof getAiSitemapHandler).toBe("function");
  });
});
