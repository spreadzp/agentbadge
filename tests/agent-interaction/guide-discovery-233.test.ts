import { describe, expect, it } from "vitest";

import {
  buildLlmsTxt,
  type DiscoverySources,
} from "../../src/server/lib/agent-discovery";
import { buildAgentCard } from "../../src/server/lib/agent-discovery/agent-card";
import { generateAgentGuide } from "../../src/server/lib/agent-guide/generator";
import {
  AGENT_INTERACTION_MANIFEST_PATH,
  AGENT_INTERACTION_MCP_PATH,
  AGENT_INTERACTION_TOOLS,
} from "../../src/server/lib/agent-interaction/registry";
import { agentKnowledgeRoutes } from "../../src/server/routes/knowledge/agent-knowledge";
import { discoveryRoutes } from "../../src/server/routes/well-known/discovery";
import { agentInteractionDescriptorRoutes } from "../../src/server/routes/well-known/agent-interaction-descriptor";

/**
 * EPIC-233 (SLICE-233-7): every existing discovery surface points agents
 * at the new protocol — guide section, llms.txt, agent-card, aauth scope
 * — while the manifest stays the single canonical spec (no duplication).
 */

const mkSources = (): DiscoverySources => ({
  baseUrl: "https://agentbadge.xyz",
  authSection: "## DID Signature Authentication\n\n...\n",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
  skus: [],
});

describe("/agent-guide advertises the Agent Interaction Protocol", () => {
  it("markdown section rendered from the registry (serve-time inject)", async () => {
    const res = await agentKnowledgeRoutes.request("/agent-guide", {
      headers: { Accept: "text/markdown" },
    });
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("## Agent Interaction Protocol");
    expect(md).toContain(AGENT_INTERACTION_MCP_PATH);
    expect(md).toContain(AGENT_INTERACTION_MANIFEST_PATH);
    expect(md).toContain("tools/list");
    // placeholder must be fully replaced — not left in output
    expect(md).not.toContain("rendered at serve time");
    // every registered tool appears with its live status — no drift
    for (const t of AGENT_INTERACTION_TOOLS) {
      expect(md).toContain(`\`${t.name}\``);
      expect(md).toContain(`| ${t.status} |`);
    }
    // webhook contract is documented (233-4 shipped it)
    expect(md).toContain("callback_url");
    expect(md).toContain("X-AgentBadge-Signature");
  });

  it("well-known + plain JSON carry the agent_interaction block", async () => {
    for (const path of ["/.well-known/agent-guide.json", "/agent-guide.json"]) {
      const res = await agentKnowledgeRoutes.request(path);
      expect(res.status).toBe(200);
      const body = await res.json();
      const ai = body.agent_interaction;
      expect(ai.mcp_endpoint).toContain(AGENT_INTERACTION_MCP_PATH);
      expect(ai.manifest).toContain(AGENT_INTERACTION_MANIFEST_PATH);
      expect(ai.tools).toHaveLength(AGENT_INTERACTION_TOOLS.length);
      expect(ai.tools.map((t: { name: string }) => t.name)).toEqual(
        AGENT_INTERACTION_TOOLS.map((t) => t.name),
      );
      expect(body.endpoints.agent_interaction_mcp).toBe(AGENT_INTERACTION_MCP_PATH);
      expect(body.endpoints.agent_interaction_manifest).toBe(
        AGENT_INTERACTION_MANIFEST_PATH,
      );
    }
  });
});

describe("marketplace-guide generator carries the same section", () => {
  it("contains endpoints + JSON-RPC examples + tool table", () => {
    const md = generateAgentGuide();
    expect(md).toContain("## Agent Interaction Protocol");
    expect(md).toContain(AGENT_INTERACTION_MCP_PATH);
    expect(md).toContain(AGENT_INTERACTION_MANIFEST_PATH);
    expect(md).toContain('"method":"tools/list"');
    expect(md).toContain("agentbadge_create_task_request");
  });
});

describe("llms.txt references namespace + manifest", () => {
  it("section with endpoint, manifest link, registry tool roster", () => {
    const txt = buildLlmsTxt(mkSources());
    expect(txt).toContain("## Agent Interaction Protocol");
    expect(txt).toContain(AGENT_INTERACTION_MCP_PATH);
    expect(txt).toContain(AGENT_INTERACTION_MANIFEST_PATH);
    for (const t of AGENT_INTERACTION_TOOLS) {
      expect(txt).toContain(`\`${t.name}\``);
    }
  });
});

describe("agent-card.json advertises the protocol", () => {
  it("capability + endpoints + skill entry (additive only)", () => {
    const card = buildAgentCard(mkSources());
    const parsed = JSON.parse(card);
    expect(parsed["x-agentbadge"].capabilities).toContain("agent_interaction");
    const eps = parsed["x-agentbadge"].endpoints;
    expect(eps.mcp_agent_interaction).toContain(AGENT_INTERACTION_MCP_PATH);
    expect(eps.agent_interaction_manifest).toContain(
      AGENT_INTERACTION_MANIFEST_PATH,
    );
    const skillIds = parsed.skills.map((s: { id: string }) => s.id);
    expect(skillIds).toContain("agent-interaction");
    // pre-233 surfaces untouched
    expect(eps.mcp).toBe("https://agentbadge.xyz/mcp");
    expect(parsed.capabilities.extendedAgentCard).toBe(true);
  });
});

describe("aauth.json scope pointer", () => {
  it("agent-interaction:call scope listed alongside existing scopes", async () => {
    const res = await discoveryRoutes.request("/.well-known/aauth.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    const scopes = body.scope_descriptions.map(
      (s: { scope: string }) => s.scope,
    );
    expect(scopes).toContain("agent-interaction:call");
    expect(scopes).toContain("requests:write");
  });
});

describe("canonical-source invariant", () => {
  it("manifest webhooks.status reflects shipped delivery", async () => {
    const res = await agentInteractionDescriptorRoutes.request(
      "/.well-known/agent-interaction.json",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks.status).toBe("live");
    expect(body.tools).toHaveLength(AGENT_INTERACTION_TOOLS.length);
  });
});
