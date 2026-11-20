import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  createMemoryKnowledgeStores,
  createKnowledgeItem,
  transitionKnowledgeItem,
  upsertKnowledgeCapability,
  linkItemCapability,
  searchKnowledgeItems,
} from "../src/server/lib/knowledge";
import { createAgentKnowledgeRoutes } from "../src/server/routes/agent-knowledge-api";
import { createTieredLimiter } from "../src/server/routes/agent-interaction/rate-limits";

/**
 * SLICE-229-5 DoD — public search surface:
 * - agent reads NEVER see non-PUBLISHED content (projection-leak
 *   regression — draft/pending/verified all invisible).
 * - validation: q 2..200, limit ≤20, kind vocab.
 * - injection-shaped q is a literal query, not a tsquery program.
 * - engine field reports MEMORY under the fallback; same shape as FTS.
 * - tiered rate limit returns 429 after the anon bucket empties.
 */

const OP = "ops_test";

async function publish(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
  title: string,
  body: string,
) {
  const c = await createKnowledgeItem(
    store,
    { kind: "GUIDE", slug, title, body },
    OP,
  );
  if (!c.ok) throw new Error("create failed");
  for (const to of ["PENDING", "VERIFIED", "PUBLISHED"] as const) {
    const r = await transitionKnowledgeItem(store, c.item.id, to, OP);
    if (!r.ok) throw new Error(`transition ${to} failed`);
  }
  return c.item;
}

async function leaveIn(
  store: ReturnType<typeof createMemoryKnowledgeStores>,
  slug: string,
  status: "DRAFT" | "PENDING" | "VERIFIED",
) {
  const c = await createKnowledgeItem(
    store,
    { kind: "GUIDE", slug, title: `${slug} escrow`, body: "escrow body" },
    OP,
  );
  if (!c.ok) throw new Error("create failed");
  if (status === "DRAFT") return c.item;
  await transitionKnowledgeItem(store, c.item.id, "PENDING", OP);
  if (status === "PENDING") return c.item;
  await transitionKnowledgeItem(store, c.item.id, "VERIFIED", OP);
  return c.item;
}

function mkApp(limits = { ANON: 10, API_KEY: 60, DID: 120 }) {
  const store = createMemoryKnowledgeStores();
  const app = new Hono();
  app.route(
    "/",
    createAgentKnowledgeRoutes({
      store,
      limiter: createTieredLimiter({
        limits,
        globalKey: "g:test-search",
        globalMax: 10_000,
      }),
    }),
  );
  return { app, store };
}

describe("agent knowledge search (SLICE-229-5)", () => {
  it("PUBLISHED hits only — draft/pending/verified never leak", async () => {
    const { app, store } = mkApp();
    await publish(store, "escrow-guide", "Escrow settlement", "escrow flow");
    for (const s of ["DRAFT", "PENDING", "VERIFIED"] as const) {
      await leaveIn(store, `hidden-${s.toLowerCase()}`, s);
    }
    const r = await app.request(
      "/api/v1/agent/knowledge/search?q=escrow",
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.engine).toBe("MEMORY");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].slug).toBe("escrow-guide");
    expect(body.results[0]).toMatchObject({
      itemId: expect.any(String),
      title: "Escrow settlement",
      rank: expect.any(Number),
    });
    expect(typeof body.results[0].snippet).toBe("string");
    expect(typeof body.tookMs).toBe("number");
    // Same shape via the lib seam.
    const lib = await searchKnowledgeItems(store, "escrow");
    expect(lib.items.map((h) => h.slug)).toEqual(["escrow-guide"]);
    expect(lib.engine).toBe("MEMORY");
  });

  it("validation: q bounds, kind vocab, limit clamp", async () => {
    const { app } = mkApp();
    expect(
      (await app.request("/api/v1/agent/knowledge/search?q=x")).status,
    ).toBe(400);
    expect(
      (await app.request("/api/v1/agent/knowledge/search")).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `/api/v1/agent/knowledge/search?q=${"a".repeat(201)}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/v1/agent/knowledge/search?q=ok&kind=BOGUS"))
        .status,
    ).toBe(400);
    // limit>20 clamps, non-numeric falls back to default — both 200.
    for (const u of ["?q=ok&limit=999", "?q=ok&limit=abc"]) {
      const r = await app.request(`/api/v1/agent/knowledge/search${u}`);
      expect(r.status).toBe(200);
    }
  });

  it("injection-shaped q is a literal query — no tsquery crash/leak", async () => {
    const { app, store } = mkApp();
    await publish(store, "safe-doc", "normal", "normal body");
    const evil = [
      `ok' OR '1'='1`,
      `ok & !(x <-> y):*`,
      `ok" | "injected`,
      `${"a".repeat(50)}%') UNION SELECT`,
    ];
    for (const q of evil) {
      const r = await app.request(
        `/api/v1/agent/knowledge/search?q=${encodeURIComponent(q)}`,
      );
      expect(r.status).toBe(200); // honest empty result, not a 500
      const b = await r.json();
      expect(Array.isArray(b.results)).toBe(true);
    }
  });

  it("capability filter narrows results", async () => {
    const { app, store } = mkApp();
    const tagged = await publish(store, "tagged", "pay doc", "pay body");
    await publish(store, "untagged", "pay doc two", "pay body two");
    const cap = await upsertKnowledgeCapability(store, {
      name: "mcp.pay", kind: "MCP_TOOL", source: "MANUAL",
    });
    if (!cap.ok) throw new Error("cap failed");
    await linkItemCapability(store, tagged.id, cap.capability.id);
    const r = await app.request(
      "/api/v1/agent/knowledge/search?q=pay&capability=mcp.pay",
    );
    const b = await r.json();
    expect(b.results).toHaveLength(1);
    expect(b.results[0].slug).toBe("tagged");
  });

  it("tiered rate limit: anon bucket exhausts → 429", async () => {
    const { app } = mkApp({ ANON: 3, API_KEY: 60, DID: 120 });
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = await app.request(
        "/api/v1/agent/knowledge/search?q=test",
        { headers: { "fly-client-ip": "10.7.7.7" } },
      );
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
