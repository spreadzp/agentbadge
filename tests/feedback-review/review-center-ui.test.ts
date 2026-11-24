import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";

import { createReviewCenter } from "../../src/server/routes/feedback-review/review-center";
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
import { resetIdempotencyStore } from "../../src/server/lib/contract-guards";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import { knowledgeDraftPort } from "../../src/server/lib/knowledge-draft/port";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

/**
 * SLICE-230-5 DoD — Review Center SSR smoke over the memory backend.
 * Auth = HTTP Basic (264-8: password is the seeded opk_ credential —
 * the actor on every mutation is the credential principal.id, never
 * a form field). Every mutation POST needs a single-use formToken
 * extracted from the rendered detail page (229 lesson — tokens are
 * render-minted, consumed once).
 */

process.env.FLY_APP_NAME = process.env.FLY_APP_NAME || "test-230-ui";

beforeEach(() => resetIdempotencyStore());

let basic = "";
const FORM = "application/x-www-form-urlencoded";

async function mkApp() {
  const opStore = createMemoryOperatorStore();
  const { key, operatorId } = await seedOperator(opStore, "Ops");
  basic = `Basic ${Buffer.from(`ops:${key}`).toString("base64")}`;
  const stores = {
    feedback: createMemoryFeedbackStore(createMemoryFeedbackData()),
    reviews: createMemoryReviewStore(createMemoryReviewData()),
    draftPort: knowledgeDraftPort(createMemoryKnowledgeStores()),
  };
  const app = new Hono();
  app.route("/", createAgentFeedbackRoutes({ store: stores.feedback }));
  app.route("/", createAgentReviewsRoutes({ store: stores.reviews }));
  app.route("/", createReviewCenter({ stores, operatorStore: opStore }));
  return { app, stores, operatorId };
}

let n = 0;
const idem = (p: string) => `${p}-${Date.now()}-${n++}-padpad`;

const submitFeedback = async (app: Hono, text: string) => {
  const r = await app.request("/api/v1/agent/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idem("fb"),
      "fly-client-ip": `10.60.${n}.1`,
    },
    body: JSON.stringify({ text, kind: "BUG", target: "api" }),
  });
  const b = (await r.json()) as { id: string };
  return b.id;
};

const submitReview = async (app: Hono) => {
  const r = await app.request("/api/v1/agent/reviews", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idem("rv"),
      "fly-client-ip": `10.61.${n}.1`,
    },
    body: JSON.stringify({ reviewType: "DOCS", workRef: "https://x.test/d" }),
  });
  const b = (await r.json()) as { id: string };
  return b.id;
};

const getHtml = async (app: Hono, path: string) => {
  const r = await app.request(path, { headers: { authorization: basic } });
  return { status: r.status, html: await r.text() };
};

const tokenOf = (html: string) => {
  const m = html.match(/name="formToken" value="([^"]+)"/);
  expect(m).not.toBeNull();
  return m![1];
};

const post = async (app: Hono, path: string, fields: string, origin?: string) => {
  const headers: Record<string, string> = {
    authorization: basic,
    "content-type": FORM,
  };
  if (origin) headers.origin = origin;
  return app.request(path, { method: "POST", headers, body: fields });
};

describe("review-center auth + queue", () => {
  it("no creds → 401; Basic → queue renders", async () => {
    const { app } = await mkApp();
    const un = await app.request("/admin/review-center");
    expect(un.status).toBe(401);
    const ok = await app.request("/admin/review-center", {
      headers: { authorization: basic },
    });
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Review Center");
  });

  it("?queue=feedback|reviews lists rows; status filter closed-set", async () => {
    const { app } = await mkApp();
    const fid = await submitFeedback(app, "queue fb row");
    const rid = await submitReview(app);

    const fq = await getHtml(app, "/admin/review-center?queue=feedback&status=all");
    expect(fq.html).toContain(fid);
    const rq = await getHtml(app, "/admin/review-center?queue=reviews&status=all");
    expect(rq.html).toContain(rid);
    const bad = await app.request(
      "/admin/review-center?queue=feedback&status=NOPE",
      { headers: { authorization: basic } },
    );
    expect(bad.status).toBe(400);
  });

  it("agent-supplied text is escaped (XSS regression)", async () => {
    const { app } = await mkApp();
    const fid = await submitFeedback(app, "<script>alert(1)</script>");
    const d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d.html).not.toContain("<script>alert(1)</script>");
    expect(d.html).toContain("&lt;script&gt;");
  });
});

