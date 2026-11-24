import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  buildFingerprint,
  sanitizeHeaders,
  normalizeQuestion,
} from "../../src/server/lib/request-inbox/fingerprint";
import {
  createSubmitLanes,
  hasJsonbUnsafe,
} from "../../src/server/lib/request-inbox/intake";
import { runInboxJanitor } from "../../src/server/lib/request-inbox/janitor";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import { createAgentRequestRoutes } from "../../src/server/routes/agent-requests/agent-requests-api";
import { createAgentRequestOpsRoutes } from "../../src/server/routes/agent-requests/agent-requests-ops-api";
import { createAgentSurveyRoutes } from "../../src/server/routes/agent-surveys/agent-surveys-api";
import { canonicalJson } from "../../src/server/lib/request-inbox/qa";
import { adminAuth } from "../../src/server/middleware/adminAuth";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";
import type { ReputationWriteRecord } from "../../src/server/lib/board/types";

/**
 * EPIC-252 (SLICE-252-9): regression suite for the SECOND Arc
 * Studio re-audit — every INSUFFICIENT/REGRESSION + new finding
 * gets a test that fails on the pre-fix code.
 */

const ENV = {
  fingerprintSalt: "audit-test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

const ADMIN = "test-admin-key";
process.env.ADMIN_API_KEY = ADMIN;

// ── C-1: denylist gap — more IP-carrier names dropped ────────────
describe("C-1 round-2: extended IP-carrier headers dropped", () => {
  it("client-ip / cf-connecting-ipv6 / x-original-forwarded-for are dropped", () => {
    const { fingerprint } = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "audit-salt-1",
      headers: {
        "client-ip": "1.2.3.4",
        "cf-connecting-ipv6": "1.2.3.4",
        "x-original-forwarded-for": "1.2.3.4",
        "x-proxyuser-ip": "1.2.3.4",
        "wl-proxy-client-ip": "1.2.3.4",
        "x-requested-with": "fine",
      },
    });
    // Resolved IP lives at fingerprint.ip by design now — the check is
    // that IP-carrier *headers* still never persist.
    expect(fingerprint.ip).toBe("1.2.3.4");
    expect(JSON.stringify(fingerprint.headers)).not.toContain("1.2.3.4");
    expect(fingerprint.headers["x-requested-with"]).toBe("fine");
  });

  it("ops read re-sanitizes legacy rows (header-carried IP stripped, fingerprint.ip served)", async () => {
    const stores = createMemoryRequestInboxStores();
    const opStore = createMemoryOperatorStore();
    const { key: opKey } = await seedOperator(opStore);
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route(
      "/",
      createAgentRequestOpsRoutes({ stores, operatorStore: opStore }),
    );
    await stores.requests.submit({
      id: "r1",
      state: "submitted",
      kind: null,
      payload: { prompt: "hi" },
      fingerprint: {
        ip: "9.9.9.9",
        ua: "a",
        referer: null,
        src: null,
        headers: { "x-forwarded-for": "9.9.9.9", "fly-client-ip": "9.9.9.9" },
        softFpHash: "s",
      },
      fpHash: "fp1",
      agentId: null,
      verified: false,
      idempotencyKey: null,
      expiresAtMs: Date.now() + 60_000,
      createdAtMs: Date.now(),
    });
    const res = await app.request("/api/ops/requests", {
      headers: { "X-Admin-Key": opKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const fp = body.items[0].fingerprint;
    // fingerprint.ip is intentionally ops-visible now…
    expect(fp.ip).toBe("9.9.9.9");
    // …but IPs smuggled inside header snapshots stay stripped.
    expect(JSON.stringify(fp.headers)).not.toContain("9.9.9.9");
  });
});

// ── C-2 round-2: pad headers can't push identity headers out ─────
describe("C-2 round-2: digest uses the uncapped header set", () => {
  it("40 a-pad-* headers do not change fpHash/softFpHash", () => {
    const mk = (pads: number) => {
      const headers: Record<string, string> = { accept: "a" };
      for (let i = 0; i < pads; i++) headers[`a-pad-${i}`] = "x";
      return buildFingerprint({
        ip: "1.2.3.4",
        ua: "agent/1.0",
        salt: "audit-salt-1",
        headers,
      });
    };
    const base = mk(0);
    expect(mk(38).fpHash).toBe(base.fpHash);
    expect(mk(40).fpHash).toBe(base.fpHash);
    expect(mk(60).fpHash).toBe(base.fpHash);
    expect(mk(40).softFpHash).toBe(base.softFpHash);
  });
});

// ── N-3: IP-only anonymous lane ──────────────────────────────────
describe("N-3: anonymous IP-only lane", () => {
  it("rotating identity headers on one IP still hits the ip lane", () => {
    const lanes = createSubmitLanes({
      windowMs: 60_000,
      max: 100,
      softMax: 1000,
      ipMax: 2,
    });
    // two fresh fpHash+softFpHash pairs, same ipFpHash → lane caps at 2
    expect(lanes.check(null, "fpA", "softA", "ipX")).toBeNull();
    expect(lanes.check(null, "fpB", "softB", "ipX")).toBeNull();
    expect(lanes.check(null, "fpC", "softC", "ipX")).not.toBeNull();
    // a different IP is unaffected
    expect(lanes.check(null, "fpD", "softD", "ipY")).toBeNull();
  });
});

// ── M-3 round-2: referer/origin + jwt/assertion/oidc stripped ────
describe("M-3 round-2: raw-URL + credential headers out of snapshot", () => {
  it("referer / origin never reach the header snapshot", () => {
    const out = sanitizeHeaders({
      referer: "https://x.io/p?token=abc#f",
      origin: "https://x.io",
      accept: "application/json",
    });
    expect(out["referer"]).toBeUndefined();
    expect(out["origin"]).toBeUndefined();
    expect(out["accept"]).toBe("application/json");
  });

  it("jwt/assertion/oidc carriers strip from the snapshot", () => {
    const out = sanitizeHeaders({
      "x-goog-iap-jwt-assertion": "jwt",
      "cf-access-jwt-assertion": "jwt",
      "x-amzn-oidc-data": "data",
      accept: "application/json",
    });
    expect(Object.keys(out)).toEqual(["accept"]);
  });
});

// ── M-5 round-2: more invisible chars stripped ───────────────────
describe("M-5 round-2: extended invisible strip", () => {
  it("bidi isolates / soft hyphen / ALCM / mongolian / variation selectors removed", () => {
    // invisibles stripped → only real letters remain, no phantom space
    expect(normalizeQuestion("a\u2066bc\u061cd\u180ee\ufe0ff")).toBe("abcdef");
    // an invisible-only difference collapses to the same corpus key
    expect(normalizeQuestion("a\u2066b")).toBe(normalizeQuestion("ab"));
    expect(normalizeQuestion("a\u00adb")).toBe(normalizeQuestion("ab"));
  });
});

// ── M-8 round-2: object keys + kind checked ──────────────────────
describe("M-8 round-2: NUL in keys and kind rejected", () => {
  it("object key carrying NUL is unsafe", () => {
    expect(hasJsonbUnsafe({ "a\u0000b": 1 })).toBe(true);
    expect(hasJsonbUnsafe({ ok: { nested: "\u0000" } })).toBe(true);
    expect(hasJsonbUnsafe({ ok: { nested: "clean" } })).toBe(false);
  });
});

// ── M-11 round-2: canonical compare survives jsonb reorder ───────
describe("M-11 round-2: canonicalJson", () => {
  it("deep key-sort makes reordered payloads equal", () => {
    const a = { x: 1, y: { b: 2, a: [3, { d: 4, c: 5 }] } };
    const b = { y: { a: [3, { c: 5, d: 4 }], b: 2 }, x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson({ x: 2 })).not.toBe(canonicalJson({ x: 3 }));
  });
});

// ── N-1: lane refund on post-lane failure ────────────────────────
describe("N-1: refund restores consumed slots", () => {
  it("refund lets the retry pass instead of 429", () => {
    const lanes = createSubmitLanes({ windowMs: 60_000, max: 1 });
    expect(lanes.check("agentA", "fpA", "softA", "ipA")).toBeNull();
    // submit "fails" → refund → the same key can try again
    lanes.refund("agentA", "fpA", "softA", "ipA");
    expect(lanes.check("agentA", "fpA", "softA", "ipA")).toBeNull();
    // without refund the second check would have been limited
  });
});

// ── N-5: QA pair response refresh + null skip ────────────────────
describe("N-5: QA corpus refresh", () => {
  it("re-upsert with a real response replaces a null/stale one", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.upsertQaPair({
      id: "qa_1",
      questionHash: "h",
      question: "q",
      response: "stale",
      sourceRequestId: "r1",
      createdAtMs: 1,
    });
    await stores.requests.upsertQaPair({
      id: "qa_1",
      questionHash: "h",
      question: "q",
      response: "fresh",
      sourceRequestId: "r2",
      createdAtMs: 2,
    });
    const pair = await stores.requests.getQaByHash("h");
    expect(pair?.response).toBe("fresh");
    expect(pair?.uses).toBe(1);
  });
});

// ── M-13: empty X-Admin-Key doesn't shadow Bearer ────────────────
describe("M-13: empty X-Admin-Key falls through to Bearer", () => {
  it("empty X-Admin-Key + valid Bearer → authorized", async () => {
    const app = new Hono();
    app.use(adminAuth);
    app.get("/probe", (c) => c.json({ ok: true }));
    const res = await app.request("/probe", {
      headers: {
        "X-Admin-Key": "",
        Authorization: `Bearer ${ADMIN}`,
      },
    });
    expect(res.status).toBe(200);
  });
});

// ── H-7 round-2: empty janitor run is silent ─────────────────────
describe("H-7 round-2: empty run doesn't fake an error", () => {
  it("archiveDir set + nothing purgeable → no 'purge skipped' error", async () => {
    const stores = createMemoryRequestInboxStores();
    const res = await runInboxJanitor(stores, {
      payloadRetentionMs: 30 * 24 * 3600_000,
      archiveDir: "/tmp/jan-2529-empty",
    });
    expect(res.purgeableListed).toBe(0);
    expect(
      res.errors.some((e) => e.includes("purge skipped")),
    ).toBe(false);
  });
});

// ── H-4 round-2 + M-8 kind: route-level validation ───────────────
describe("route validation round-2", () => {
  it("scalar answers → 400 (only objects/arrays count)", async () => {
    const stores = createMemoryRequestInboxStores();
    const opStore = createMemoryOperatorStore();
    const { key: opKey } = await seedOperator(opStore);
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route(
      "/",
      createAgentSurveyRoutes({
        stores,
        env: ENV,
        operatorStore: opStore,
        writeReputation: (r: ReputationWriteRecord) => {
          void r;
        },
      }),
    );
    const create = await app.request("/api/ops/surveys", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Admin-Key": opKey },
      body: JSON.stringify({ title: "t", questions: [{ q: "x" }] }),
    });
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    for (const answers of ["", 0, false, "x"]) {
      const res = await app.request(`/api/surveys/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      expect(res.status).toBe(400);
    }
  });

  it("kind carrying NUL → 400 not a burned lane + 503", async () => {
    const stores = createMemoryRequestInboxStores();
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route(
      "/",
      createAgentRequestRoutes({ stores, env: ENV, submitMax: 5 }),
    );
    const res = await app.request("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "a\u0000b", payload: { prompt: "hi" } }),
    });
    expect(res.status).toBe(400);
  });
});


// ── Re-audit #2 required fixes (round-3) ─────────────────────────
describe("N-3 round-3: unknown IP emits no ipFpHash", () => {
  it("buildFingerprint returns ipFpHash null on 'unknown'", () => {
    const { ipFpHash } = buildFingerprint({
      ip: "unknown",
      ua: "a",
      salt: "audit-salt-1",
      headers: {},
    });
    expect(ipFpHash).toBeNull();
    const real = buildFingerprint({
      ip: "1.2.3.4",
      ua: "a",
      salt: "audit-salt-1",
      headers: {},
    });
    expect(real.ipFpHash).not.toBeNull();
  });

  it("lanes.check skips the ip lane on null ipFpHash", () => {
    const lanes = createSubmitLanes({
      windowMs: 60_000,
      max: 10,
      ipMax: 1,
    });
    // Two "unknown-IP" anons with different fingerprints must NOT
    // share an ip bucket — both pass.
    expect(lanes.check(null, "fpA", "softA", null)).toBeNull();
    expect(lanes.check(null, "fpB", "softB", null)).toBeNull();
  });
});

describe("M-1 round-3: check refunds earlier lanes on later-lane reject", () => {
  it("ip-lane reject frees the hard slot for the same fp", () => {
    const lanes = createSubmitLanes({
      windowMs: 60_000,
      max: 2,
      softMax: 10,
      ipMax: 1,
    });
    // fpA burns hard slot #1 + ip1's slot.
    expect(lanes.check(null, "fpA", "softA", "ip1")).toBeNull();
    // Second fpA call: takes hard slot #2, then ip1 lane rejects →
    // the fix refunds hard back to 1.
    expect(lanes.check(null, "fpA", "softA", "ip1")).not.toBeNull();
    // Same fpA, fresh ip2: passes ONLY if the rejected call refunded
    // its hard slot. Without the fix, hard(fpA) is still 2 → 429.
    expect(lanes.check(null, "fpA", "softB", "ip2")).toBeNull();
  });

  it("soft-lane reject frees hard + ip slots", () => {
    const lanes = createSubmitLanes({
      windowMs: 60_000,
      max: 2,
      softMax: 1,
      ipMax: 10,
    });
    expect(lanes.check(null, "fpA", "softA", "ip1")).toBeNull();
    // softA full → rejects, must refund hard AND ip2.
    expect(lanes.check(null, "fpA", "softA", "ip2")).not.toBeNull();
    // Same fpA + ip2 with a fresh soft name: hard was refunded so the
    // check gets past hard, ip2 was refunded so it gets past ip, and
    // only the fresh soft lane (empty) decides → pass.
    expect(lanes.check(null, "fpA", "softB", "ip2")).toBeNull();
  });
});

describe("C-1 round-3: snapshot is an allowlist", () => {
  it("unvetted headers — including new IP carriers — never persist", () => {
    const out = sanitizeHeaders({
      "cf-pseudo-ipv4": "1.2.3.4",
      "x-azure-clientip": "1.2.3.4",
      "x-envoy-external-address": "1.2.3.4",
      "x-anything-custom": "v",
      "x-requested-with": "xhr",
      accept: "application/json",
    });
    expect(Object.keys(out)).toEqual(["x-requested-with", "accept"]);
  });
});

const mkSurveyApp3 = async (opts?: { answerMax?: number }) => {
  process.env.ADMIN_API_KEY = ADMIN;
  const stores = createMemoryRequestInboxStores();
  const opStore = createMemoryOperatorStore();
  const { key } = await seedOperator(opStore);
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.route(
    "/",
    createAgentSurveyRoutes({
      stores,
      env: ENV,
      operatorStore: opStore,
      writeReputation: () => { },
      ...opts,
    }),
  );
  return { app, stores, opKey: key };
};

const seedSurvey = async (
  app: Hono<{ Variables: Record<string, unknown> }>,
  opKey: string,
) => {
  const create = await app.request("/api/ops/surveys", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Admin-Key": opKey },
    body: JSON.stringify({ title: "t", questions: [{ q: "x" }] }),
  });
  expect(create.status).toBe(201);
  const { id } = (await create.json()) as { id: string };
  return id;
};

describe("M-8 round-3: survey-side jsonb-unsafe rejection", () => {
  it("answers containing NUL → 400 before any lane slot", async () => {
    const { app, opKey } = await mkSurveyApp3();
    const id = await seedSurvey(app, opKey);
    const res = await app.request(`/api/surveys/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { q: "bad\u0000x" } }),
    });
    expect(res.status).toBe(400);
  });

  it("survey create with NUL title → 400", async () => {
    const { app, opKey } = await mkSurveyApp3();
    const res = await app.request("/api/ops/surveys", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Admin-Key": opKey },
      body: JSON.stringify({ title: "t\u0000bad", questions: [{ q: "x" }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("H-4 round-3: leaf-empty answers rejected", () => {
  it.each(["[null]", '[{"q":""}]', "[[], {}]", '{"a":{"b":""}}'])(
    "answers=%s → 400",
    async (answersJson) => {
      const { app, opKey } = await mkSurveyApp3();
      const id = await seedSurvey(app, opKey);
      const res = await app.request(`/api/surveys/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: JSON.parse(answersJson) }),
      });
      expect(res.status).toBe(400);
    },
  );

  it("a real leaf is accepted", async () => {
    const { app, opKey } = await mkSurveyApp3();
    const id = await seedSurvey(app, opKey);
    const res = await app.request(`/api/surveys/${id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { q: "real answer" } }),
    });
    expect(res.status).toBe(202);
  });
});

describe("N-1 round-3: survey path refunds lanes on store failure", () => {
  it("putAnswer failure → 503 and retry is not 429", async () => {
    // answerMax:1 → a second post 429s unless the lane was refunded.
    const { app, stores, opKey } = await mkSurveyApp3({ answerMax: 1 });
    const id = await seedSurvey(app, opKey);
    stores.surveys.putAnswer = async () => {
      throw new Error("store down");
    };
    const post = () =>
      app.request(`/api/surveys/${id}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: { q: "a" } }),
      });
    expect((await post()).status).toBe(503);
    expect((await post()).status).toBe(503); // refunded, not 429
  });
});
