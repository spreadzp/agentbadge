/**
 * SLICE-233-1: keyless agent-interaction MCP namespace —
 * POST /mcp/agent-interaction over the AGENT_INTERACTION_TOOLS
 * registry, plus the generated /.well-known/agent-interaction.json
 * capability manifest. Plain JSON-RPC, stateless; global agentKeyAuth
 * + mcpAbuseGuard coverage reproduced via local mounts.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { mcpAgentInteractionRoutes } from "../../src/server/routes/mcp-agent-interaction";
import { agentInteractionDescriptorRoutes } from "../../src/server/routes/well-known/agent-interaction-descriptor";
import {
  AGENT_INTERACTION_TOOLS,
  getAgentTool,
  type AgentToolContext,
  type AgentToolResult,
} from "../../src/server/lib/agent-interaction/registry";
import { buildAgentInteractionManifest } from "../../src/server/lib/agent-interaction/manifest";
import { mcpAbuseGuard } from "../../src/server/middleware/mcp-abuse-guard";
import {
  agentKeyAuth,
  initAgentKeyAuth,
} from "../../src/server/middleware/agent-key-auth";
import { createMemoryAgentRegistrationStore } from "../../src/server/lib/agent-registration/store";
import { issueApiKey } from "../../src/server/lib/agent-registration/api-keys";
import { getDatabase } from "../../src/server/lib/database";
import { pickRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import { registerQaSearchRoute } from "../../src/server/routes/agent-requests/agent-requests-qa-api";
import {
  normalizeQuestion,
  questionHashFor,
} from "../../src/server/lib/request-inbox/fingerprint";
import type { SubmitInput } from "../../src/server/lib/request-inbox/store";

const app = new Hono().route("/", mcpAgentInteractionRoutes);
const manifestApp = new Hono().route("/", agentInteractionDescriptorRoutes);

function rpc(
  method: string,
  params?: Record<string, unknown>,
  id: number | string = 1,
  headers: Record<string, string> = {},
) {
  return app.request("/mcp/agent-interaction", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

const ROSTER = [
  "agentbadge_discover",
  "agentbadge_ask",
  "agentbadge_get_request_status",
  "agentbadge_create_task_request",
  "agentbadge_search_knowledge",
  "agentbadge_submit_feedback",
  "agentbadge_request_review",
  "agentbadge_report_problem",
];

describe("POST /mcp/agent-interaction JSON-RPC", () => {
  it("tools/list → exactly the 8 agentbadge_* registry tools + JSON schemas", async () => {
    const res = await rpc("tools/list");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        tools: {
          name: string;
          description: string;
          inputSchema: { type?: string };
        }[];
      };
    };
    const tools = body.result.tools;
    expect(tools.map((t) => t.name)).toEqual(ROSTER);
    for (const t of tools) {
      expect(t.inputSchema?.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("initialize + ping + initialized notification", async () => {
    const init = await rpc("initialize");
    const initBody = (await init.json()) as {
      result: { serverInfo: { name: string }; protocolVersion: string };
    };
    expect(initBody.result.serverInfo.name).toBe(
      "agentbadge-agent-interaction",
    );
    expect(initBody.result.protocolVersion).toBe("2025-03-26");

    const ping = await rpc("ping");
    expect((await ping.json()) as { result: object }).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });

    const note = await app.request("/mcp/agent-interaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });
    expect(note.status).toBe(202);
  });

  it("whitelist: unknown tool → -32601; unknown method → -32601; batch → -32600", async () => {
    const badTool = await rpc("tools/call", {
      name: "post_task",
      arguments: {},
    });
    const badToolBody = (await badTool.json()) as {
      error?: { code: number; message: string };
    };
    expect(badToolBody.error?.code).toBe(-32601);
    expect(badToolBody.error?.message).toContain("post_task");

    const badMethod = await rpc("resources/list");
    expect(((await badMethod.json()) as { error?: { code: number } }).error?.code).toBe(
      -32601,
    );

    const batch = await app.request("/mcp/agent-interaction", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
    });
    expect(((await batch.json()) as { error?: { code: number } }).error?.code).toBe(
      -32600,
    );
  });

  it("unwired tools answer NOT_IMPLEMENTED stubs (wiring lands 233-3/5)", async () => {
    const res = await rpc("tools/call", {
      name: "agentbadge_submit_feedback",
      arguments: { subject: "s", message: "m" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        isError: boolean;
        structuredContent: { error: { code: string } };
      };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("NOT_IMPLEMENTED");
  });

  it("schema validation at dispatch: bad args → -32602", async () => {
    const res = await rpc("tools/call", {
      name: "agentbadge_get_request_status",
      arguments: { request_id: "!!!" },
    });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32602);
  });

  it("toolResult envelope: content text ≡ structuredContent JSON", async () => {
    const res = await rpc("tools/call", {
      name: "agentbadge_discover",
      arguments: {},
    });
    const body = (await res.json()) as {
      result: {
        isError: boolean;
        content: { type: string; text: string }[];
        structuredContent: { service: string; mcp_endpoint: string };
      };
    };
    expect(body.result.isError).toBe(false);
    expect(body.result.structuredContent.mcp_endpoint).toBe(
      "/mcp/agent-interaction",
    );
    expect(JSON.parse(body.result.content[0].text)).toEqual(
      body.result.structuredContent,
    );
  });

  it("Bearer agb_ → handler ctx carries verified agentId; anon → ANON", async () => {
    const store = createMemoryAgentRegistrationStore();
    initAgentKeyAuth({ store, ttlSec: 60 });
    const { key, keyHash } = issueApiKey();
    await store.put({
      agentId: "eip155:5042:0xregistry:7",
      registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      registryTx: "0xmint",
      name: "probe-agent",
      keyHash,
      tier: "observer",
      status: "active",
      createdAt: Date.now(),
    });

    const seen: AgentToolContext[] = [];
    const tool = getAgentTool("agentbadge_discover");
    const original = tool!.handler;
    const spy = async (_a: unknown, ctx: AgentToolContext) => {
      seen.push(ctx);
      return { ok: true, data: { ok: true } } satisfies AgentToolResult;
    };
    tool!.handler = spy;
    try {
      const authedApp = new Hono();
      authedApp.use(agentKeyAuth());
      authedApp.route("/", mcpAgentInteractionRoutes);

      const keyed = await authedApp.request("/mcp/agent-interaction", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "agentbadge_discover", arguments: {} },
        }),
      });
      expect(keyed.status).toBe(200);
      expect(seen.at(-1)?.actor.agentId).toBe("eip155:5042:0xregistry:7");
      expect(seen.at(-1)?.actor.resolution).toBe("API_KEY");

      await authedApp.request("/mcp/agent-interaction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "agentbadge_discover", arguments: {} },
        }),
      });
      const anon = seen.at(-1);
      expect(anon?.actor.resolution).toBe("ANON");
      expect(anon?.actor.agentId).toBeUndefined();
      expect(anon?.actor.verified).toBe(false);
    } finally {
      tool!.handler = original;
      initAgentKeyAuth(null);
    }
  });

  it("mounted under mcpAbuseGuard: anon lane over-limit → 429", async () => {
    const guarded = new Hono();
    guarded.use("/mcp/*", mcpAbuseGuard({ anonMax: 2, windowMs: 60_000 }));
    guarded.route("/", mcpAgentInteractionRoutes);

    const call = () =>
      guarded.request("/mcp/agent-interaction", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.233.1.1",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    const third = await call();
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).not.toBeNull();
  });
});

describe("GET /mcp/agent-interaction", () => {
  it("returns namespace descriptor", async () => {
    const res = await app.request("/mcp/agent-interaction");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tools: string[];
      auth: string;
      manifest: string;
    };
    expect(body.tools).toEqual(ROSTER);
    expect(body.manifest).toBe("/.well-known/agent-interaction.json");
  });
});

describe("GET /.well-known/agent-interaction.json", () => {
  it("manifest tools ≡ registry 1:1 (parity by construction)", async () => {
    const res = await manifestApp.request(
      "/.well-known/agent-interaction.json",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    const manifest = (await res.json()) as {
      mcp_endpoint: string;
      tools: {
        name: string;
        status: string;
        auth: string;
        rateClass: string;
        rest_equivalent: string;
        channel: string[];
      }[];
      webhooks: { signature_header: string };
      discovery_refs: string[];
    };
    expect(manifest.mcp_endpoint).toBe("/mcp/agent-interaction");
    expect(manifest.tools.map((t) => t.name)).toEqual(ROSTER);
    for (const t of AGENT_INTERACTION_TOOLS) {
      const m = manifest.tools.find((x) => x.name === t.name);
      expect(m).toBeDefined();
      expect(m!.status).toBe(t.status);
      expect(m!.auth).toBe(t.auth);
      expect(m!.rateClass).toBe(t.rateClass);
      expect(m!.rest_equivalent).toBe(t.rest_equivalent);
      expect(m!.channel).toEqual([...t.channel]);
    }
    expect(manifest.webhooks.signature_header).toBe(
      "X-AgentBadge-Signature",
    );
    expect(manifest.discovery_refs.length).toBeGreaterThan(0);
    // builder output ≡ served payload (no hand-edited fields possible)
    expect(buildAgentInteractionManifest().tools.map((t) => t.name)).toEqual(
      manifest.tools.map((t) => t.name),
    );
  });
});

// ─── SLICE-233-2: live read tools ──────────────────────────
// Handlers resolve the process-wide store singleton (memory mode in
// tests), so seeding via pickRequestInboxStores(getDatabase()) lands in
// the same map the tool dispatch reads.

const stores = pickRequestInboxStores(getDatabase());

const mkSubmit = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  id: `rq_${Math.random().toString(16).slice(2)}`,
  state: "submitted",
  kind: "question",
  payload: { prompt: "how do I verify a verdict?" },
  fingerprint: { ip: null, ua: "t/1", referer: null, src: null, headers: {} },
  fpHash: `fp_${Math.random().toString(16).slice(2)}`,
  expiresAtMs: Date.now() + 60_000,
  ...over,
});

async function toolCall(name: string, args: Record<string, unknown>) {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    result: {
      isError: boolean;
      structuredContent: Record<string, unknown>;
    };
  };
}

describe("agentbadge_discover", () => {
  it("returns the manifest-driven capability payload", async () => {
    const { result } = await toolCall("agentbadge_discover", {});
    const d = result.structuredContent as {
      service: string;
      capabilities: { name: string }[];
      manifest: string;
      start_here: Record<string, string>;
      discovery_refs: string[];
    };
    expect(d.manifest).toBe("/.well-known/agent-interaction.json");
    expect(d.capabilities.map((t) => t.name)).toEqual(ROSTER);
    expect(d.start_here.step_4).toContain("get_request_status");
    expect(d.discovery_refs).toContain("/llms.txt");
  });
});

describe("agentbadge_ask", () => {
  it("parity with GET /api/requests/qa on the same corpus", async () => {
    const q = `parity-question-${Math.random().toString(36).slice(2, 8)}`;
    await stores.requests.upsertQaPair({
      id: `qa_parity_${q}`,
      questionHash: questionHashFor(normalizeQuestion(q)),
      question: q,
      response: "parity-answer",
      sourceRequestId: "rq_source_parity",
      createdAtMs: Date.now(),
    });

    const restApp = new Hono();
    registerQaSearchRoute(restApp, stores.requests);
    const restRes = await restApp.request(
      `/api/requests/qa?q=${encodeURIComponent(q)}`,
    );
    const restBody = (await restRes.json()) as { results: unknown[] };

    const { result } = await toolCall("agentbadge_ask", { question: q });
    const d = result.structuredContent as { results: unknown[]; count: number };
    expect(d.results).toEqual(restBody.results);
    expect(d.count).toBe(restBody.results.length);
    expect(d.count).toBeGreaterThan(0);
  });
});

describe("agentbadge_get_request_status", () => {
  it("pending → 202-equiv {state, poll_after_seconds}", async () => {
    const id = `rq_pending_${Math.random().toString(16).slice(2)}`;
    await stores.requests.submit(mkSubmit({ id }));
    const { result } = await toolCall("agentbadge_get_request_status", {
      request_id: id,
    });
    const d = result.structuredContent as {
      state: string;
      http_status: number;
      poll_after_seconds: number;
    };
    expect(d.state).toBe("submitted");
    expect(d.http_status).toBe(202);
    expect(d.poll_after_seconds).toBe(5);
  });

  it("terminal → 200-equiv {state, response}", async () => {
    const id = `rq_done_${Math.random().toString(16).slice(2)}`;
    await stores.requests.submit(mkSubmit({ id }));
    const moved = await stores.requests.transition(id, "submitted", "completed", {
      response: { answer: "done" },
    });
    expect(moved).not.toBeNull();
    const { result } = await toolCall("agentbadge_get_request_status", {
      request_id: id,
    });
    const d = result.structuredContent as {
      state: string;
      http_status: number;
      response: { answer: string } | null;
    };
    expect(d.state).toBe("completed");
    expect(d.http_status).toBe(200);
    expect(d.response).toEqual({ answer: "done" });
  });

  it("expired → 410-equiv; unknown → 404-equiv; no enumeration", async () => {
    const dead = `rq_dead_${Math.random().toString(16).slice(2)}`;
    await stores.requests.submit(
      mkSubmit({ id: dead, expiresAtMs: Date.now() - 1 }),
    );
    const exp = await toolCall("agentbadge_get_request_status", {
      request_id: dead,
    });
    expect(exp.result.structuredContent.state).toBe("expired");
    expect(exp.result.structuredContent.http_status).toBe(410);

    const missing = await toolCall("agentbadge_get_request_status", {
      request_id: "rq_never_existed_000",
    });
    expect(missing.result.structuredContent.state).toBe("not_found");
    expect(missing.result.structuredContent.http_status).toBe(404);
  });
});