describe("feedback operator flow", () => {
  it("triage → resolve ACCEPTED → close (PRG + status renders)", async () => {
    const { app } = await mkApp();
    const fid = await submitFeedback(app, "needs triage");

    const d1 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d1.html).toContain("RECEIVED");
    const t1 = tokenOf(d1.html);

    const tri = await post(
      app,
      `/admin/review-center/feedback/${fid}/triage`,
      `formToken=${t1}&kind=FEATURE&target=docs&severity=LOW&suggestion=fix+the+guide`,
    );
    expect(tri.status).toBe(303);
    expect(tri.headers.get("location")).toContain("ok=triaged");

    const d2 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d2.html).toContain("TRIAGED");
    expect(d2.html).toContain("fix the guide");
    const t2 = tokenOf(d2.html);

    const res = await post(
      app,
      `/admin/review-center/feedback/${fid}/resolve`,
      `formToken=${t2}&to=ACCEPTED`,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("ok=resolved");

    const d3 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    const t3 = tokenOf(d3.html);
    const cls = await post(
      app,
      `/admin/review-center/feedback/${fid}/close`,
      `formToken=${t3}&fromStatus=ACCEPTED`,
    );
    expect(cls.status).toBe(303);
    const d4 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d4.html).toContain("CLOSED");
    expect(d4.html).toContain("feedback.status_changed");
  });

  it("single-use token: replay → flash err, no second write", async () => {
    const { app } = await mkApp();
    const fid = await submitFeedback(app, "token test");
    const d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    const t = tokenOf(d.html);

    const first = await post(
      app,
      `/admin/review-center/feedback/${fid}/triage`,
      `formToken=${t}`,
    );
    expect(first.headers.get("location")).toContain("ok=triaged");

    // Same token again — the domain write must NOT run (still TRIAGED,
    // no second transition attempt, no crash).
    const replay = await post(
      app,
      `/admin/review-center/feedback/${fid}/triage`,
      `formToken=${t}`,
    );
    expect(replay.headers.get("location")).toContain(
      "err=form_expired_or_duplicate",
    );
  });

  it("forged operator form field is ignored — actor is the credential", async () => {
    const { app, operatorId } = await mkApp();
    const fid = await submitFeedback(app, "op test");
    const d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    const t = tokenOf(d.html);
    const r = await post(
      app,
      `/admin/review-center/feedback/${fid}/triage`,
      `formToken=${t}&operator=agent%3Aevil`,
    );
    expect(r.headers.get("location")).toContain("ok=triaged");
    const d2 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d2.html).toContain(operatorId);
    expect(d2.html).not.toContain("agent:evil");
  });
});

describe("review operator flow", () => {
  it("claim → evidence → decide → reopen → return", async () => {
    const { app } = await mkApp();
    const rid = await submitReview(app);

    // claim
    let d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    expect(d.html).toContain("PENDING_TRIAGE");
    let r = await post(
      app,
      `/admin/review-center/reviews/${rid}/claim`,
      `formToken=${tokenOf(d.html)}`,
    );
    expect(r.headers.get("location")).toContain("ok=claimed");

    // operator evidence (only legal while IN_REVIEW)
    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    expect(d.html).toContain("IN_REVIEW");
    r = await post(
      app,
      `/admin/review-center/reviews/${rid}/evidence`,
      `formToken=${tokenOf(d.html)}&type=REPO_LINK&uri=https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fpull%2F1&label=pr+1`,
    );
    expect(r.headers.get("location")).toContain("ok=evidence_added");

    // decide — criteria fields rendered from the DOCS template
    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    const critFields = d.html
      .match(/name="crit_[a-z0-9_-]+"/g)!
      .map((m) => `${m.slice(6, -1)}=PASS`)
      .join("&");
    r = await post(
      app,
      `/admin/review-center/reviews/${rid}/decide`,
      `formToken=${tokenOf(d.html)}&outcome=APPROVED&summary=docs+look+good&${critFields}`,
    );
    expect(r.headers.get("location")).toContain("ok=decided");

    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    expect(d.html).toContain("DECIDED");
    expect(d.html).toContain("docs look good");

    // reopen → REOPENED, then return → PENDING_TRIAGE
    r = await post(
      app,
      `/admin/review-center/reviews/${rid}/reopen`,
      `formToken=${tokenOf(d.html)}&reason=new+evidence`,
    );
    expect(r.headers.get("location")).toContain("ok=reopened");
    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    r = await post(
      app,
      `/admin/review-center/reviews/${rid}/return`,
      `formToken=${tokenOf(d.html)}`,
    );
    expect(r.headers.get("location")).toContain("ok=returned");
    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    expect(d.html).toContain("PENDING_TRIAGE");
    expect(d.html).toContain("reopenCount");
  });

  it("decide missing a criterion → missing_criteria flash, stays IN_REVIEW", async () => {
    const { app } = await mkApp();
    const rid = await submitReview(app);
    let d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    await post(
      app,
      `/admin/review-center/reviews/${rid}/claim`,
      `formToken=${tokenOf(d.html)}`,
    );
    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    // Drop the last crit_ field → incomplete rubric.
    const names = d.html.match(/name="crit_[a-z0-9_-]+"/g)!;
    const fields = names
      .slice(0, -1)
      .map((m) => `${m.slice(6, -1)}=PASS`)
      .join("&");
    const r = await post(
      app,
      `/admin/review-center/reviews/${rid}/decide`,
      `formToken=${tokenOf(d.html)}&outcome=APPROVED&summary=x&${fields}`,
    );
    expect(r.headers.get("location")).toContain("err=missing_criteria");
    d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    expect(d.html).toContain("IN_REVIEW");
  });

  it("cross-origin form POST → 403 (B-3); same-origin → 303", async () => {
    const { app } = await mkApp();
    const rid = await submitReview(app);
    const d = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    const t = tokenOf(d.html);
    const evil = await post(
      app,
      `/admin/review-center/reviews/${rid}/claim`,
      `formToken=${t}`,
      "https://evil.example",
    );
    expect(evil.status).toBe(403);
    const d2 = await getHtml(app, `/admin/review-center/reviews/${rid}`);
    const same = await post(
      app,
      `/admin/review-center/reviews/${rid}/claim`,
      `formToken=${tokenOf(d2.html)}`,
      "http://localhost",
    );
    expect(same.status).toBe(303);
  });
});

