/**
 * SLICE-233-8: cross-surface parity e2e — one fixture, one result on
 * REST and MCP (D-233-1 thin-adapter rule), the request state machine
 * end-to-end (202→200/410/404), guard lane matrix, Bearer agb_ auth,
 * and the webhook round trip: callback_url intake → terminal → signed
 * POST verified by the public verifier (D-233-5).
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { mcpAgentInteractionRoutes } from "../../src/server/routes/mcp-agent-interaction";
import { mcpAbuseGuard } from "../../src/server/middleware/mcp-abuse-guard";
import {
  agentKeyAuth,
  initAgentKeyAuth,
} from "../../src/server/middleware/agent-key-auth";
import { createMemoryAgentRegistrationStore } from "../../src/server/lib/agent-registration/store";
import { issueApiKey } from "../../src/server/lib/agent-registration/api-keys";
import { drainWebhookOutbox } from "../../src/server/lib/webhooks/worker";
import { verifyWebhookSignature } from "../../src/server/lib/webhooks/sign";
import { assertSafeTarget } from "../../src/agent-readiness/scanner/ssrf/ip-guard";
import {
  createToolCall,
  mkSubmit,
  restAppSharedLanes,
  stores,
  toolCall,
} from "../mcp/agent-interaction-harness";

const uniq = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** Sync per-hop validator — IP literals evaluate without DNS (unit-test
 *  pattern; delivery targets are already intake-validated). */
const validateUrl = async (raw: string) => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false as const, reason: "invalid_url" as const };
  }
  if (u.protocol !== "https:") {
    return { ok: false as const, reason: "scheme" as const };
  }
  try {
    assertSafeTarget(u.hostname);
  } catch {
    return { ok: false as const, reason: "unsafe_target" as const };
  }
  return { ok: true as const, url: u.toString() };
};

describe("single-fixture parity: one request ≡ same projection on both surfaces", () => {
  it("create via tool → poll via tool AND REST → identical public fields", async () => {
    const res = await createToolCall(
      { payload: { question: uniq("parity") }, kind: "question" },
      `ua-parity-${Date.now()}`,
    );
    const created = (await res.json()) as {
      result: { structuredContent: { request_id: string } };
    };
    const id = created.result.structuredContent.request_id;

    const rest = restAppSharedLanes();
    const poll = (label: string) => ({
      tool: toolCall("agentbadge_get_request_status", { request_id: id }),
      rest: rest.request(`/api/requests/${id}`),
      label,
    });

    // submitted → 202-equiv on both
    const p1 = poll("submitted");
    const toolBody1 = await p1.tool;
    const restRes1 = await p1.rest;
    const d1 = toolBody1.result.structuredContent as Record<string, unknown>;
    const r1 = (await restRes1.json()) as Record<string, unknown>;
    expect(restRes1.status).toBe(d1.http_status); // 202
    expect(r1.state).toBe(d1.state);
    // same cadence, transport-shaped name: REST retry_after ≡ tool
    // poll_after_seconds (both come from requestPoll's RETRY_AFTER_SEC).
    expect(r1.retry_after).toBe(d1.poll_after_seconds);
    expect(r1.retry_after).toBe(5);

    // completed → 200-equiv with the same response projection
    await stores.requests.transition(id, "submitted", "completed", {
      response: { answer: "parity-answer" },
    });
    const p2 = poll("completed");
    const toolBody2 = await p2.tool;
    const restRes2 = await p2.rest;
    const d2 = toolBody2.result.structuredContent as Record<string, unknown>;
    const r2 = (await restRes2.json()) as Record<string, unknown>;
    expect(restRes2.status).toBe(200);
    expect(d2.http_status).toBe(200);
    expect(r2.state).toBe(d2.state);
    expect(r2.response).toEqual(d2.response);
    // never leak internals on either surface
    for (const body of [r2, d2]) {
      expect(body.fingerprint).toBeUndefined();
      expect(body.callbackUrl).toBeUndefined();
    }
  });
});

describe("state machine: expired → 410, unknown → 404 (both surfaces)", () => {
  it("expired record answers 410-equiv on tool AND REST", async () => {
    const id = `rq_exp_${Math.random().toString(16).slice(2)}`;
    await stores.requests.submit(
      mkSubmit({ id, expiresAtMs: Date.now() - 1 }),
    );
    const tool = await toolCall("agentbadge_get_request_status", {
      request_id: id,
    });
    expect(tool.result.structuredContent.http_status).toBe(410);
    const rest = await restAppSharedLanes().request(`/api/requests/${id}`);
    expect(rest.status).toBe(410);
  });

  it("unknown id → not_found/404; no enumeration on either surface", async () => {
    const tool = await toolCall("agentbadge_get_request_status", {
      request_id: "rq_never_existed_e2e",
    });
    expect(tool.result.structuredContent.state).toBe("not_found");
    expect(tool.result.structuredContent.http_status).toBe(404);
    const rest = await restAppSharedLanes().request(
      "/api/requests/rq_never_existed_e2e",
    );
    expect(rest.status).toBe(404);
  });
});

