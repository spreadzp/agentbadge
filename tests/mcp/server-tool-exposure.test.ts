import { describe, it, expect, vi } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { createNamespace } from "@agentbadge/mcp";
import { registerParityTools } from "../../src/mcp/parity-tools";
import { registerBoardTools } from "../../src/mcp/board-tools";
import { registerAttestcoinTools } from "../../src/mcp/attestcoin-tools";
import { registerKnowledgeTools } from "../../src/mcp/knowledge-tools";
import { registerComplianceTools } from "../../src/mcp/compliance-tools";

const EXPECTED_ADMIN = new Set(["rebuild_cache"]);
const EXPECTED_AUTHENTICATED = new Set([
  "create_work_request",
  "verify_cross_chain_task",
]);

describe("server-side tool exposure classification (SLICE-259-2)", () => {
  const ns = createNamespace("srv-cls");
  registerParityTools(ns);
  registerBoardTools(ns);
  registerAttestcoinTools(ns);
  registerKnowledgeTools(ns);
  registerComplianceTools(ns);

  const listing = ns.listTools();
  const byName = new Map(listing.map((t) => [t.name, t.exposure]));

  it("every server-registered tool has an explicit exposure tier", () => {
    expect(listing.length).toBeGreaterThan(30);
    for (const t of listing) {
      expect(["public", "authenticated", "admin"]).toContain(t.exposure);
    }
  });

  it("admin ops tools are classified admin", () => {
    for (const name of EXPECTED_ADMIN) {
      expect(byName.get(name), `${name} must be admin`).toBe("admin");
    }
  });

  it("agent-write tools are classified authenticated", () => {
    for (const name of EXPECTED_AUTHENTICATED) {
      expect(byName.get(name), `${name} must be authenticated`).toBe(
        "authenticated",
      );
    }
  });

  it("read-only parity mirrors are public", () => {
    for (const name of [
      "resolve_did",
      "get_feed",
      "get_faq",
      "get_pricing",
      "list_work_requests",
      "get_agent_by_did",
      "get_services_info",
      "board_list",
      "board_get",
      "board_claim_status",
      "list_verified_tasks",
      "get_task_status",
      "search_knowledge",
      "get_knowledge_object",
      "check_compliance",
      "get_did_auth_info",
    ]) {
      expect(byName.get(name), `${name} must be public`).toBe("public");
    }
  });
});
