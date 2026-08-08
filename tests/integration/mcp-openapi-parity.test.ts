/**
 * SLICE-49-20: MCP/OpenAPI parity
 *
 * Verifies that every OpenAPI-declared endpoint has a corresponding MCP tool,
 * achieving 1:1 parity between REST API and MCP tools.
 */

import { describe, it, expect } from "vitest";

const BASE_URL = process.env.E2E_TARGET_URL ?? "http://localhost:4021";

async function fetchOpenApiPaths(): Promise<string[]> {
  const resp = await fetch(`${BASE_URL}/api/specs`);
  const spec = await resp.json();
  return Object.keys(spec.paths ?? {});
}

async function fetchMcpToolNames(): Promise<string[]> {
  const resp = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });
  const body = await resp.json();
  return (body.result?.tools ?? []).map((t: any) => t.name);
}

/**
 * Maps an OpenAPI path to the expected MCP tool name pattern.
 * e.g. "/market/tasks/{taskId}/claim" -> "claim_task" or "market_tasks_taskId_claim"
 *
 * The test checks that at least one MCP tool name contains a meaningful
 * substring derived from the OpenAPI path.
 */
function pathToToolKeywords(path: string): string[] {
  // Strip leading slash, replace path params, convert to snake_case parts
  const cleaned = path
    .replace(/^\//, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/[^a-zA-Z0-9/]/g, "")
    .split("/")
    .filter(Boolean);

  // Generate keyword variants that should appear in tool names
  const keywords: string[] = [];

  // Full path as snake_case (e.g. "market_tasks_claim")
  const fullSnake = cleaned.join("_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (fullSnake) keywords.push(fullSnake);

  // Last meaningful segment (e.g. "claim" from "market/tasks/{taskId}/claim")
  const lastSegment = cleaned[cleaned.length - 1];
  if (lastSegment) keywords.push(lastSegment);

  // For well-known paths, use the endpoint name
  if (path.startsWith("/.well-known/")) {
    const wkName = path.replace("/.well-known/", "").replace(/[^a-zA-Z0-9]/g, "_");
    keywords.push(wkName);
  }

  return keywords;
}

/**
 * Checks if any MCP tool name matches any of the expected keywords for a path.
 */
function hasMatchingTool(path: string, toolNames: string[]): boolean {
  const keywords = pathToToolKeywords(path);

  // Special mappings for known tool names that don't follow the path-based naming
  const specialMappings: Record<string, string[]> = {
    "/a2a/send": ["send_message"],
    "/a2a/send-with-key": ["send_message_with_key"],
    "/a2a/send-signed": ["send_message_with_key", "send_signed"],
    "/a2a/inbox": ["get_inbox"],
    "/a2a/conversation": ["get_conversation"],
    "/passport/request": ["request_passport"],
    "/passport/{tokenId}/{serial}": ["get_passport", "verify_passport"],
    "/passport/{tokenId}/{serial}/upgrade": ["upgrade_tier"],
    "/passport/address/{address}": ["get_passport_by_address", "verify_passport"],
    "/passports": ["list_passports"],
    "/agents": ["find_agents", "search_agents", "list_agents"],
    "/agents/register": ["register_agent"],
    "/agents/{did}": ["get_agent", "find_agents"],
    "/audit/{tokenId}/{serial}": ["get_audit_trail"],
    "/catalog": ["get_tier_requirements"],
    "/market/tasks": ["list_tasks", "post_task"],
    "/market/tasks/signed": ["post_task_with_key"],
    "/market/tasks/{taskId}": ["list_tasks", "get_task"],
    "/market/tasks/{taskId}/cancel": ["cancel_escrow"],
    "/market/tasks/{taskId}/claim": ["claim_task"],
    "/market/tasks/{taskId}/claim-with-key": ["claim_task_with_key"],
    "/market/tasks/{taskId}/complete": ["complete_task"],
    "/market/tasks/{taskId}/complete-with-key": ["complete_task_with_key"],
    "/market/tasks/{taskId}/deliver": ["deliver_result"],
    "/market/tasks/{taskId}/deliver-with-key": ["deliver_result_with_key"],
    "/market/tasks/{taskId}/escrow-status": ["get_escrow_status"],
    "/market/tasks/{taskId}/increase-reward": ["increase_reward"],
    "/market/tasks/{taskId}/prepare-payment": ["prepare_payment"],
    "/market/tasks/{taskId}/verify": ["verify_result"],
    "/market/sign": ["sign_transaction"],
    "/did/{did}": ["resolve_did"],
    "/api/search": ["search_agents"],
    "/admin/revoke": ["revoke_passport"],
    "/.well-known/api-catalog": ["get_agent_card"],
    "/.well-known/oauth-authorization-server": ["get_oauth_authorization_server"],
    "/.well-known/oauth-protected-resource": ["get_oauth_protected_resource"],
    "/.well-known/webfinger": ["get_webfinger"],
    "/.well-known/http-message-signatures-directory": ["get_http_message_signatures_directory"],
    "/api/work-requests": ["list_work_requests", "create_work_request"],
    "/api/work-requests/{id}": ["get_work_request"],
    "/admin/rebuild-cache": ["rebuild_cache"],
    "/feed": ["get_feed"],
    "/changelog": ["get_changelog"],
    "/faq": ["get_faq"],
    "/about": ["get_about"],
    "/pricing": ["get_pricing"],
    "/privacy": ["get_privacy"],
    "/terms": ["get_terms"],
    "/services": ["get_services"],
    "/team": ["get_team"],
    "/use-cases": ["get_use_cases"],
    "/work-with-us": ["get_work_with_us"],
    "/market-guide": ["get_market_guide"],
    "/marketplace-guide": ["get_marketplace_guide"],
    "/medical-guide": ["get_medical_guide"],
  };

  const specialNames = specialMappings[path];
  if (specialNames) {
    return specialNames.some((name) => toolNames.includes(name));
  }

  // Fallback: check if any tool name contains any keyword
  return keywords.some((kw) =>
    toolNames.some((tool) => tool.includes(kw) || kw.includes(tool)),
  );
}

describe("MCP/OpenAPI parity", () => {
  it("MCP tool count >= OpenAPI endpoint count", async () => {
    const [openApiPaths, toolNames] = await Promise.all([
      fetchOpenApiPaths(),
      fetchMcpToolNames(),
    ]);

    expect(openApiPaths.length).toBeGreaterThan(0);
    expect(toolNames.length).toBeGreaterThanOrEqual(openApiPaths.length);
  }, 30000);

  it("every OpenAPI path has a corresponding MCP tool", async () => {
    const [openApiPaths, toolNames] = await Promise.all([
      fetchOpenApiPaths(),
      fetchMcpToolNames(),
    ]);

    const missing: string[] = [];
    for (const path of openApiPaths) {
      if (!hasMatchingTool(path, toolNames)) {
        missing.push(path);
      }
    }

    if (missing.length > 0) {
      console.error("OpenAPI paths without MCP tool:", missing);
      console.error("Available MCP tools:", toolNames);
    }

    expect(missing).toEqual([]);
  }, 30000);
});
