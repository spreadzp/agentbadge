/**
 * agent-interaction-mcp-write (EPIC-233, SLICE-233-11): mutating leg —
 * create_task_request via JSON-RPC, callback_url SSRF reject, idempotent
 * replay, terminal transition via break-glass admin (fires the webhook
 * outbox worker), then external delivery evidence at PROBE_WEBHOOK_URL.
 *
 * Budget (lesson 231): ONE real submit + ONE replay + SSRF rejects
 * (no lane consumed — validation precedes submit lanes). Heavy bucket
 * 10/60s covers the handful of write-tool calls.
 *
 * PROBE_WEBHOOK_URL env: full callback URL for the delivery probe —
 * e.g. a webhook.site token URL (evidence pulled from its API
 * afterwards). Unset → falls back to this server's own MCP endpoint
 * (any JSON POST → 200 envelope → worker marks delivered; dbVerify
 * sees the inbound POST in traffic logs — weaker but offline-safe).
 * PROD_ADMIN_API_KEY env: break-glass X-Admin-Key for the terminal
 * transition step (skipped honestly when absent).
 */
import { caseToken } from "../src/scenarios";
import type { FlowStep, Scenario, Variant } from "../src/types";
import { getPath } from "../src/verify";

const MCP = "/mcp/agent-interaction";
const J = { "content-type": "application/json" };

const call = (name: string, args: unknown, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

const submitBody = (caseKey: string, cb: string | null, key: string) =>
  call("agentbadge_create_task_request", {
    kind: "question",
    payload: { text: `BOT-PROBE ${caseKey}: agent-interaction webhook verify` },
    idempotency_key: key,
    ...(cb ? { callback_url: cb } : {}),
  });

const expect200 = { statusIn: [200], statusNotIn: [500, 502, 503, 504] };

const scenario: Scenario = {
  name: "agent-interaction-mcp-write",
  layer: "contract",
  dbVerify: true,
  mutating: true,
  applies: ep => ep.method === "POST" && ep.path === MCP,
  variants: (ep): Variant[] => {
    const key = `BOT-PROBE-${caseToken(ep, "mcp-write")}`;
    const cb = process.env.PROBE_WEBHOOK_URL ?? "https://agentbadge.xyz/mcp/agent-interaction";
    const adminKey = process.env.PROD_ADMIN_API_KEY;

    const submit = submitBody("submit", cb, `${key}-w`);
    const replay = submitBody("submit", cb, `${key}-w`);

    const steps: FlowStep[] = [
      {
        method: "POST", path: MCP, headers: J, body: submit,
        note: `create_task_request + callback_url=${cb.slice(0, 48)}`,
        expect: {
          ...expect200,
          json: {
            equals: { "result.isError": false, "result.structuredContent.state": "submitted" },
            present: ["result.structuredContent.request_id", "result.structuredContent.poll_url", "result.structuredContent.webhook_secret"],
            regex: {
              "result.structuredContent.request_id": "^rq_",
              "result.structuredContent.webhook_secret": "^whsec_[A-Za-z0-9_-]{43}$",
            },
          },
        },
      },
      {
        method: "POST", path: MCP, headers: J, body: replay,
        note: "idempotent replay → duplicate + same request_id",
        expect: {
          ...expect200,
          json: { equals: { "result.isError": false, "result.structuredContent.duplicate": true } },
        },
      },
      {
        method: "POST", path: MCP, headers: J,
        body: call("agentbadge_get_request_status", { request_id: "{step1.result.structuredContent.request_id}" }, 3),
        note: "poll own request → queued/working",
        expect: { ...expect200, json: { equals: { "result.isError": false } } },
      },
      {
        // SSRF reject — private IP callback never persists, no lane slot.
        method: "POST", path: MCP, headers: J,
        body: submitBody("ssrf", "http://169.254.169.254/latest/meta-data", `${key}-s`),
        note: "callback_url=169.254.169.254 → typed reject (PASS)",
        expect: {
          ...expect200,
          json: { equals: { "result.isError": true, "result.structuredContent.error.code": "INVALID_INPUT" } },
        },
      },
    ];

    if (adminKey) {
      steps.push({
        method: "POST",
        path: "/api/ops/requests/{step1.result.structuredContent.request_id}/state",
        headers: { ...J, "x-admin-key": adminKey },
        body: JSON.stringify({ state: "failed" }),
        note: "break-glass terminal transition → webhook outbox fires",
        expect: { ...expect200, json: { equals: { state: "failed" } } },
      });
    }

    return [{
      method: "POST", path: MCP, headers: J, body: submit,
      expect: expect200,
      note: "submit+replay+poll+ssrf+terminal",
      flow: {
        steps,
        assert: obs => {
          const problems: string[] = [];
          const r1 = getPath(obs[0]?.bodyJson, "result.structuredContent.request_id");
          const r2 = getPath(obs[1]?.bodyJson, "result.structuredContent.request_id");
          if (r1 !== r2) problems.push(`replay id mismatch ${r2} ≠ ${r1}`);
          const s1 = getPath(obs[0]?.bodyJson, "result.structuredContent.webhook_secret");
          const s2 = getPath(obs[1]?.bodyJson, "result.structuredContent.webhook_secret");
          if (s1 !== s2) problems.push("replay webhook_secret differs from first submit");
          const state = getPath(obs[2]?.bodyJson, "result.structuredContent.state");
          if (!["submitted", "working"].includes(String(state))) {
            problems.push(`poll state ${JSON.stringify(state)} not in submitted|working`);
          }
          return problems;
        },
      },
    }];
  },
};

export default scenario;
