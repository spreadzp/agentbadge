/**
 * SLICE-233-3: write path — agentbadge_create_task_request +
 * callback_url intake. REST and tool share ONE submit pipeline + ONE
 * lane bucket (getSharedSubmitLanes). Each test uses a distinct UA so
 * fresh fingerprint lanes don't collide inside the 1-per-2h budget.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { mcpAgentInteractionRoutes } from "../../src/server/routes/mcp-agent-interaction";
import {
  agentKeyAuth,
  initAgentKeyAuth,
} from "../../src/server/middleware/agent-key-auth";
import { createMemoryAgentRegistrationStore } from "../../src/server/lib/agent-registration/store";
import { issueApiKey } from "../../src/server/lib/agent-registration/api-keys";
import {
  normalizeQuestion,
  questionHashFor,
} from "../../src/server/lib/request-inbox/fingerprint";
import {
  app,
  createToolCall,
  restAppSharedLanes,
  stores,
  toolCall,
} from "./agent-interaction-harness";

describe("agentbadge_create_task_request", () => {
  it("submit → same record shape as REST POST (202-equiv, poll_url)", async () => {
    const { result } = await toolCall("agentbadge_create_task_request", {
      payload: { question: `q-${Math.random().toString(36).slice(2, 10)}` },
      kind: "question",
    });
    const d = result.structuredContent as {
      request_id: string;
      state: string;
      poll_url: string;
      duplicate: boolean;
    };
    expect(d.request_id).toMatch(/^rq_[a-f0-9]{32}$/);
    expect(d.state).toBe("submitted");
    expect(d.poll_url).toBe(`/api/requests/${d.request_id}`);
    expect(d.duplicate).toBe(false);

    const { record } = await stores.requests.get(d.request_id);
    expect(record?.kind).toBe("question");
    expect(record?.channel).toBe("mcp-agent-interaction");
    expect(record?.agentId).toBeNull();
    expect(record?.verified).toBe(false);
  });

  it("bare-string payload wraps to {question} like REST parseIntake", async () => {
    const q = `bare-${Math.random().toString(36).slice(2, 10)}`;
    const res = await createToolCall({ payload: q }, "ua-bare");
    const body = (await res.json()) as {
      result: { structuredContent: { request_id: string } };
    };
    const { record } = await stores.requests.get(
      body.result.structuredContent.request_id,
    );
    expect(record?.payload).toEqual({ question: q });
  });

  it("idempotency_key replay → duplicate, same request_id; different payload → error", async () => {
    const key = `idem-${Math.random().toString(36).slice(2, 12)}`;
    const p = {
      question: `idem-q-${Math.random().toString(36).slice(2, 8)}`,
    };
    const ua = `ua-idem-${Math.random().toString(36).slice(2, 8)}`;
    const first = await createToolCall(
      { payload: p, idempotency_key: key },
      ua,
    );
    const firstBody = (await first.json()) as {
      result: { structuredContent: { request_id: string; duplicate: boolean } };
    };
    const replay = await createToolCall(
      { payload: p, idempotency_key: key },
      ua,
    );
    const replayBody = (await replay.json()) as {
      result: { structuredContent: { request_id: string; duplicate: boolean } };
    };
    expect(replayBody.result.structuredContent.request_id).toBe(
      firstBody.result.structuredContent.request_id,
    );
    expect(replayBody.result.structuredContent.duplicate).toBe(true);

    const clash = await createToolCall(
      { payload: { question: "different" }, idempotency_key: key },
      ua,
    );
    const clashBody = (await clash.json()) as {
      result: {
        isError: boolean;
        structuredContent: { error: { code: string } };
      };
    };
    expect(clashBody.result.isError).toBe(true);
    expect(clashBody.result.structuredContent.error.code).toBe(
      "INVALID_INPUT",
    );
  });

  it("callback_url matrix — https public ok + persisted; unsafe targets rejected pre-persist", async () => {
    const ua = `ua-cb-${Math.random().toString(36).slice(2, 8)}`;
    const good = await createToolCall(
      {
        payload: { question: `cbq-${Math.random().toString(36).slice(2, 8)}` },
        callback_url: "https://93.184.216.34/hook", // public IP literal — no DNS needed
      },
      ua,
    );
    const goodBody = (await good.json()) as {
      result: {
        isError: boolean;
        structuredContent: { request_id: string };
      };
    };
    expect(goodBody.result.isError).toBe(false);
    const rid = goodBody.result.structuredContent.request_id;
    const { record } = await stores.requests.get(rid);
    expect(record?.callbackUrl).toBe("https://93.184.216.34/hook");

    for (const bad of [
      "http://93.184.216.34/hook", // scheme
      "https://localhost/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.5/h",
      "https://[::1]/h",
      "https://127.0.0.1/h",
      "not-a-url",
    ]) {
      const res = await createToolCall(
        { payload: { x: 1 }, callback_url: bad },
        ua,
      );
      const body = (await res.json()) as {
        result: {
          isError: boolean;
          structuredContent: { error: { code: string } };
        };
      };
      expect(body.result.isError).toBe(true);
      expect(body.result.structuredContent.error.code).toBe("INVALID_INPUT");
    }
  });

  it("callback_url never leaks into the public poll projection", async () => {
    const ua = `ua-leak-${Math.random().toString(36).slice(2, 8)}`;
    const res = await createToolCall(
      {
        payload: { question: `lk-${Math.random().toString(36).slice(2, 8)}` },
        callback_url: "https://93.184.216.34/hook",
      },
      ua,
    );
    const body = (await res.json()) as {
      result: { structuredContent: { request_id: string } };
    };
    const rest = restAppSharedLanes();
    const poll = await rest.request(
      `/api/requests/${body.result.structuredContent.request_id}`,
    );
    const pollBody = (await poll.json()) as Record<string, unknown>;
    expect(pollBody.callbackUrl).toBeUndefined();
    expect(pollBody.callback_url).toBeUndefined();
    expect(pollBody.fingerprint).toBeUndefined();
  });

  it("one lane bucket: REST consumes the slot → tool submit is 429-equiv", async () => {
    const ua = `ua-shared-${Math.random().toString(36).slice(2, 8)}`;
    const headers = {
      "user-agent": ua,
      "accept-language": "en-US", // identity header — same on both
      "content-type": "application/json",
    };
    const rest = restAppSharedLanes();
    const q = `shared-${Math.random().toString(36).slice(2, 8)}`;
    const r1 = await rest.request("/api/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ payload: { question: q } }),
    });
    expect(r1.status).toBe(202);

    const r2 = await app.request("/mcp/agent-interaction", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "agentbadge_create_task_request",
          arguments: { payload: { question: `${q}-b` } },
        },
      }),
    });
    const b2 = (await r2.json()) as {
      result: {
        isError: boolean;
        structuredContent: {
          error: { code: string; data?: { retryable: boolean } };
        };
      };
    };
    expect(b2.result.isError).toBe(true);
    expect(b2.result.structuredContent.error.code).toBe("RATE_LIMITED");
    expect(
      b2.result.structuredContent.error.data?.retryable,
    ).toBe(true);
  });

  it("QA fast-path through the tool → instant answer, no row", async () => {
    const q = `fp-${Math.random().toString(36).slice(2, 10)}`;
    await stores.requests.upsertQaPair({
      id: `qa_fp_${q}`,
      questionHash: questionHashFor(normalizeQuestion(q)),
      question: q,
      response: "instant answer",
      sourceRequestId: "rq_src_fp",
      createdAtMs: Date.now(),
    });
    const res = await createToolCall(
      { payload: { question: q } },
      `ua-fp-${Math.random().toString(36).slice(2, 6)}`,
    );
    const { result } = (await res.json()) as {
      result: {
        isError: boolean;
        structuredContent: Record<string, unknown>;
      };
    };
    const d = result.structuredContent as {
      state: string;
      qa: boolean;
      request_created: boolean;
      response: string;
    };
    expect(d.state).toBe("completed");
    expect(d.qa).toBe(true);
    expect(d.request_created).toBe(false);
    expect(d.response).toBe("instant answer");
  });

  it("Bearer agb_ → verified agentId lands on the record", async () => {
    const store = createMemoryAgentRegistrationStore();
    initAgentKeyAuth({ store, ttlSec: 60 });
    const { key, keyHash } = issueApiKey();
    await store.put({
      agentId: "eip155:5042:0xregistry:9",
      registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      registryTx: "0xmint",
      name: "probe-agent",
      keyHash,
      tier: "observer",
      status: "active",
      createdAt: Date.now(),
    });
    try {
      const authedApp = new Hono();
      authedApp.use(agentKeyAuth());
      authedApp.route("/", mcpAgentInteractionRoutes);
      const res = await authedApp.request("/mcp/agent-interaction", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "agentbadge_create_task_request",
            arguments: {
              payload: {
                question: `keyed-${Math.random().toString(36).slice(2, 8)}`,
              },
            },
          },
        }),
      });
      const body = (await res.json()) as {
        result: { structuredContent: { request_id: string } };
      };
      const { record } = await stores.requests.get(
        body.result.structuredContent.request_id,
      );
      expect(record?.agentId).toBe("eip155:5042:0xregistry:9");
      expect(record?.verified).toBe(true);
    } finally {
      initAgentKeyAuth(null);
    }
  });
});
