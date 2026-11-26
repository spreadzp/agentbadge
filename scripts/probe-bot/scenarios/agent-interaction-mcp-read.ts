/**
 * agent-interaction-mcp-read (EPIC-233, SLICE-233-11): envelope-aware
 * coverage of POST /mcp/agent-interaction. JSON-RPC 2.0 returns typed
 * errors INSIDE a 200 envelope — generic negative-contract/ssrf-guard
 * scenarios expect HTTP 4xx and would misfire here by design.
 *
 * Read-only: initialize / tools/list (+ manifest parity) / read tools /
 * malformed envelopes → asserted on `error.code` in the envelope.
 */
import type { Scenario, Variant } from "../src/types";
import { getPath } from "../src/verify";

const MCP = "/mcp/agent-interaction";
const J = { "content-type": "application/json" };

const rpc = (method: string, params?: unknown, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

const call = (name: string, args: unknown, id = 1) =>
  rpc("tools/call", { name, arguments: args }, id);

const expect200 = { statusIn: [200], statusNotIn: [500, 502, 503, 504] };

const EXPECTED_ROSTER = [
  "agentbadge_discover",
  "agentbadge_ask",
  "agentbadge_get_request_status",
  "agentbadge_create_task_request",
  "agentbadge_search_knowledge",
  "agentbadge_submit_feedback",
  "agentbadge_request_review",
  "agentbadge_report_problem",
];

const scenario: Scenario = {
  name: "agent-interaction-mcp-read",
  layer: "security",
  dbVerify: true,
  mutating: false,
  applies: ep => ep.method === "POST" && ep.path === MCP,
  variants: (): Variant[] => {
    const out: Variant[] = [];
    // Keyed branch (SLICE-233-11): Bearer agb_ elevates to the keyed
    // lane — verified agentId rides the request record. Env-gated:
    // honest SKIP when no live key is provisioned for the probe.
    const agbKey = process.env.PROBE_AGENT_KEY;
    if (agbKey) {
      out.push({
        method: "POST",
        path: MCP,
        headers: { ...J, authorization: `Bearer ${agbKey}` },
        body: rpc("tools/list"),
        expect: {
          ...expect200,
          json: { present: ["result.tools"] },
        },
        note: "keyed lane (Bearer agb_) — tools/list",
      });
    }
    out.push(
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: rpc("initialize"),
      expect: expect200,
      note: "initialize → tools/list → manifest parity",
      flow: {
        steps: [
          { method: "POST", path: MCP, headers: J, body: rpc("initialize"), note: "initialize" },
          { method: "POST", path: MCP, headers: J, body: rpc("tools/list"), note: "tools/list" },
          { method: "GET", path: "/.well-known/agent-interaction.json", note: "manifest" },
        ],
        assert: obs => {
          const problems: string[] = [];
          const init = obs[0]?.bodyJson;
          if (getPath(init, "result.protocolVersion") === undefined) {
            problems.push("initialize: no result.protocolVersion");
          }
          const tools = getPath(obs[1]?.bodyJson, "result.tools");
          const names = Array.isArray(tools)
            ? tools.map((t: { name?: string }) => t?.name).sort()
            : [];
          for (const want of EXPECTED_ROSTER) {
            if (!names.includes(want)) problems.push(`tools/list missing ${want}`);
          }
          if (names.length !== EXPECTED_ROSTER.length) {
            problems.push(`tools/list size ${names.length} ≠ ${EXPECTED_ROSTER.length}`);
          }
          const manifest = obs[2]?.bodyJson;
          const mTools = getPath(manifest, "tools");
          const mNames = Array.isArray(mTools)
            ? mTools.map((t: { name?: string }) => t?.name).sort()
            : [];
          if (JSON.stringify(mNames) !== JSON.stringify(names)) {
            problems.push("manifest↔tools/list parity mismatch");
          }
          if (getPath(manifest, "webhooks.status") !== "degraded") {
            problems.push(`webhooks.status = ${JSON.stringify(getPath(manifest, "webhooks.status"))}, want "degraded"`);
          }
          return problems;
        },
      },
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: call("agentbadge_discover", {}),
      expect: {
        ...expect200,
        json: {
          equals: { "result.isError": false },
          present: ["result.structuredContent.service", "result.structuredContent.rate_limits"],
        },
      },
      note: "discover (base lane)",
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: call("agentbadge_get_request_status", { request_id: "req_probe_no_such_id" }),
      expect: {
        ...expect200,
        json: {
          equals: {
            "result.isError": false,
            "result.structuredContent.state": "not_found",
            "result.structuredContent.http_status": 404,
          },
        },
      },
      note: "unknown id → typed not_found (id = capability, no leak)",
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: call("agentbadge_bogus_tool", {}),
      expect: {
        ...expect200,
        json: { equals: { "error.code": -32601 } },
      },
      note: "unknown tool → -32601 (roster whitelist boundary)",
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: rpc("bogus_method"),
      expect: { ...expect200, json: { equals: { "error.code": -32601 } } },
      note: "unknown rpc method → -32601",
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: JSON.stringify([rpc("ping")]),
      expect: { ...expect200, json: { equals: { "error.code": -32600 } } },
      note: "batch array → -32600 (single-message transport)",
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: '"just a string"',
      expect: { ...expect200, json: { equals: { "error.code": -32600 } } },
      note: "scalar body → -32600 (M12)",
    },
    {
      method: "POST",
      path: MCP,
      headers: J,
      body: '{"jsonrpc":"2.0","id":1,"method":"ping",',
      expect: { ...expect200, json: { equals: { "error.code": -32700 } } },
      note: "truncated JSON → -32700 parse error",
    },
    );
    return out;
  },
};

export default scenario;
