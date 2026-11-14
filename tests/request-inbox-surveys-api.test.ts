import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { createAgentSurveyRoutes } from "../src/server/routes/agent-surveys-api";
import { createMemoryRequestInboxStores } from "../src/server/lib/request-inbox/db-stores";
import type { ReputationWriteRecord } from "../src/server/lib/board/types";

/**
 * EPIC-252 (SLICE-252-4, D-252-Q6): surveys → rating lane —
 * open list (public), answer (verified → ReputationWrite namespace
 * `surveys`, metric answers_rated_count; anon → accepted unrated),
 * ops-create. Dedupe: (surveyId,agentId) verified / (surveyId,fpHash)
 * anon. Passport NOT minted — milestone counter only.
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-inbox";
const ADMIN = "test-admin-key";
process.env.ADMIN_API_KEY = ADMIN;

const ENV = {
  fingerprintSalt: "test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

function mkApp(now: () => number = () => Date.now()) {
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
    createAgentSurveyRoutes({
      stores,
      env: ENV,
      now,
      writeReputation: (r: ReputationWriteRecord) => {
        rep.push(r);
      },
    }),
  );
  return { app, stores, rep };
}

const opsHeaders = { "X-Admin-Key": ADMIN };

const createSurvey = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  body: unknown,
) =>
  app.request("/api/ops/surveys", {
    method: "POST",
    headers: { "content-type": "application/json", ...opsHeaders },
    body: JSON.stringify(body),
  });

const answer = (
  app: Hono<{ Variables: Record<string, unknown> }>,
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(`/api/surveys/${id}/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const SV = { title: "Satisfaction", questions: [{ q: "How?", k: "how" }] };

describe("ops create + open list (SLICE-252-4)", () => {
  it("POST /api/ops/surveys requires admin; creates active survey", async () => {
    const { app } = mkApp();
    const anon = await app.request("/api/ops/surveys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SV),
    });
    expect(anon.status).toBe(401);
    const res = await createSurvey(app, { ...SV, closesAtMs: Date.now() + 60_000 });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^sv_/);
    expect(body.active).toBe(true);
  });

  it("GET /api/surveys/open — active only; closed/inactive hidden", async () => {
    const { app, stores } = mkApp();
    const a = await (await createSurvey(app, SV)).json();
    await createSurvey(app, { ...SV, title: "closed", closesAtMs: Date.now() - 1 });
    const b = await (await createSurvey(app, { ...SV, title: "inactive" })).json();
    await stores.surveys.setSurveyActive(b.id, false);
    const res = await app.request("/api/surveys/open");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(a.id);
    expect(body.items[0].title).toBe("Satisfaction");
    expect(body.items[0].questions).toEqual(SV.questions);
  });
});

describe("answer → rating (SLICE-252-4)", () => {
  it("verified agent → accepted + rated:true + ReputationWrite(surveys)", async () => {
    const { app, rep } = mkApp();
    const { id } = await (await createSurvey(app, SV)).json();
    const res = await answer(app, id, { answers: { how: "great" } }, {
      "x-test-agent": "agent-1",
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(true);
    expect(body.rated).toBe(true);
    expect(rep).toHaveLength(1);
    expect(rep[0].sourceType).toBe("surveys");
    expect(rep[0].sourceId).toBe(`${id}:agent-1`);
    expect(rep[0].agentId).toBe("agent-1");
    expect(rep[0].status).toBe("skipped"); // milestone counter — no onchain
    expect(rep[0].payload).toMatchObject({
      metric: "answers_rated_count",
      milestone: true,
      surveyId: id,
    });
  });

  it("anon → accepted + rated:false, no ReputationWrite", async () => {
    const { app, rep } = mkApp();
    const { id } = await (await createSurvey(app, SV)).json();
    const res = await answer(app, id, { answers: { how: "meh" } });
    expect(res.status).toBe(202);
    expect((await res.json()).rated).toBe(false);
    expect(rep).toHaveLength(0);
  });

  it("dedupe: verified repeat → 409; anon same fpHash → 409; new ip → accepted", async () => {
    const { app } = mkApp();
    const { id } = await (await createSurvey(app, SV)).json();
    await answer(app, id, { answers: { q1: "x" } }, { "x-test-agent": "a9" });
    const dup = await answer(app, id, { answers: { q1: "x" } }, { "x-test-agent": "a9" });
    expect(dup.status).toBe(409);
    // anon: same ip+ua+salt → same fpHash → 409
    await answer(app, id, { answers: { q1: "x" } }, { "fly-client-ip": "1.2.3.4" });
    const dup2 = await answer(app, id, { answers: { q1: "x" } }, { "fly-client-ip": "1.2.3.4" });
    expect(dup2.status).toBe(409);
    // different ip → different fpHash → accepted
    const ok = await answer(app, id, { answers: { q1: "x" } }, { "fly-client-ip": "5.6.7.8" });
    expect(ok.status).toBe(202);
    // different agent on new survey → new rated write allowed
    const { id: id2 } = await (await createSurvey(app, SV)).json();
    const ok2 = await answer(app, id2, { answers: { q1: "x" } }, { "x-test-agent": "a9" });
    expect(ok2.status).toBe(202);
  });

  it("closed survey → 410; missing → 404", async () => {
    const { app } = mkApp();
    const { id } = await (
      await createSurvey(app, { ...SV, closesAtMs: Date.now() - 1000 })
    ).json();
    const closed = await answer(app, id, { answers: { q1: "x" } });
    expect(closed.status).toBe(410);
    const miss = await answer(app, "sv_nope", { answers: { q1: "x" } });
    expect(miss.status).toBe(404);
  });
});
