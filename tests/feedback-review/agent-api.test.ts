import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";

import { createAgentFeedbackRoutes } from "../../src/server/routes/feedback-review/agent-feedback-api";
import { createAgentReviewsRoutes } from "../../src/server/routes/feedback-review/agent-reviews-api";
import {
  createMemoryFeedbackData,
  createMemoryFeedbackStore,
} from "../../src/server/lib/feedback/store-memory";
import {
  createMemoryReviewData,
  createMemoryReviewStore,
} from "../../src/server/lib/reviews/store-memory";
import {
  triageFeedback,
  resolveFeedback,
} from "../../src/server/lib/feedback/workflow";
import { claimReview } from "../../src/server/lib/reviews/workflow";
import { decideReview } from "../../src/server/lib/reviews/decide";
import { criteriaForReview } from "../../src/server/lib/reviews/criteria";
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";

/**
 * SLICE-230-4 e2e — public feedback/review routes over memory
 * backends: anon/key submits, idempotent replay, schema/cap guards,
 * tenant isolation, advisory projections and evidence dosylka.
 * DID-verify itself lives in did-auth's suite — the shim pre-sets
 * identity headers like an upstream verifier would.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-230";

function mkApp() {
  const feedback = createMemoryFeedbackStore(createMemoryFeedbackData());
  const reviews = createMemoryReviewStore(createMemoryReviewData());
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use((c, next) => {
    const agent = c.req.header("x-test-agent");
    if (agent) {
      c.set("agentId", agent);
      c.set("agentTier", "observer");
    }
    const did = c.req.header("x-test-verified-did");
    if (did) c.set("verifiedDid", did);
    return next();
  });
  app.route("/", createAgentFeedbackRoutes({ store: feedback }));
  app.route("/", createAgentReviewsRoutes({ store: reviews }));
  return { app, feedback, reviews };
}

const post = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const KEY = (k: string) => ({
  // schema min is 8 — pad short test keys deterministically
  "idempotency-key": k.padEnd(8, "-"),
});
const IP = (ip: string) => ({ "fly-client-ip": ip });
const AGENT = (id: string) => ({ "x-test-agent": id });

beforeEach(() => resetIdempotencyStore());

describe("POST /api/v1/agent/feedback", () => {
  it("anon submit → 202 {id,statusUrl} → poll RECEIVED", async () => {
    const { app } = mkApp();
    const r = await post(
      app,
      "/api/v1/agent/feedback",
      { text: "docs are broken" },
      { ...KEY("fb-1"), ...IP("10.1.1.1") },
    );
    expect(r.status).toBe(202);
    const j = await r.json();
    expect(j.id).toMatch(/^fb_/);
    expect(j.statusUrl).toBe(`/api/v1/agent/feedback/${j.id}`);
    expect(r.headers.get("location")).toBe(j.statusUrl);

    const poll = await app.request(j.statusUrl);
    expect(poll.status).toBe(200);
    const pj = await poll.json();
    expect(pj.status).toBe("RECEIVED");
    expect(pj.text).toBeUndefined(); // projection never leaks raw text
  });

  it("missing idempotency-key → 400", async () => {
    const { app } = mkApp();
    const r = await post(app, "/api/v1/agent/feedback", { text: "x" }, IP("10.1.1.2"));
    expect(r.status).toBe(400);
  });

  it("replay → 200 duplicate:true, no second row", async () => {
    const { app, feedback } = mkApp();
    const h = { ...KEY("fb-dup"), ...IP("10.1.1.3") };
    await post(app, "/api/v1/agent/feedback", { text: "x" }, h);
    const r = await post(app, "/api/v1/agent/feedback", { text: "x" }, h);
    expect(r.status).toBe(200);
    expect((await r.json()).duplicate).toBe(true);
    expect(await feedback.listFeedback()).toHaveLength(1);
  });

  it("replay with different body → 422; different actor → 409", async () => {
    const { app } = mkApp();
    await post(app, "/api/v1/agent/feedback", { text: "x" },
      { ...KEY("fb-mm"), ...AGENT("agt_a") });
    const diff = await post(app, "/api/v1/agent/feedback", { text: "y" },
      { ...KEY("fb-mm"), ...AGENT("agt_a") });
    expect(diff.status).toBe(422);
    // Arc 230-8 M1: idempotency is actor-scoped — a different actor
    // reusing the same key mints a NEW row, not a 409.
    const foreign = await post(app, "/api/v1/agent/feedback", { text: "x" },
      { ...KEY("fb-mm"), ...AGENT("agt_b") });
    expect(foreign.status).toBe(202);
  });

  it("invalid body → 400 with field hint; unknown kind → 400", async () => {
    const { app } = mkApp();
    const r = await post(app, "/api/v1/agent/feedback",
      { text: "x", kind: "NOPE" }, { ...KEY("fb-bad"), ...IP("10.1.1.4") });
    expect(r.status).toBe(400);
  });

  it("typed fields + suggestion appear in the projection", async () => {
    const { app, feedback } = mkApp();
    const r = await post(app, "/api/v1/agent/feedback",
      { text: "add webhooks", kind: "FEATURE", target: "api" },
      { ...KEY("fb-typed"), ...IP("10.1.1.5") });
    const { id } = await r.json();
    await triageFeedback(feedback, id, { suggestion: "on the roadmap" }, "ops:a");
    await resolveFeedback(feedback, id, "ACCEPTED", "ops:a");
    const poll = await app.request(`/api/v1/agent/feedback/${id}`);
    const pj = await poll.json();
    expect(pj.status).toBe("ACCEPTED");
    expect(pj.suggestion).toBe("on the roadmap");
  });

  it("tenant isolation — api-key-owned row is 404 to others", async () => {
    const { app } = mkApp();
    const r = await post(app, "/api/v1/agent/feedback", { text: "mine" },
      { ...KEY("fb-tenant"), ...AGENT("agt_owner") });
    const { id } = await r.json();
    const own = await app.request(`/api/v1/agent/feedback/${id}`,
      { headers: AGENT("agt_owner") });
    expect(own.status).toBe(200);
    const foreign = await app.request(`/api/v1/agent/feedback/${id}`,
      { headers: AGENT("agt_other") });
    expect(foreign.status).toBe(404);
    const anon = await app.request(`/api/v1/agent/feedback/${id}`);
    expect(anon.status).toBe(404);
  });

  it("ANON tier rate limit → 429 after 3/min", async () => {
    const { app } = mkApp();
    const h = IP("10.9.9.9");
    for (let i = 0; i < 3; i++) {
      const r = await post(app, "/api/v1/agent/feedback", { text: "x" },
        { ...KEY(`fb-rl-${i}`), ...h });
      expect(r.status).toBe(202);
    }
    const over = await post(app, "/api/v1/agent/feedback", { text: "x" },
      { ...KEY("fb-rl-over"), ...h });
    expect(over.status).toBe(429);
  });
});

describe("POST /api/v1/agent/reviews", () => {
  const BODY = {
    reviewType: "DOCS",
    workRef: "https://docs.example.com/guide",
    agentCriteria: ["check the examples"],
  };

  it("submit → 202 → poll PENDING_TRIAGE with advisory fields", async () => {
    const { app } = mkApp();
    const r = await post(app, "/api/v1/agent/reviews", BODY,
      { ...KEY("rv-1"), ...IP("10.2.2.1") });
    expect(r.status).toBe(202);
    const j = await r.json();
    const poll = await app.request(j.statusUrl);
    const pj = await poll.json();
    expect(pj.status).toBe("PENDING_TRIAGE");
    expect(pj.reviewType).toBe("DOCS");
    expect(pj.decision).toBeUndefined();
  });

  it("invalid workRef → 400", async () => {
    const { app } = mkApp();
    const r = await post(app, "/api/v1/agent/reviews",
      { ...BODY, workRef: "not a uri" }, { ...KEY("rv-bad"), ...IP("10.2.2.2") });
    expect(r.status).toBe(400);
  });

  it("replay → 200 duplicate:true", async () => {
    const { app } = mkApp();
    const h = { ...KEY("rv-dup"), ...IP("10.2.2.3") };
    await post(app, "/api/v1/agent/reviews", BODY, h);
    const r = await post(app, "/api/v1/agent/reviews", BODY, h);
    expect(r.status).toBe(200);
    expect((await r.json()).duplicate).toBe(true);
  });

  it("decision is projected with ADVISORY_HUMAN + OPERATOR markers", async () => {
    const { app, reviews } = mkApp();
    const r = await post(app, "/api/v1/agent/reviews",
      { reviewType: "DOCS", workRef: "https://docs.example.com" },
      { ...KEY("rv-dec"), ...IP("10.2.2.4") });
    const { id } = await r.json();
    await claimReview(reviews, id, "ops:alice");
    await decideReview(reviews, id, {
      outcome: "APPROVED",
      summary: "docs verified",
      criteriaResults: criteriaForReview("DOCS").map((c) => ({
        key: c.key,
        result: "PASS",
      })),
    }, "ops:alice");
    const poll = await app.request(`/api/v1/agent/reviews/${id}`);
    const pj = await poll.json();
    expect(pj.status).toBe("DECIDED");
    expect(pj.decision.binding).toBe("ADVISORY_HUMAN");
    expect(pj.decision.decidedBy).toBe("OPERATOR");
    expect(JSON.stringify(pj)).not.toContain("ops:alice");
  });
});

describe("POST /api/v1/agent/reviews/:id/evidence", () => {
  const seed = async (app: Hono<{ Variables: Record<string, unknown> }>) => {
    const r = await post(app, "/api/v1/agent/reviews",
      { reviewType: "API_SURFACE", workRef: "https://api.example.com" },
      { ...KEY("rv-ev-seed"), ...IP("10.3.3.1") });
    return (await r.json()).id as string;
  };

  it("appends AGENT evidence while PENDING_TRIAGE", async () => {
    const { app, reviews } = mkApp();
    const id = await seed(app);
    const r = await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "EXTERNAL_URL", uri: "https://proof.example.com" }] },
      { ...KEY("ev-1"), ...IP("10.3.3.2") });
    expect(r.status).toBe(200);
    expect((await r.json()).added).toBe(1);
    const ev = await reviews.listEvidence(id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.submittedBy).toBe("AGENT");
  });

  it("replay returns stored body with duplicate:true", async () => {
    const { app, reviews } = mkApp();
    const id = await seed(app);
    const h = { ...KEY("ev-dup"), ...IP("10.3.3.3") };
    await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "OTHER", uri: "internal:x" }] }, h);
    const r = await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "OTHER", uri: "internal:x" }] }, h);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.duplicate).toBe(true);
    expect(await reviews.listEvidence(id)).toHaveLength(1);
  });

  it("same key + different body → 422 conflict", async () => {
    const { app } = mkApp();
    const id = await seed(app);
    const h = { ...KEY("ev-conf"), ...IP("10.3.3.4") };
    await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "OTHER", uri: "internal:a" }] }, h);
    const r = await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "OTHER", uri: "internal:b" }] }, h);
    expect(r.status).toBe(422);
  });

  it("blocked once claimed (not_editable → 409)", async () => {
    const { app, reviews } = mkApp();
    const id = await seed(app);
    await claimReview(reviews, id, "ops:alice");
    const r = await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "OTHER", uri: "internal:x" }] },
      { ...KEY("ev-late"), ...IP("10.3.3.5") });
    expect(r.status).toBe(409);
  });

  it("unknown review id → 404; bad evidence uri → 400", async () => {
    const { app } = mkApp();
    const missing = await post(app, "/api/v1/agent/reviews/rv_none/evidence",
      { evidence: [{ type: "OTHER", uri: "internal:x" }] },
      { ...KEY("ev-miss"), ...IP("10.3.3.6") });
    expect(missing.status).toBe(404);
    const id = await seed(app);
    const bad = await post(app, `/api/v1/agent/reviews/${id}/evidence`,
      { evidence: [{ type: "EXTERNAL_URL", uri: "http://169.254.1.1/x" }] },
      { ...KEY("ev-uri"), ...IP("10.3.3.7") });
    expect(bad.status).toBe(400);
  });
});
