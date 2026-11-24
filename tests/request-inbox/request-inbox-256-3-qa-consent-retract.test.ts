import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentRequestRoutes } from "../../src/server/routes/agent-requests/agent-requests-api";
import { createAgentRequestOpsRoutes } from "../../src/server/routes/agent-requests/agent-requests-ops-api";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import { transitionWithQa } from "../../src/server/lib/request-inbox/qa";
import {
  normalizeQuestion,
  questionHashFor,
} from "../../src/server/lib/request-inbox/fingerprint";
import type { SubmitInput } from "../../src/server/lib/request-inbox/store";

/**
 * EPIC-256 (SLICE-256-3): QA publish-consent + ops retract + provenance.
 *  - D-256-Q13: publish_to_qa opt-in (default false) — completed rows
 *    materialize into the public corpus ONLY with consent.
 *  - D-256-Q14: soft retract (audit kept), idempotent; retracted pairs
 *    are excluded from /qa search AND the intake fast-path; new pairs
 *    mint public qa_<uuid> ids (bearer request_id never leaks).
 *  - D-256-Q15: fast-path response carries qa_match provenance.
 *  - D-256-Q16: GET /:id exposes created_at/expires_at/retry_after.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
const ADMIN = "test-admin-key";
process.env.ADMIN_API_KEY = ADMIN;

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

async function mkApp() {
  const stores = createMemoryRequestInboxStores();
  const opStore = createMemoryOperatorStore();
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.route(
    "/",
    createAgentRequestRoutes({ stores, env: ENV, submitMax: 100 }),
  );
  app.route(
    "/",
    createAgentRequestOpsRoutes({ stores, operatorStore: opStore }),
  );
  // 264-8: ops surface rides a real opk_ credential.
  const { key } = await seedOperator(opStore);
  return { app, stores, opsHeaders: { "X-Admin-Key": key } };
}

const post = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  body: unknown,
) =>
  app.request("/api/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const respond = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  opsHeaders: Record<string, string>,
  id: string,
  body: unknown,
) =>
  app.request(`/api/ops/requests/${id}/respond`, {
    method: "POST",
    headers: { "content-type": "application/json", ...opsHeaders },
    body: JSON.stringify(body),
  });

const setState = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  opsHeaders: Record<string, string>,
  id: string,
  state: string,
) =>
  app.request(`/api/ops/requests/${id}/state`, {
    method: "POST",
    headers: { "content-type": "application/json", ...opsHeaders },
    body: JSON.stringify({ state }),
  });

const mkSubmit = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  id: `rq_${Math.random().toString(16).slice(2)}`,
  state: "submitted",
  kind: "question",
  payload: { prompt: "consent test question?" },
  fingerprint: { ip: null, ua: "a/1", referer: null, src: null, headers: {} },
  fpHash: `fp_${Math.random().toString(16).slice(2)}`,
  expiresAtMs: Date.now() + 60_000,
  ...over,
});

// ── D-256-Q13: publish-consent gate ──────────────────────────────
describe("publish-consent gate (D-256-Q13)", () => {
  it("completed WITHOUT publish_to_qa → no QA pair materializes", async () => {
    const { app, stores, opsHeaders } = await mkApp();
    const p = await post(app, { payload: { prompt: "private question?" } });
    const { request_id } = await p.json();
    const { record } = await stores.requests.get(request_id);
    expect(record?.publishToQa).toBe(false); // privacy-safe default
    const resp = await respond(app, opsHeaders, request_id, { response: { a: 1 } });
    expect(resp.status).toBe(200);
    expect(await stores.requests.searchQa("private question", 10)).toHaveLength(0);
  });

  it("publish_to_qa=true persists + ops respond → pair with qa_<uuid> id", async () => {
    const { app, stores, opsHeaders } = await mkApp();
    const p = await post(app, {
      payload: { prompt: "public question?" },
      publish_to_qa: true,
    });
    const { request_id } = await p.json();
    const { record } = await stores.requests.get(request_id);
    expect(record?.publishToQa).toBe(true);
    await respond(app, opsHeaders, request_id, { response: { a: 1 } });
    const pairs = await stores.requests.searchQa("public question", 10);
    expect(pairs).toHaveLength(1);
    // public qa_id is a fresh uuid — NEVER derived from the bearer id.
    expect(pairs[0].id).toMatch(/^qa_[0-9a-f-]{32,36}$/);
    expect(pairs[0].id).not.toContain(request_id);
    expect(pairs[0].sourceRequestId).toBe(request_id); // internal only
  });

  it("spam_flag blocks materialization even with consent", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.submit(
      mkSubmit({ id: "rq_spam", publishToQa: true }),
    );
    await stores.requests.setSpamFlag("rq_spam", true);
    await transitionWithQa(stores.requests, "rq_spam", "submitted", {
      response: { a: 1 },
      respondedAtMs: Date.now(),
    });
    expect(await stores.requests.searchQa("consent test", 10)).toHaveLength(0);
  });

  it("consent but response==null → no pair (manual completed path)", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.submit(
      mkSubmit({ id: "rq_noresp", publishToQa: true }),
    );
    await transitionWithQa(stores.requests, "rq_noresp", "submitted", {
      respondedAtMs: Date.now(),
    });
    expect(await stores.requests.searchQa("consent test", 10)).toHaveLength(0);
  });

  it("manual state→completed with stored response + consent → pair (gate covers both callers)", async () => {
    const { app, stores, opsHeaders } = await mkApp();
    const p = await post(app, {
      payload: { prompt: "manual path question?" },
      publish_to_qa: true,
    });
    const { request_id } = await p.json();
    // respond with mark_completed:false → working + response stored
    await respond(app, opsHeaders, request_id, {
      response: { a: 2 },
      mark_completed: false,
    });
    // manual transition → completed — the gate lives inside
    // transitionWithQa, so this path materializes too.
    await setState(app, opsHeaders, request_id, "completed");
    expect(
      await stores.requests.searchQa("manual path question", 10),
    ).toHaveLength(1);
  });
});

// ── D-256-Q14: soft retract ──────────────────────────────────────
describe("QA retract (D-256-Q14)", () => {
  it("retractQaPair: soft — record + reason kept; idempotent; missing → null", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.upsertQaPair({
      id: "qa_deadbeef",
      questionHash: "h1",
      question: "retract me?",
      response: { a: 1 },
      sourceRequestId: "rq_src",
      createdAtMs: Date.now(),
    });
    const first = await stores.requests.retractQaPair("qa_deadbeef", "ops review");
    expect(first).not.toBeNull();
    expect(first!.retractedAtMs).not.toBeNull();
    expect(first!.retractReason).toBe("ops review");
    // repeat → same record, no error (first reason wins)
    const second = await stores.requests.retractQaPair("qa_deadbeef", "again");
    expect(second!.id).toBe("qa_deadbeef");
    expect(second!.retractedAtMs).toBe(first!.retractedAtMs);
    expect(second!.retractReason).toBe("ops review");
    expect(await stores.requests.retractQaPair("qa_missing", "x")).toBeNull();
  });

  it("retracted pair is excluded from searchQa AND getQaByHash", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.upsertQaPair({
      id: "qa_gone",
      questionHash: "h2",
      question: "hidden after retract?",
      response: { a: 1 },
      sourceRequestId: "rq_src",
      createdAtMs: Date.now(),
    });
    await stores.requests.retractQaPair("qa_gone", "ops");
    expect(await stores.requests.searchQa("hidden after retract", 10)).toHaveLength(0);
    expect(await stores.requests.getQaByHash("h2")).toBeNull();
  });

  it("POST /api/ops/requests/qa/:id/retract — auth, 404, idempotent 200", async () => {
    const { app, stores, opsHeaders } = await mkApp();
    await stores.requests.upsertQaPair({
      id: "qa_route",
      questionHash: "h3",
      question: "route retract?",
      response: { a: 1 },
      sourceRequestId: "rq_src",
      createdAtMs: Date.now(),
    });
    // no admin key → 401
    expect(
      (
        await app.request("/api/ops/requests/qa/qa_route/retract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "x" }),
        })
      ).status,
    ).toBe(401);
    // missing pair → 404
    expect(
      (
        await app.request("/api/ops/requests/qa/qa_missing/retract", {
          method: "POST",
          headers: { "content-type": "application/json", ...opsHeaders },
          body: JSON.stringify({ reason: "x" }),
        })
      ).status,
    ).toBe(404);
    // first retract → 200
    const first = await app.request("/api/ops/requests/qa/qa_route/retract", {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ reason: "stale answer" }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.qa_id).toBe("qa_route");
    // repeat → 200, same record (not 409/500)
    const second = await app.request("/api/ops/requests/qa/qa_route/retract", {
      method: "POST",
      headers: { "content-type": "application/json", ...opsHeaders },
      body: JSON.stringify({ reason: "again" }),
    });
    expect(second.status).toBe(200);
    expect((await second.json()).qa_id).toBe("qa_route");
  });

  it("retracted pair excluded from fast-path — same question creates a request", async () => {
    const { app, stores } = await mkApp();
    const question = "retract fast-path question?";
    const qHash = questionHashFor(normalizeQuestion(question));
    await stores.requests.upsertQaPair({
      id: "qa_fp",
      questionHash: qHash,
      question: normalizeQuestion(question),
      response: { a: 1 },
      sourceRequestId: "rq_src",
      createdAtMs: Date.now(),
    });
    await stores.requests.retractQaPair("qa_fp", "ops");
    const res = await post(app, { payload: { prompt: question } });
    expect(res.status).toBe(202); // NOT the 200 fast-path
    const body = await res.json();
    expect(body.request_id).toMatch(/^rq_/);
  });
});

// ── D-256-Q14/Q15: /qa response shape + fast-path provenance ─────
describe("QA response shape + provenance", () => {
  it("GET /api/requests/qa → qa_id/published_at/provenance; no sourceRequestId", async () => {
    const { app, stores } = await mkApp();
    const nowMs = Date.now();
    // legacy pair — id minted pre-gate as qa_{requestId}
    await stores.requests.upsertQaPair({
      id: "qa_rq_legacy1",
      questionHash: "lh",
      question: "legacy corpus entry",
      response: { a: 0 },
      sourceRequestId: "rq_legacy1",
      createdAtMs: nowMs - 1000,
    });
    // new-format pair (id = qa_<uuid> ≠ qa_{sourceRequestId})
    await stores.requests.upsertQaPair({
      id: "qa_abcdef0123456789abcdef0123456789",
      questionHash: "nh",
      question: "new corpus entry",
      response: { a: 1 },
      sourceRequestId: "rq_new1",
      createdAtMs: nowMs,
    });
    const res = await app.request("/api/requests/qa?q=corpus");
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.qa_id).toBeTruthy();
      expect(typeof r.published_at).toBe("number");
      expect(r.sourceRequestId).toBeUndefined(); // bearer id never leaks
      expect(r.source_request_id).toBeUndefined();
    }
    const legacy = results.find(
      (r: { qa_id: string }) => r.qa_id === "qa_rq_legacy1",
    );
    const fresh = results.find(
      (r: { qa_id: string }) =>
        r.qa_id === "qa_abcdef0123456789abcdef0123456789",
    );
    expect(legacy.provenance).toBe("legacy");
    expect(fresh.provenance).toBe("ops_answered");
  });

  it("fast-path hit → qa_match provenance + request_created:false", async () => {
    const { app, stores } = await mkApp();
    const question = "provenance fast-path question?";
    const qHash = questionHashFor(normalizeQuestion(question));
    const publishedAt = Date.now() - 5000;
    await stores.requests.upsertQaPair({
      id: "qa_00112233445566778899aabbccddeeff",
      questionHash: qHash,
      question: normalizeQuestion(question),
      response: { a: 42 },
      sourceRequestId: "rq_src",
      createdAtMs: publishedAt,
    });
    const res = await post(app, { payload: { prompt: question } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_created).toBe(false);
    expect(body.qa_match).toEqual({
      qa_id: "qa_00112233445566778899aabbccddeeff",
      match_method: "normalized_exact_hash",
      published_at: publishedAt,
      source: "public_qa",
    });
  });
});

// ── D-256-Q16: GET /:id lifecycle fields ─────────────────────────
describe("GET /api/requests/:id lifecycle fields (D-256-Q16)", () => {
  it("202 pending → created_at/expires_at/retry_after; 200 completed → same fields", async () => {
    const { app, stores } = await mkApp();
    const expiresAtMs = Date.now() + 60_000;
    await stores.requests.submit(
      mkSubmit({ id: "rq_life", expiresAtMs }),
    );
    let res = await app.request("/api/requests/rq_life");
    expect(res.status).toBe(202);
    let body = await res.json();
    expect(typeof body.created_at).toBe("number");
    expect(body.expires_at).toBe(expiresAtMs);
    expect(body.retry_after).toBeGreaterThan(0);

    await stores.requests.transition("rq_life", "submitted", "completed", {
      response: { done: true },
    });
    res = await app.request("/api/requests/rq_life");
    expect(res.status).toBe(200);
    body = await res.json();
    expect(typeof body.created_at).toBe("number");
    expect(body.expires_at).toBe(expiresAtMs);
    expect("retry_after" in body).toBe(true);
  });
});
