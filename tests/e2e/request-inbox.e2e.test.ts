import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentRequestRoutes } from "../../src/server/routes/agent-requests-api";
import { createAgentRequestOpsRoutes } from "../../src/server/routes/agent-requests-ops-api";
import { createAgentSurveyRoutes } from "../../src/server/routes/agent-surveys-api";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import { collectStats, formatTextReport } from "../../src/server/lib/report/traffic-format";
import type { ReputationWriteRecord } from "../../src/server/lib/board/types";

/**
 * EPIC-252 (SLICE-252-6): e2e-верификация полного цикла —
 * intake → ops-pull → respond → poll completed; survey open →
 * answer → rated; idempotent replay; 410 expiry; 429 rate-limit.
 * + traffic digest считает новые пути (EPIC-217 pipeline).
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
const ADMIN = "test-admin-key";
process.env.ADMIN_API_KEY = ADMIN;
const ops = { "X-Admin-Key": ADMIN };

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

function mkApp(opts: { now?: () => number; submitMax?: number } = {}) {
  const stores = createMemoryRequestInboxStores();
  const rep: ReputationWriteRecord[] = [];
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use((c, next) => {
    const agent = c.req.header("x-test-agent");
    if (agent) c.set("agentId", agent);
    return next();
  });
  app.route(
    "/",
    createAgentRequestRoutes({
      stores,
      env: ENV,
      now: opts.now,
      submitMax: opts.submitMax ?? 100,
    }),
  );
  app.route("/", createAgentRequestOpsRoutes({ stores, now: opts.now }));
  app.route(
    "/",
    createAgentSurveyRoutes({
      stores,
      env: ENV,
      now: opts.now,
      writeReputation: (r: ReputationWriteRecord) => {
        rep.push(r);
      },
    }),
  );
  return { app, stores, rep };
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

describe("request → respond → poll cycle (SLICE-252-6)", () => {
  it("POST → ops-pull → respond → GET completed; idempotent replay; 410; 429", async () => {
    const { app } = mkApp();

    // 1. Intake — verified agent submits.
    const intake = await post(
      app,
      "/api/requests",
      { payload: { prompt: "what is agentbadge?" } },
      { "x-test-agent": "agent-e2e", "Idempotency-Key": "e2e-key-1" },
    );
    expect(intake.status).toBe(202);
    const { request_id } = await intake.json();
    expect(request_id).toMatch(/^rq_/);

    // Idempotent replay — same key returns the SAME request, no new row.
    const replay = await post(
      app,
      "/api/requests",
      { payload: { prompt: "what is agentbadge?" } },
      { "x-test-agent": "agent-e2e", "Idempotency-Key": "e2e-key-1" },
    );
    expect(replay.status).toBe(202);
    expect((await replay.json()).request_id).toBe(request_id);

    // 2. Ops pulls pending queue.
    const pull = await app.request("/api/ops/requests?state=submitted", {
      headers: ops,
    });
    expect(pull.status).toBe(200);
    const queue = await pull.json();
    expect(queue.items.some((r: { id: string }) => r.id === request_id)).toBe(
      true,
    );

    // 3. Ops responds → completed.
    const respond = await post(
      app,
      `/api/ops/requests/${request_id}/respond`,
      { response: { answer: "AgentBadge is an agent-readiness platform." } },
      ops,
    );
    expect(respond.status).toBe(200);

    // 4. Agent polls → 200 + response.
    const done = await app.request(`/api/requests/${request_id}`);
    expect(done.status).toBe(200);
    const doneBody = await done.json();
    expect(doneBody.state).toBe("completed");
    expect(doneBody.response.answer).toContain("AgentBadge");

    // 5. 410 — expired request (injected clock crosses TTL).
    let t = 1_000_000;
    const { app: clockApp } = mkApp({ now: () => t });
    const r2 = await post(clockApp, "/api/requests", {
      payload: { prompt: "soon-expired" },
    });
    const { request_id: oldId } = await r2.json();
    t += ENV.requestTtlMs + 1; // clock past TTL — do NOT retry
    expect((await clockApp.request(`/api/requests/${oldId}`)).status).toBe(410);

    // 6. 429 — submit rate-limit per fingerprint (landmine: isolate lane).
    const { app: tightApp } = mkApp({ submitMax: 1 });
    await post(
      tightApp,
      "/api/requests",
      { payload: { prompt: "first" } },
      { "fly-client-ip": "9.9.9.9" },
    );
    const limited = await post(
      tightApp,
      "/api/requests",
      { payload: { prompt: "second same lane" } },
      { "fly-client-ip": "9.9.9.9" },
    );
    expect(limited.status).toBe(429);
  });
});

describe("survey → rating cycle (SLICE-252-6)", () => {
  it("ops create → open list → verified answer rated → dedupe → closed 410", async () => {
    const { app, rep } = mkApp();

    // 1. Ops creates a survey.
    const created = await post(
      app,
      "/api/ops/surveys",
      { title: "E2E satisfaction", questions: [{ q: "How?", k: "how" }] },
      ops,
    );
    expect(created.status).toBe(201);
    const survey = await created.json();

    // 2. Visible on the public open list.
    const open = await app.request("/api/surveys/open");
    const { items } = await open.json();
    expect(items.some((s: { id: string }) => s.id === survey.id)).toBe(true);

    // 3. Verified answer → rated + milestone write.
    const ans = await post(
      app,
      `/api/surveys/${survey.id}/answer`,
      { answers: { how: "smooth" } },
      { "x-test-agent": "agent-e2e" },
    );
    expect(ans.status).toBe(202);
    expect((await ans.json()).rated).toBe(true);
    expect(rep).toHaveLength(1);
    expect(rep[0].status).toBe("skipped"); // milestone counter, no mint
    expect(rep[0].payload).toMatchObject({ metric: "answers_rated_count" });

    // 4. Repeat → dedupe 409, no second credit.
    const dup = await post(
      app,
      `/api/surveys/${survey.id}/answer`,
      { answers: { how: "again" } },
      { "x-test-agent": "agent-e2e" },
    );
    expect(dup.status).toBe(409);
    expect(rep).toHaveLength(1);

    // 5. Closed survey → 410.
    const closed = await post(
      app,
      "/api/ops/surveys",
      { title: "closed", questions: [], closesAtMs: Date.now() - 1 },
      ops,
    );
    const { id: closedId } = await closed.json();
    expect(
      (await post(app, `/api/surveys/${closedId}/answer`, { answers: {} }))
        .status,
    ).toBe(410);
  });
});

describe("traffic digest counts new lanes (SLICE-252-6)", () => {
  it("/api/requests* + /api/surveys* appear in top-paths + client→path", () => {
    const created = new Date().toISOString();
    const rows = [
      // Agent client on the new inbox + survey lanes.
      ...Array.from({ length: 12 }, () => ({
        payload: { method: "POST", path: "/api/requests", status: 202, ua: "CoolAgent/1.0" },
        createdAt: created,
      })),
      ...Array.from({ length: 10 }, () => ({
        payload: { method: "GET", path: "/api/requests/rq_abc", status: 200, ua: "CoolAgent/1.0" },
        createdAt: created,
      })),
      ...Array.from({ length: 8 }, () => ({
        payload: { method: "POST", path: "/api/surveys/sv_1/answer", status: 202, ua: "CoolAgent/1.0" },
        createdAt: created,
      })),
      // Noise on an unrelated surface so top-N isn't trivially all new lanes.
      ...Array.from({ length: 3 }, () => ({
        payload: { method: "GET", path: "/blog", status: 200, ua: "Mozilla/5.0" },
        createdAt: created,
      })),
    ];
    const stats = collectStats(rows, 24);
    expect(stats.byPath.get("/api/requests")).toBe(12);
    expect(stats.byPath.get("/api/surveys/sv_1/answer")).toBe(8);
    expect([...stats.byPathUa.keys()].some((k) => k.includes("/api/requests"))).toBe(
      true,
    );
    const report = formatTextReport(stats);
    expect(report).toContain("/api/requests");
    expect(report).toContain("/api/surveys/sv_1/answer");
  });
});
