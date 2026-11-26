/**
 * SLICE-233-2: live read tools — agentbadge_discover / _ask /
 * _get_request_status. Handlers resolve the process-wide store
 * singleton (memory mode in tests), so seeding via the shared harness
 * `stores` lands in the same map the tool dispatch reads.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { registerQaSearchRoute } from "../../src/server/routes/agent-requests/agent-requests-qa-api";
import {
  normalizeQuestion,
  questionHashFor,
} from "../../src/server/lib/request-inbox/fingerprint";
import {
  mkSubmit,
  ROSTER,
  stores,
  toolCall,
} from "./agent-interaction-harness";

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
