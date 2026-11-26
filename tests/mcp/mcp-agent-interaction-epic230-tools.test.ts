/**
 * SLICE-233-5: the four tools that were "planned" seams now wire the
 * SHIPPED 229/230 backends — thin adapters ≡ REST (same services,
 * same stores, same shared limiter buckets). Covers success/error
 * mapping, schema-reject before the service call, idempotent replay,
 * and the rateClass ≡ DEFAULT_HEAVY_OPS mirror (D-233-7).
 *
 * Budget note: the shared tiered limiters cap ANON at 3/min per
 * surface — this file spends ≤3 anon calls per bucket.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  DEFAULT_HEAVY_OPS,
  mcpAbuseGuard,
} from "../../src/server/middleware/mcp-abuse-guard";
import { mcpAgentInteractionRoutes } from "../../src/server/routes/mcp-agent-interaction";
import { AGENT_INTERACTION_TOOLS } from "../../src/server/lib/agent-interaction/registry";
import { getDatabase } from "../../src/server/lib/database";
import { pickFeedbackStore } from "../../src/server/lib/feedback/db-stores";
import { pickReviewStore } from "../../src/server/lib/reviews/db-stores";
import { pickKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import {
  addEvidence,
  createKnowledgeItem,
} from "../../src/server/lib/knowledge";
import { approveTransition } from "../helpers/knowledge";
import { manifestApp, rpc, toolCall } from "./agent-interaction-harness";

/** Schema-gate rejections surface as JSON-RPC -32602 (protocol
 *  error), never as a tool-level result. */
async function expectInvalidParams(
  name: string,
  args: Record<string, unknown>,
) {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    error?: { code: number; message: string };
    result?: unknown;
  };
  expect(body.result).toBeUndefined();
  expect(body.error?.code).toBe(-32602);
}

const uniq = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

async function seedPublishedItem(token: string) {
  const store = pickKnowledgeStores(getDatabase());
  const r = await createKnowledgeItem(
    store,
    { kind: "GUIDE", title: `zephyr ${token} guide`, body: "b" },
    "ops_seed",
  );
  if (!r.ok) throw new Error("seed create failed");
  const ev = await addEvidence(store, r.version.id, {
    type: "INTERNAL_DOC",
    uri: `internal://seed/${token}`,
    addedBy: "ops_seed",
  });
  if (!ev.ok) throw new Error("seed evidence failed");
  // SoD: verifier ≠ submitter; publisher ≠ verifier (submitter may publish).
  for (const [to, actor] of [
    ["PENDING", "ops_seed"],
    ["VERIFIED", "ops_review"],
    ["PUBLISHED", "ops_seed"],
  ] as const) {
    const t = await approveTransition(store, r.item.id, to, actor);
    if (!t.ok) throw new Error(`seed transition ${to} failed`);
  }
  return r.item.id;
}

describe("agentbadge_search_knowledge", () => {
  it("live call → REST-parity result shape over PUBLISHED items", async () => {
    const token = uniq("tok");
    await seedPublishedItem(token);
    const { result } = await toolCall("agentbadge_search_knowledge", {
      query: `zephyr ${token}`,
    });
    expect(result.isError).toBe(false);
    const d = result.structuredContent as {
      results: Array<{ itemId: string; slug: string; title: string }>;
      query: string;
      engine: string;
      tookMs: number;
    };
    expect(d.query).toBe(`zephyr ${token}`);
    expect(d.engine).toBe("MEMORY");
    expect(d.results.some((h) => h.title.includes(token))).toBe(true);
  });

  it("invalid kind → JSON-RPC -32602 at schema gate (no service call)", async () => {
    await expectInvalidParams("agentbadge_search_knowledge", {
      query: "valid query here",
      kind: "not-a-kind",
    });
  });
});

