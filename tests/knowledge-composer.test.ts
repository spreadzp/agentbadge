import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  addRelation,
  composeAnswer,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  transitionKnowledgeItem,
  type KnowledgeGapRecorder,
} from "../src/server/lib/knowledge";
import { createAgentKnowledgeRoutes } from "../src/server/routes/agent-knowledge-api";
import { createTieredLimiter } from "../src/server/routes/agent-interaction/rate-limits";

/**
 * SLICE-229-7 DoD — deterministic answer composer:
 * - known query → ANSWERED with sources ≥1 (typed evidence on them)
 * - unknown query → REFUSED + gapRecorder seam invoked
 * - determinism: repeat call → identical payload
 * - related items in "see also" are PUBLISHED only
 * - /ask route: validation + honest REFUSED 200 (not a 404)
 */

const OP = "ops_test";

async function publish(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
  title: string,
  body: string,
  summary?: string,
) {
  const c = await createKnowledgeItem(
    store,
    { kind: "GUIDE", slug, title, body, summary },
    OP,
  );
  if (!c.ok) throw new Error(`create ${slug}: ${c.error}`);
  for (const to of ["PENDING", "VERIFIED", "PUBLISHED"] as const) {
    const r = await transitionKnowledgeItem(store, c.item.id, to, OP);
    if (!r.ok) throw new Error(`transition ${to}: ${r.error}`);
  }
  return c.item;
}

function mkStore() {
  return createMemoryKnowledgeStores();
}

describe("composeAnswer (SLICE-229-7)", () => {
  it("known query → ANSWERED with typed evidence sources", async () => {
    const store = mkStore();
    const it1 = await publish(
      store,
      "escrow-x402",
      "x402 escrow settlement",
      "Escrow settles via x402 pack",
      "Escrow payments settle through the x402 pack",
    );
    const v = it1.publishedVersionId ?? "";
    await addEvidence(store, v, {
      type: "X402_PACK" as never,
      uri: "https://docs.example/x402",
      addedBy: OP,
    }).catch(() => undefined);
    await addEvidence(store, v, {
      type: "API_ENDPOINT",
      uri: "https://api.example/x402",
      label: "x402 api",
      addedBy: OP,
    });
    const a = await composeAnswer(store, "escrow x402 settlement");
    expect(a.status).toBe("ANSWERED");
    expect(a.sources.length).toBeGreaterThanOrEqual(1);
    expect(a.sources[0]?.slug).toBe("escrow-x402");
    expect(a.sources[0]?.evidence).toHaveLength(1);
    expect(a.sources[0]?.evidence[0]?.type).toBe("API_ENDPOINT");
    expect(a.answerText).toContain("verified knowledge");
    expect(a.confidence).toBeGreaterThanOrEqual(0.6);
    expect(a.reason).toBeNull();
  });

  it("unknown query → REFUSED + gap seam fired once", async () => {
    const store = mkStore();
    await publish(store, "doc-a", "alpha doc", "alpha body");
    const gaps: { query: string; source: string }[] = [];
    const gapRecorder: KnowledgeGapRecorder = {
      recordGap(input) {
        gaps.push({ query: input.query, source: input.source });
      },
    };
    const a = await composeAnswer(store, "zzzy nonexistent topic", {
      gapRecorder,
    });
    expect(a.status).toBe("REFUSED");
    expect(a.reason).toBe("insufficient_verified_knowledge");
    expect(a.answerText).toBeNull();
    expect(gaps).toEqual([
      { query: "zzzy nonexistent topic", source: "COMPOSER_REFUSAL" },
    ]);
  });

  it("deterministic — repeat call returns identical payload", async () => {
    const store = mkStore();
    await publish(store, "det-one", "knowledge determinism", "det body");
    await publish(store, "det-two", "knowledge det two", "det body two");
    const a = await composeAnswer(store, "knowledge determinism");
    const b = await composeAnswer(store, "knowledge determinism");
    expect(a).toEqual(b);
  });

  it("related items in see-also are PUBLISHED only", async () => {
    const store = mkStore();
    const top = await publish(store, "top-doc", "escrow core", "escrow core body");
    const pub = await publish(store, "rel-pub", "escrow pub rel", "pub rel");
    const draft = await createKnowledgeItem(
      store,
      { kind: "GUIDE", slug: "rel-draft", title: "draft", body: "draft" },
      OP,
    );
    if (!draft.ok) throw new Error("draft create failed");
    for (const [to, t] of [
      [pub.id, "RELATED_TO"],
      [draft.item.id, "RELATED_TO"],
    ] as const) {
      const r = await addRelation(store, {
        fromItemId: top.id, toItemId: to, type: t, actorRef: OP,
      });
      expect(r.ok).toBe(true);
    }
    const a = await composeAnswer(store, "escrow core");
    expect(a.status).toBe("ANSWERED");
    const slugs = a.related.map((r) => r.slug);
    expect(slugs).toContain("rel-pub");
    expect(slugs).not.toContain("rel-draft");
  });
});

describe("POST /api/v1/agent/knowledge/ask", () => {
  function mkApp() {
    const store = mkStore();
    const app = new Hono();
    app.route(
      "/",
      createAgentKnowledgeRoutes({
        store,
        limiter: createTieredLimiter({
          limits: { ANON: 10, API_KEY: 60, DID: 120 },
          globalKey: "g:test-ask",
          globalMax: 10_000,
        }),
      }),
    );
    return { app, store };
  }

  it("validation: query bounds", async () => {
    const { app } = mkApp();
    for (const q of ["x", "a".repeat(501)]) {
      const r = await app.request("/api/v1/agent/knowledge/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      expect(r.status).toBe(400);
    }
    const r = await app.request("/api/v1/agent/knowledge/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json",
    });
    expect(r.status).toBe(400);
  });

  it("ask returns ANSWERED/REFUSED envelope — always 200", async () => {
    const { app, store } = mkApp();
    await publish(store, "ask-doc", "ask title escrow", "ask body escrow");
    const r1 = await app.request("/api/v1/agent/knowledge/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "ask escrow" }),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.status).toBe("ANSWERED");
    expect(b1.sources.length).toBeGreaterThanOrEqual(1);

    const r2 = await app.request("/api/v1/agent/knowledge/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "total unknown xyzzy" }),
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.status).toBe("REFUSED");
    expect(b2.reason).toBe("insufficient_verified_knowledge");
  });
});