describe("knowledge-draft conversion (230-6)", () => {
  it("ACCEPTED feedback → POST /convert → knowledgeItemId renders", async () => {
    const { app } = await mkApp();
    const fid = await submitFeedback(app, "convert me");

    let d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    await post(
      app,
      `/admin/review-center/feedback/${fid}/triage`,
      `formToken=${tokenOf(d.html)}`,
    );
    d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    await post(
      app,
      `/admin/review-center/feedback/${fid}/resolve`,
      `formToken=${tokenOf(d.html)}&to=ACCEPTED`,
    );

    d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d.html).toContain("→ Knowledge draft");
    const r = await post(
      app,
      `/admin/review-center/feedback/${fid}/convert`,
      `formToken=${tokenOf(d.html)}`,
    );
    expect(r.headers.get("location")).toContain("ok=converted");

    d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    expect(d.html).toContain("knowledgeConverted");
    expect(d.html).toContain("ki_");
    expect(d.html).toContain("feedback.knowledge_converted");
    // convert form is gone — the row is marked
    expect(d.html).not.toContain("→ Knowledge draft");

    // second convert → already_converted flash (no second item)
    const r2 = await post(
      app,
      `/admin/review-center/feedback/${fid}/convert`,
      `formToken=${tokenOf(d.html)}`,
    );
    expect(r2.headers.get("location")).toContain("err=already_converted");
  });

  it("non-ACCEPTED feedback → not_convertible_status; draft.json gated + exports", async () => {
    const { app } = await mkApp();
    const fid = await submitFeedback(app, "still raw");
    const d = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    const r = await post(
      app,
      `/admin/review-center/feedback/${fid}/convert`,
      `formToken=${tokenOf(d.html)}`,
    );
    expect(r.headers.get("location")).toContain(
      "err=not_convertible_status",
    );

    // Arc 230-8: draft.json mirrors the convert gate — a raw row
    // exports nothing.
    const early = await app.request(
      `/admin/review-center/feedback/${fid}/draft.json`,
      { headers: { authorization: basic } },
    );
    expect(early.status).toBe(409);

    // Drive to ACCEPTED, then the fallback export opens up.
    let d2 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    await post(
      app,
      `/admin/review-center/feedback/${fid}/triage`,
      `formToken=${tokenOf(d2.html)}`,
    );
    d2 = await getHtml(app, `/admin/review-center/feedback/${fid}`);
    await post(
      app,
      `/admin/review-center/feedback/${fid}/resolve`,
      `formToken=${tokenOf(d2.html)}&to=ACCEPTED`,
    );

    const dump = await app.request(
      `/admin/review-center/feedback/${fid}/draft.json`,
      { headers: { authorization: basic } },
    );
    expect(dump.status).toBe(200);
    const payload = await dump.json();
    expect(payload.sourceRef).toBe(`feedback:${fid}`);
    expect(payload.body).toContain("still raw");
  });
});
