import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  addEvidence,
  addRelation,
  composeAnswer,
  createKnowledgeItem,
  createMemoryKnowledgeStores,
  type KnowledgeGapRecorder,
} from "../src/server/lib/knowledge";
import { createAgentKnowledgeRoutes } from "../src/server/routes/agent-knowledge-api";
import { createTieredLimiter } from "../src/server/routes/agent-interaction/rate-limits";
import { approveTransition } from "./helpers/knowledge";

/**
 * SLICE-229-7 DoD — deterministic answer composer:
 * - known query → ANSWERED with sources ≥1 (typed evidence on them)
 * - unknown query → REFUSED + gapRecorder seam invoked
 * - determinism: repeat call → identical payload
 * - related items in "see also" are PUBLISHED only
 * - /ask route: validation + honest REFUSED 200 (not a 404)
 */

const OP = "ops_test";
// Arc R1 fix: verify needs a DIFFERENT actor than submitter
// (separation of duties) and ≥1 evidence on the version (H4).
const OP2 = "ops_review";

async function publish(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
  title: string,
  body: string,
  summary?: string,
  extraEvidence?: Array<{ type: string; uri: string; label?: string }>,
) {
  const c = await createKnowledgeItem(
    store,
    { kind: "GUIDE", slug, title, body, summary },
    OP,
  );
  if (!c.ok) throw new Error(`create ${slug}: ${c.error}`);
  const ev = await addEvidence(store, c.version.id, {
    type: "INTERNAL_DOC",
    uri: `internal://runbook/${slug}`,
    addedBy: OP,
  });
  if (!ev.ok) throw new Error(`evidence ${slug}: ${ev.error}`);
  for (const e of extraEvidence ?? []) {
    const r = await addEvidence(store, c.version.id, { ...e, addedBy: OP });
    if (!r.ok) throw new Error(`extra evidence ${slug}: ${r.error}`);
  }
  const steps: Array<[string, string]> = [
    ["PENDING", OP],
    ["VERIFIED", OP2],
    ["PUBLISHED", OP],
  ];
  for (const [to, actor] of steps) {
    const r = await approveTransition(store, c.item.id, to, actor);
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
    await publish(
      store,
      "escrow-x402",
      "x402 escrow settlement",
      "Escrow settles via x402 pack",
      "Escrow payments settle through the x402 pack",
      [
        {
          type: "API_ENDPOINT",
          uri: "https://api.example.com/x402",
          label: "x402 api",
        },
      ],
    );
    const a = await composeAnswer(store, "escrow x402 settlement");
    expect(a.status).toBe("ANSWERED");
    expect(a.sources.length).toBeGreaterThanOrEqual(1);
    expect(a.sources[0]?.slug).toBe("escrow-x402");
    // Evidence lands pre-publish (immutable after); INTERNAL_DOC's
    // uri is redacted in the public payload (Arc R1 H4).
    const types = a.sources[0]?.evidence.map((e) => e.type) ?? [];
    expect(types).toContain("API_ENDPOINT");
    expect(types).toContain("INTERNAL_DOC");
    expect(
      a.sources[0]?.evidence.find((e) => e.type === "INTERNAL_DOC")?.uri,
    ).toBeNull();
    expect(
      a.sources[0]?.evidence.find((e) => e.type === "API_ENDPOINT")?.uri,
    ).toBe("https://api.example.com/x402");
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
        return true;
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
