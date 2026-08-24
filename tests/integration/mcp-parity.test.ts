/**
 * SLICE-78-3: MCP/REST parity integration test.
 *
 * Verifies that MCP tools registered in the server cover the key OpenAPI
 * endpoints. Uses in-process tool list (no running server needed).
 */

import { describe, it, expect } from "vitest";
import { getMcpToolNames, getMcpTools } from "../helpers/mcp";

/**
 * Critical REST endpoints that MUST have MCP tool wrappers.
 * Derived from parity-tools.ts registrations and OpenAPI spec paths.
 */
const REQUIRED_PARITY_TOOLS = [
  "check_compliance",
  "list_work_requests",
  "get_work_request",
  "create_work_request",
  "resolve_did",
  "get_oauth_authorization_server",
  "get_oauth_protected_resource",
  "get_webfinger",
  "get_http_message_signatures_directory",
  "rebuild_cache",
  "get_services_info",
  "contact_us",
];

/**
 * Content page tools that should be exposed as MCP tools.
 */
const CONTENT_PAGE_TOOLS = [
  "get_feed",
  "get_changelog",
  "get_faq",
  "get_about",
  "get_pricing",
  "get_services",
  "get_team",
  "get_use_cases",
];

describe("SLICE-78-3: MCP/REST parity", () => {
  it("MCP tools list is non-empty", () => {
    const tools = getMcpToolNames();
    expect(tools.length).toBeGreaterThan(20);
  });

  it("all required parity tools are registered", () => {
    const tools = getMcpToolNames();
    const missing = REQUIRED_PARITY_TOOLS.filter((t) => !tools.includes(t));
    expect(missing).toEqual([]);
  });

  it("all content page tools are registered", () => {
    const tools = getMcpToolNames();
    const missing = CONTENT_PAGE_TOOLS.filter((t) => !tools.includes(t));
    expect(missing).toEqual([]);
  });

  it("check_compliance tool is registered (AB-103 requirement)", () => {
    const tools = getMcpToolNames();
    expect(tools).toContain("check_compliance");
  });

  it("every parity tool has a description", () => {
    const tools = getMcpTools();
    const parityTools = tools.filter((t) => REQUIRED_PARITY_TOOLS.includes(t.name));
    for (const tool of parityTools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("check_compliance tool has url parameter in schema", () => {
    const tools = getMcpTools();
    const compliance = tools.find((t) => t.name === "check_compliance");
    expect(compliance).toBeDefined();
    expect(compliance?.inputSchema).toBeDefined();
    const schema = compliance?.inputSchema as Record<string, unknown>;
    const properties = schema?.properties as Record<string, unknown> | undefined;
    expect(properties).toBeDefined();
    expect(properties?.url).toBeDefined();
  });

  it("MCP tool count meets 50% parity threshold (AB-102)", () => {
    const tools = getMcpToolNames();
    // The server exposes ~40+ OpenAPI paths. AB-102 requires MCP tools >= 50% of endpoints.
    // With parity tools + core MCP tools (passport, market, a2a, etc.), we should have 40+ tools.
    expect(tools.length).toBeGreaterThanOrEqual(30);
  });
});
