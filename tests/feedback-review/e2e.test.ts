import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import { wireFeedbackReview } from "../../src/server/wiring/feedback-review";
import { resetDatabaseForTests } from "../../src/server/lib/database";
import { pickFeedbackStore } from "../../src/server/lib/feedback/db-stores";
import { pickReviewStore } from "../../src/server/lib/reviews/db-stores";
import { pickKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import { getDatabase } from "../../src/server/lib/database";
import {
  triageFeedback,
  resolveFeedback,
} from "../../src/server/lib/feedback/workflow";
import {
  claimReview,
} from "../../src/server/lib/reviews/workflow";
import { decideReview } from "../../src/server/lib/reviews/decide";
import { convertFeedbackToDraft } from "../../src/server/lib/knowledge-draft/convert";
import { knowledgeDraftPort } from "../../src/server/lib/knowledge-draft/port";
import { criteriaForReview } from "../../src/server/lib/reviews/criteria";
import { registry } from "../../src/server/metrics/metrics";
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";

/**
 * SLICE-230-7 DoD — full-flow e2e over the WIRED app:
 *   agent submits → post-commit hooks fire (TG notify + §17.3
 *   metrics) → operator lifecycle → advisory public projection →
 *   knowledge-draft conversion.
 * TG is captured by stubbing global fetch (no network); metrics are
 * read back from the real prom registry.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-230-e2e";
process.env.DATABASE_ENABLED = "off";
process.env.ADMIN_API_KEY = "test-admin-key";
process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "test-chat";

let tgCalls: { url: string; body: string }[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetIdempotencyStore();
  resetDatabaseForTests();
  tgCalls = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    tgCalls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

let n = 0;
const key = (p: string) => `${p}-${Date.now()}-${n++}-padpad`;
const ip = (x: number) => ({ "fly-client-ip": `10.70.${x}.1` });

const postJson = (
  app: Hono,
  path: string,
  body: unknown,
  k: string,
) =>
  app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": k,
      ...ip(n),
    },
    body: JSON.stringify(body),
  });

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("full flow e2e (wired app)", () => {
  it("feedback → triage → accept → convert; TG + metrics fire", async () => {
    const app = new Hono();
    wireFeedbackReview(app);

    // agent submits feedback
    const r = await postJson(
      app,
      "/api/v1/agent/feedback",
      { text: "the x402 settle example 404s", kind: "BUG", target: "docs" },
      key("fb"),
    );
    expect(r.status).toBe(202);
    const { id } = (await r.json()) as { id: string };

    // post-commit hook → TG notify with excerpt + admin link
    await tick();
    expect(tgCalls).toHaveLength(1);
    const tgBody = JSON.parse(tgCalls[0]!.body) as { text: string };
    expect(tgBody.text).toContain("New agent feedback");
    expect(tgBody.text).toContain(id);
    expect(tgBody.text).toContain("x402 settle example");
    expect(tgBody.text).toContain("/admin/review-center/feedback/");

    // public poll — RECEIVED, no operator fields
    const poll = await app.request(`/api/v1/agent/feedback/${id}`);
    expect((await poll.json()).status).toBe("RECEIVED");

    // operator lifecycle on the wired store
    const store = pickFeedbackStore(getDatabase());
    await triageFeedback(store, id, { severity: "HIGH" }, "ops_e2e");
    await resolveFeedback(store, id, "ACCEPTED", "ops_e2e");
    const after = await app.request(`/api/v1/agent/feedback/${id}`);
    expect((await after.json()).status).toBe("ACCEPTED");

    // convert → knowledge DRAFT in the same seam the admin UI reads
    const port = knowledgeDraftPort(pickKnowledgeStores(getDatabase()));
    const conv = await convertFeedbackToDraft(store, port, id, "ops_e2e");
    if (!conv.ok) throw new Error(conv.error);
    const item = await pickKnowledgeStores(getDatabase()).getItem(
      conv.knowledgeItemId,
    );
    expect(item?.status).toBe("DRAFT");

    // §17.3 metrics in the real registry
    const m = await registry.metrics();
    expect(m).toContain("agentbadge_feedback_received_total");
    expect(m).toContain("agentbadge_knowledge_conversions_total");
  });

  it("review → evidence → decide → advisory projection; metrics fire", async () => {
    const app = new Hono();
    wireFeedbackReview(app);

    const r = await postJson(
      app,
      "/api/v1/agent/reviews",
      {
        reviewType: "DOCS",
        workRef: "https://docs.example.org/guide",
        agentCriteria: ["check the curl examples"],
        evidence: [
          {
            type: "EXTERNAL_URL",
            uri: "https://docs.example.org/guide",
            label: "guide",
          },
        ],
      },
      key("rv"),
    );
    expect(r.status).toBe(202);
    const { id, statusUrl } = (await r.json()) as {
      id: string;
      statusUrl: string;
    };
    expect(statusUrl).toContain(`/api/v1/agent/reviews/${id}`);

    await tick();
    const tgBody = JSON.parse(tgCalls[0]!.body) as { text: string };
    expect(tgBody.text).toContain("New review request");
    expect(tgBody.text).toContain("DOCS");

    const store = pickReviewStore(getDatabase());
    await claimReview(store, id, "ops_e2e");
    const d = await decideReview(
      store,
      id,
      {
        outcome: "APPROVED",
        summary: "examples verified against v2",
        criteriaResults: criteriaForReview("DOCS").map((c) => ({
          key: c.key,
          result: "PASS",
        })),
      },
      "ops_e2e",
    );
    if (!d.ok) throw new Error(d.error);

    // agent-facing projection — advisory, no operator internals
    const poll = await app.request(`/api/v1/agent/reviews/${id}`);
    const proj = (await poll.json()) as Record<string, unknown>;
    expect(proj.status).toBe("DECIDED");
    const decision = proj.decision as Record<string, unknown>;
    expect(decision.binding).toBe("ADVISORY_HUMAN");
    expect(decision.decidedBy).toBe("OPERATOR");
    expect(decision.outcome).toBe("APPROVED");
    expect(decision.summary).toBe("examples verified against v2");
    expect(JSON.stringify(proj)).not.toContain("ops_e2e");
    expect(proj.assignee).toBeUndefined();

    // decide metric + duration observe land post-commit
    await tick();
    const m = await registry.metrics();
    expect(m).toContain("agentbadge_reviews_submitted_total");
    expect(m).toContain("agentbadge_reviews_decided_total");
    expect(m).toContain('outcome="APPROVED"');
    expect(m).toContain("agentbadge_review_duration_seconds");
    expect(m).toContain("agentbadge_review_pending");
  });
});