describe("agentbadge_submit_feedback / report_problem", () => {
  it("submit_feedback → {id,status_url}; idempotent replay → duplicate", async () => {
    const key = `fbk-${Math.random().toString(36).slice(2, 12)}`;
    const args = {
      subject: uniq("subj"),
      message: "the docs for X are stale",
      kind: "FEATURE",
      target: "api",
      idempotency_key: key,
    };
    const { result: r1 } = await toolCall("agentbadge_submit_feedback", args);
    expect(r1.isError).toBe(false);
    const d1 = r1.structuredContent as {
      id: string;
      status_url: string;
      duplicate: boolean;
    };
    expect(d1.status_url).toBe(`/api/v1/agent/feedback/${d1.id}`);
    expect(d1.duplicate).toBe(false);

    const rec = await pickFeedbackStore(getDatabase()).getFeedback(d1.id);
    expect(rec?.kind).toBe("FEATURE");
    expect(rec?.target).toBe("api");
    expect(rec?.text).toBe(`${args.subject}\n\n${args.message}`);

    const { result: r2 } = await toolCall("agentbadge_submit_feedback", args);
    const d2 = r2.structuredContent as { id: string; duplicate: boolean };
    expect(d2.id).toBe(d1.id);
    expect(d2.duplicate).toBe(true);
  });

  it("report_problem → kind=BUG, severity mapped to REST vocabulary", async () => {
    const { result } = await toolCall("agentbadge_report_problem", {
      subject: uniq("prob"),
      message: "endpoint returns 500 on empty body",
      severity: "high",
      target: "mcp",
    });
    expect(result.isError).toBe(false);
    const d = result.structuredContent as { id: string };
    const rec = await pickFeedbackStore(getDatabase()).getFeedback(d.id);
    expect(rec?.kind).toBe("BUG");
    expect(rec?.severity).toBe("HIGH");
    expect(rec?.target).toBe("mcp");
  });

  it("bad kind/target rejected at schema gate → JSON-RPC -32602", async () => {
    await expectInvalidParams("agentbadge_submit_feedback", {
      subject: "s",
      message: "m",
      kind: "RANT",
    });
  });
});

describe("agentbadge_request_review", () => {
  it("live call → review case + typed evidence land", async () => {
    const { result } = await toolCall("agentbadge_request_review", {
      review_type: "CODE_SNIPPET",
      work_ref: "https://example.com/snippet/1",
      agent_criteria: ["check the signature"],
      evidence: [
        {
          type: "EXTERNAL_URL",
          uri: "https://example.com/repro",
          label: "repro",
        },
      ],
    });
    expect(result.isError).toBe(false);
    const d = result.structuredContent as { id: string; status_url: string };
    expect(d.status_url).toBe(`/api/v1/agent/reviews/${d.id}`);

    const store = pickReviewStore(getDatabase());
    const rec = await store.getReview(d.id);
    expect(rec?.reviewType).toBe("CODE_SNIPPET");
    expect((rec?.agentCriteria as string[])?.[0]).toBe("check the signature");
    const ev = await store.listEvidence(d.id);
    expect(ev).toHaveLength(1);
  });

  it("bad review_type / malformed evidence → -32602 pre-handler", async () => {
    await expectInvalidParams("agentbadge_request_review", {
      review_type: "TRUST_ME",
      work_ref: "https://example.com/x",
    });
    await expectInvalidParams("agentbadge_request_review", {
      review_type: "DOCS",
      work_ref: "https://example.com/x",
      evidence: ["just-a-string"],
    });
  });
});

describe("HEAVY_OPS mirror + manifest parity", () => {
  it("every rateClass:heavy tool name is in DEFAULT_HEAVY_OPS", () => {
    const heavy = AGENT_INTERACTION_TOOLS.filter(
      (t) => t.rateClass === "heavy",
    ).map((t) => t.name);
    for (const name of heavy) {
      expect(DEFAULT_HEAVY_OPS).toContain(name);
    }
    expect(heavy.length).toBe(5);
  });

  it("manifest tool statuses ≡ registry (all live)", async () => {
    const res = await manifestApp.request(
      "/.well-known/agent-interaction.json",
    );
    const manifest = (await res.json()) as {
      tools: Array<{ name: string; status: string }>;
    };
    const reg = new Map(AGENT_INTERACTION_TOOLS.map((t) => [t.name, t]));
    for (const t of manifest.tools) {
      expect(t.status).toBe(reg.get(t.name)?.status);
      expect(t.status).toBe("live");
    }
  });

  it("mcpAbuseGuard heavy bucket → 429 on over-limit heavy call", async () => {
    const guarded = new Hono();
    guarded.use(
      "/mcp/*",
      mcpAbuseGuard({ anonMax: 100, heavyMax: 3, windowMs: 60_000 }),
    );
    guarded.route("/", mcpAgentInteractionRoutes);
    const call = () =>
      guarded.request("/mcp/agent-interaction", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.233.9.9",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "agentbadge_search_knowledge",
            arguments: { query: uniq("heavy") },
          },
        }),
      });
    for (let i = 0; i < 3; i++) {
      expect((await call()).status).toBe(200);
    }
    expect((await call()).status).toBe(429);
  });
});