describe("guard lanes (mcpAbuseGuard matrix)", () => {
  it("anon over base cap → 429 with rate-limit headers", async () => {
    const guarded = new Hono();
    guarded.use(
      "/mcp/*",
      mcpAbuseGuard({ anonMax: 3, windowMs: 60_000 }),
    );
    guarded.route("/", mcpAgentInteractionRoutes);
    const call = () =>
      guarded.request("/mcp/agent-interaction", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.8.3.7",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "agentbadge_discover", arguments: {} },
        }),
      });
    for (let i = 0; i < 3; i++) expect((await call()).status).toBe(200);
    const over = await call();
    expect(over.status).toBe(429);
    expect(over.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("keyed lane gets the keyed cap — anon lane stays at anonMax", async () => {
    const store = createMemoryAgentRegistrationStore();
    initAgentKeyAuth({ store, ttlSec: 60 });
    const { key, keyHash } = issueApiKey();
    await store.put({
      agentId: "eip155:5042:0xregistry:e2e",
      registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      registryTx: "0xmint",
      name: "e2e-agent",
      keyHash,
      tier: "observer",
      status: "active",
      createdAt: Date.now(),
    });
    try {
      const guarded = new Hono();
      guarded.use("/mcp/*", agentKeyAuth());
      guarded.use(
        "/mcp/*",
        mcpAbuseGuard({ anonMax: 1, keyedMax: 3, windowMs: 60_000 }),
      );
      guarded.route("/", mcpAgentInteractionRoutes);
      const call = (auth?: string) =>
        guarded.request("/mcp/agent-interaction", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "10.8.4.4",
            ...(auth ? { authorization: auth } : {}),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "agentbadge_discover", arguments: {} },
          }),
        });
      // anon lane: 1 ok, 2nd → 429
      expect((await call()).status).toBe(200);
      expect((await call()).status).toBe(429);
      // keyed lane: 3 ok, 4th → 429 (independent bucket)
      for (let i = 0; i < 3; i++) {
        expect((await call(`Bearer ${key}`)).status).toBe(200);
      }
      expect((await call(`Bearer ${key}`)).status).toBe(429);
    } finally {
      initAgentKeyAuth(null);
    }
  });

  it("unknown agb_ Bearer → 401 agent_key_invalid before any tool dispatch", async () => {
    const store = createMemoryAgentRegistrationStore();
    initAgentKeyAuth({ store, ttlSec: 60 });
    try {
      const authed = new Hono();
      authed.use(agentKeyAuth());
      authed.route("/", mcpAgentInteractionRoutes);
      const { key } = issueApiKey(); // well-formed but unregistered
      const res = await authed.request("/mcp/agent-interaction", {
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
      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe("agent_key_invalid");
    } finally {
      initAgentKeyAuth(null);
    }
  });
});

describe("webhook round trip (callback_url → terminal → signed POST)", () => {
  it("tool intake with callback_url → completed → verified signed delivery", async () => {
    const res = await createToolCall(
      {
        payload: { question: uniq("hook") },
        kind: "question",
        callback_url: "https://93.184.216.34/e2e-hook",
      },
      `ua-hook-${Date.now()}`,
    );
    const created = (await res.json()) as {
      result: { structuredContent: { request_id: string } };
    };
    const id = created.result.structuredContent.request_id;

    await stores.requests.transition(id, "submitted", "completed", {
      response: { answer: "hooked" },
    });
    const rows = await stores.webhooks.listForRequest(id);
    expect(rows.length).toBe(1);
    expect(rows[0]!.callbackUrl).toBe("https://93.184.216.34/e2e-hook");

    const seen: { headers: Headers; body: string }[] = [];
    const fetchFn: typeof fetch = (async (_u: unknown, init: RequestInit) => {
      seen.push({
        headers: new Headers(init.headers as HeadersInit),
        body: init.body as string,
      });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const out = await drainWebhookOutbox({
      outbox: stores.webhooks,
      fetchFn,
      validateUrl,
      secret: "e2e-webhook-secret",
      nowMs: () => Date.now(),
    });
    expect(out.delivered).toBe(1);
    expect((await stores.webhooks.get(rows[0]!.id))?.status).toBe("done");

    // Receiver-side verification with the PUBLIC verifier — the same
    // code path an external agent would run.
    const sig = seen[0]!.headers.get("X-AgentBadge-Signature")!;
    const nowSec = Math.floor(Date.now() / 1000);
    expect(
      verifyWebhookSignature("e2e-webhook-secret", sig, seen[0]!.body, nowSec),
    ).toBe(true);
    expect(
      verifyWebhookSignature("wrong-secret", sig, seen[0]!.body, nowSec),
    ).toBe(false);

    const payload = JSON.parse(seen[0]!.body) as Record<string, unknown>;
    expect(payload.event).toBe("request.terminal");
    expect(payload.request_id).toBe(id);
    expect(payload.state).toBe("completed");
    expect(payload.response).toEqual({ answer: "hooked" });
    expect(payload.fingerprint).toBeUndefined();
    expect(payload.callbackUrl).toBeUndefined();
  });
});
