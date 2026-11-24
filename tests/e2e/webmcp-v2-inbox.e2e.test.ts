import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { Hono } from "hono";
import { toolsFor, injectWebMCP, generateDeclarativeScript } from "@agentbadge/webmcp";

/**
 * SLICE-256-6: WebMCP v2 e2e — real tool execute() functions run against
 * the real route surface (createApp) through a fetch bridge that maps the
 * tools' same-origin relative URLs onto app.request().
 *
 * Covers the epic acceptance path:
 *   submit-request → request_id → poll-request → (ops respond) → completed
 * plus consent gating (publish_to_qa), QA retract, read-tool live calls,
 * channel-marker propagation, and spec-drift smoke on the injected API.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-webmcp-v2";
const ADMIN = "test-admin-key";
process.env.ADMIN_API_KEY = ADMIN;
// 264-9: ops/admin calls ride the break-glass flag explicitly.
process.env.ADMIN_BREAK_GLASS_ENABLED = "true";
const OPS = { "X-Admin-Key": ADMIN };

let app: Hono;
const fetches: Array<{ url: string; init?: RequestInit }> = [];
let realFetch: typeof fetch;
// Anonymous submits are limited to 1/2h per fingerprint (ip|ua|headers).
// Distinct UA per test lane models distinct browser agents.
let currentUa = "e2e-256-agent-0";

const webmcpTools = () => toolsFor({ exposure: "webmcp" });
const tool = (name: string) => {
  const t = webmcpTools().find((x) => x.name === name);
  if (!t) throw new Error(`tool not published: ${name}`);
  return t;
};
const SIG = () => ({ signal: new AbortController().signal });
const exec = async (name: string, args: Record<string, unknown>) =>
  (await tool(name).execute(args, SIG())) as Record<string, unknown>;

beforeAll(async () => {
  const { createApp } = await import("../../src/server/index");
  app = createApp();
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/")) {
      const init2: RequestInit = {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), "user-agent": currentUa },
      };
      fetches.push({ url, init: init2 });
      return app.request(url, init2 as never) as unknown as Response;
    }
    return realFetch(input, init);
  }) as typeof fetch;
}, 60000);

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("submit → poll → ops respond → completed (epic acceptance path)", () => {
  it("runs the full inbox cycle through the real tools", async () => {
    // 1. submit-request — deterministic Idempotency-Key → 202 + request_id
    const submit = await exec("submit-request", { question: "e2e-256: what chains does AgentBadge scan?" });
    expect(submit.state).toBe("submitted");
    expect(typeof submit.request_id).toBe("string");
    const submitFetch = fetches[fetches.length - 1];
    expect(submitFetch.url).toContain("/api/requests?src=webmcp");
    const headers = submitFetch.init?.headers as Record<string, string>;
    expect(headers["X-AgentBadge-Channel"]).toBe("webmcp");
    expect(headers["Idempotency-Key"]).toMatch(/^webmcp_[0-9a-f]{48}$/);
    const idemKey = headers["Idempotency-Key"];
    const nc = submit.next_call as { tool: string }[];
    expect(nc[0].tool).toBe("poll-request");

    // 2. Identical call replays the same request (key + payload fingerprint)
    const replay = await exec("submit-request", { question: "e2e-256: what chains does AgentBadge scan?" });
    const replayHeaders = fetches[fetches.length - 1].init?.headers as Record<string, string>;
    expect(replayHeaders["Idempotency-Key"]).toBe(idemKey);
    expect(replay.request_id).toBe(submit.request_id);

    // 3. poll pending → lifecycle hints, stays in a pending state
    const pending = await exec("poll-request", { request_id: submit.request_id });
    expect(["submitted", "working"]).toContain(pending.state);
    expect(pending.created_at).toBeTruthy();
    const pnc = pending.next_call as { tool: string }[];
    expect(pnc[0].tool).toBe("poll-request");

    // 4. ops respond (test-mode admin) → completed
    const respond = await app.request(`/api/ops/requests/${submit.request_id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...OPS },
      body: JSON.stringify({ response: "We scan Arc and EVM-compatible chains." }),
    });
    expect(respond.status).toBe(200);

    // 5. poll → completed + response + next_call → search-agent-qa
    const done = await exec("poll-request", { request_id: submit.request_id });
    expect(done.state).toBe("completed");
    expect(String(done.response)).toContain("Arc");
    const dnc = done.next_call as { tool: string }[];
    expect(dnc[0].tool).toBe("search-agent-qa");
  }, 60000);
});

describe("publish_to_qa consent + retract (SLICE-256-3 contract)", () => {
  const respondOps = async (id: string, response: string) => {
    const res = await app.request(`/api/ops/requests/${id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json", ...OPS },
      body: JSON.stringify({ response }),
    });
    expect(res.status).toBe(200);
  };

  it("consent=false answer never enters /qa; consent=true does; retract removes it", async () => {
    // consent default false
    currentUa = "e2e-256-agent-consent-priv";
    const priv = await exec("submit-request", { question: "e2e-256-private: secret-ish question" });
    expect(priv.request_id, JSON.stringify(priv)).toBeTruthy();
    await respondOps(priv.request_id as string, "private answer");
    const privSearch = await exec("search-agent-qa", { q: "e2e-256-private" });
    expect(JSON.stringify(privSearch)).not.toContain("private answer");

    // consent true → materializes in QA after respond
    currentUa = "e2e-256-agent-consent-pub";
    const pub = await exec("submit-request", { question: "e2e-256-public: what is a verdict?", publish_to_qa: true });
    await respondOps(pub.request_id as string, "a verdict is a signed scan outcome");
    const pubSearch = await exec("search-agent-qa", { q: "e2e-256-public" });
    const results = (pubSearch.results ?? pubSearch.pairs ?? []) as Record<string, unknown>[];
    const hit = results.find((r) => String(r.answer ?? r.response ?? "").includes("verdict"));
    expect(hit, JSON.stringify(pubSearch)).toBeTruthy();
    if (!hit) throw new Error("qa pair not found");
    expect(String(hit.qa_id)).toMatch(/^qa_/);
    expect(hit.provenance).toBeTruthy();
    expect(hit.source_request_id).toBeUndefined();

    // fast-path: same question → qa_match from public corpus
    currentUa = "e2e-256-agent-fastpath";
    const fp = await exec("submit-request", { question: "e2e-256-public: what is a verdict?" });
    expect(fp.qa === true || fp.qa_match === true || fp.match_method != null).toBe(true);

    // retract → gone from search
    const retract = await app.request(`/api/ops/requests/qa/${hit.qa_id}/retract`, {
      method: "POST",
      headers: { "content-type": "application/json", ...OPS },
      body: JSON.stringify({ reason: "e2e retract" }),
    });
    expect([200, 204]).toContain(retract.status);
    const after = await exec("search-agent-qa", { q: "e2e-256-public" });
    expect(JSON.stringify(after)).not.toContain("signed scan outcome");
  }, 60000);
});

describe("read tools against live routes", () => {
  it("every read tool returns a structured result or honest error envelope", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["check-address-risk", { address: "0x0000000000000000000000000000000000000001" }],
      ["list-services", {}],
      ["browse-tasks", {}],
      ["get-task-status", { task_id: "task_nonexistent_256" }],
      ["verify-verdict", { verdict_id: "vld_nonexistent_256" }],
      ["search-agent-qa", { q: "nonexistent-corpus-term-256" }],
      ["list-surveys", {}],
      ["how-to-register", {}],
      ["agent-readiness-scan", { url: "https://agentbadge.xyz" }],
    ];
    for (const [name, args] of cases) {
      const out = await exec(name, args);
      expect(out, name).toBeTruthy();
      expect(typeof out).toBe("object");
      if (out.code && String(out.code).startsWith("http_")) {
        expect(out).toHaveProperty("message");
        expect(out).toHaveProperty("retryable");
      }
    }
    // how-to-register performed zero fetches
    const fetchCount = fetches.length;
    await exec("how-to-register", {});
    expect(fetches.length).toBe(fetchCount);
    // all outgoing calls carried the channel marker
    const marked = fetches.filter(
      (f) => (f.init?.headers as Record<string, string>)?.["X-AgentBadge-Channel"] === "webmcp",
    );
    expect(marked.length).toBeGreaterThan(0);
  }, 60000);

  it("poll on a dead id returns an honest envelope, not a throw", async () => {
    const out = await exec("poll-request", { request_id: "req_no_such_256" });
    expect(String(out.code)).toBe("http_404");
    expect(out.retryable).toBe(false);
  });
});

describe("spec-drift smoke (webmachinelearning moving target)", () => {
  it("injected script uses document.modelContext, never navigator.modelContext", () => {
    const script = injectWebMCP(webmcpTools());
    expect(script).toContain("document.modelContext");
    expect(script).toContain("registerTool");
    expect(script).not.toContain("navigator.modelContext");
    expect(script).not.toContain("provideContext");
  });

  it("declarative form script is still generated (D-256-Q8)", () => {
    const decl = generateDeclarativeScript();
    expect(decl).toContain("<script>");
    expect(decl.length).toBeGreaterThan(50);
  });
});
