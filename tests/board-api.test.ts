/**
 * SLICE-199-11 (EPIC-199): Board API routes.
 *   POST /board/cards            — ops-tier create (bounty + card + outbox)
 *   GET  /board/cards            — public board, no spec internals
 *   GET  /board/cards/:id        — card + journal (spec gated to holder/ops)
 *   GET  /board/cards/:id/journal— append-only journal read
 *   POST /board/cards/:id/claim  — off-chain claim (199-07)
 *   POST /board/cards/:id/submit — lease-holder submit → testing
 *   POST /board/cards/:id/review — reviewer verdict (199-08)
 *   POST /board/cards/:id/cancel — ops only
 * Idempotency-Key on POST claim/submit/review → board:idem replay.
 * board:snap:* snapshot cache (tag board) invalidated on each mutation.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { InMemoryCache } from "@agentbadge/cache";

import { createBoardRoutes } from "../src/server/routes/board-api";
import { createBoardReadRoutes } from "../src/server/routes/board-api-read";
import { createBoardQaRoutes } from "../src/server/routes/board-api-qa";
import { boardStore } from "../src/server/lib/board/store";
import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import {
  getBounty,
  upsertBounty,
  useMemoryBountyStoreForTesting,
} from "../src/server/lib/bounties/store";

const NOW = 1_700_000_000_000;
const CHAIN_ID = 5042002;
const PAYOUT = "0xabc00000000000000000000000000000000000aa";

let cache: InMemoryCache;

type Agent = { agentId: string; tier: string } | undefined;
let currentAgent: Agent;

function makeApp() {
  const app = new Hono<{ Variables: { agent?: Agent } }>();
  app.use(async (c, next) => {
    if (currentAgent) c.set("agent", currentAgent);
    await next();
  });
  app.route("/", createBoardQaRoutes({ cache, now: () => NOW }));
  app.route("/", createBoardReadRoutes({ cache }));
  app.route(
    "/",
    createBoardRoutes({
      cache,
      now: () => NOW,
      verifyPayoutSig: () => Promise.resolve(true),
      verifyReviewSig: () => Promise.resolve(true),
      isReviewer: (p: string) => p === "ps_reviewer",
      network: () => ({ chain: { chainId: CHAIN_ID } }) as never,
    }),
  );
  return app;
}

function post(
  path: string,
  body: unknown,
  agent: Agent,
  headers: Record<string, string> = {},
) {
  currentAgent = agent;
  return makeApp().fetch(
    new Request(`http://x${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}
function get(path: string, agent?: Agent) {
  currentAgent = agent;
  return makeApp().fetch(new Request(`http://x${path}`));
}

const OPS = { agentId: "ops_1", tier: "ops" };
const PROVIDER = { agentId: "ps_provider", tier: "agent" };
const REVIEWER = { agentId: "ps_reviewer", tier: "agent" };
const RAND = { agentId: "ps_rand", tier: "agent" };

const spec = "Fix lint — run eslint --fix on src/";

async function createCard() {
  const res = await post(
    "/api/board/cards",
    { title: "Fix lint", spec, budgetUsdc: "100" },
    OPS,
  );
  expect(res.status).toBe(201);
  return (await res.json() as { card: { cardId: string } }).card.cardId;
}

beforeEach(() => {
  cache = new InMemoryCache();
  currentAgent = undefined;
  useMemoryBoardStoreForTesting();
  useMemoryBountyStoreForTesting();
});

describe("POST /api/board/cards", () => {
  it("ops → 201, card todo + bounty open + createJob outbox + journal", async () => {
    const cardId = await createCard();
    const st = boardStore();
    const card = st.getCard(cardId);
    expect(card?.column).toBe("todo");
    expect(card?.specHash).toMatch(/^0x/);
    expect(getBounty(card!.bountyId)?.status).toBe("open");
    const outbox = st.listOutbox({ cardId });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].kind).toBe("createJob");
    expect(st.listEntries(cardId)[0].kind).toBe("create");
  });

  it("non-ops → 403", async () => {
    const res = await post("/api/board/cards", { title: "x", spec }, RAND);
    expect(res.status).toBe(403);
  });

  it("anonymous → 403", async () => {
    const res = await post("/api/board/cards", { title: "x", spec }, undefined);
    expect(res.status).toBe(403);
  });

  it("missing spec → 400", async () => {
    const res = await post("/api/board/cards", { title: "x" }, OPS);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/board/cards + /:id (public view)", () => {
  it("list hides spec internals; shows column/title/attempt", async () => {
    const cardId = await createCard();
    const res = await get("/api/board/cards");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: Record<string, unknown>[] };
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].cardId).toBe(cardId);
    expect(body.cards[0].column).toBe("todo");
    expect(JSON.stringify(body.cards[0])).not.toContain(spec);
  });

  it("detail hides spec for anonymous", async () => {
    const cardId = await createCard();
    const res = await get(`/api/board/cards/${cardId}`);
    const body = (await res.json()) as { card: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(body.card.spec).toBeUndefined();
  });

  it("detail shows spec to ops", async () => {
    const cardId = await createCard();
    const res = await get(`/api/board/cards/${cardId}`, OPS);
    const body = (await res.json()) as { card: Record<string, unknown> };
    expect(body.card.spec).toBe(spec);
  });

  it("unknown card → 404", async () => {
    const res = await get("/api/board/cards/nope");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/board/cards/:id/claim", () => {
  it("valid claim → 200 in_progress", async () => {
    const cardId = await createCard();
    const res = await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0x1", sigExpiresAt: NOW + 60_000 },
      PROVIDER,
    );
    expect(res.status).toBe(200);
    expect(boardStore().getCard(cardId)?.column).toBe("in_progress");
  });

  it("anonymous → 403", async () => {
    const cardId = await createCard();
    const res = await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0x1", sigExpiresAt: NOW + 60_000 },
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("double claim → 409 for the loser", async () => {
    const cardId = await createCard();
    await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0xa", sigExpiresAt: NOW + 60_000 },
      PROVIDER,
    );
    const res = await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0xb", sigExpiresAt: NOW + 60_000 },
      RAND,
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/board/cards/:id/submit", () => {
  async function claim(cardId: string) {
    await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0x1", sigExpiresAt: NOW + 60_000 },
      PROVIDER,
    );
  }

  it("lease holder → 200 testing + submit outbox + journal", async () => {
    const cardId = await createCard();
    await claim(cardId);
    const res = await post(
      `/api/board/cards/${cardId}/submit`,
      { deliverableHash: "0x" + "a".repeat(64), prUrl: "https://x/1" },
      PROVIDER,
    );
    expect(res.status).toBe(200);
    expect(boardStore().getCard(cardId)?.column).toBe("testing");
    expect(boardStore().listOutbox({ cardId }).map((o) => o.kind))
      .toContain("submit");
    expect(boardStore().listEntries(cardId).at(-1)?.kind).toBe("submit");
  });

  it("non-lease passport → 403", async () => {
    const cardId = await createCard();
    await claim(cardId);
    const res = await post(
      `/api/board/cards/${cardId}/submit`,
      { deliverableHash: "0x" + "a".repeat(64) },
      RAND,
    );
    expect(res.status).toBe(403);
  });

  it("todo card (no claim) → 409", async () => {
    const cardId = await createCard();
    const res = await post(
      `/api/board/cards/${cardId}/submit`,
      { deliverableHash: "0x" + "a".repeat(64) },
      PROVIDER,
    );
    expect(res.status).toBe(409);
  });
});

describe("POST /api/board/cards/:id/review", () => {
  it("reviewer approve → done + journal review", async () => {
    const cardId = await createCard();
    const card = boardStore().getCard(cardId)!;
    upsertBounty({ ...getBounty(card.bountyId)!, status: "submitted" });
    boardStore().patchCard(cardId, {
      column: "review",
      currentPassportId: "ps_provider",
    });
    const res = await post(
      `/api/board/cards/${cardId}/review`,
      {
        verdict: "approve",
        reviewerWallet: "0x1111000000000000000000000000000000000001",
        reviewSig: "0xr",
        sigExpiresAt: NOW + 60_000,
      },
      REVIEWER,
    );
    expect(res.status).toBe(200);
    expect(boardStore().getCard(cardId)?.column).toBe("done");
    expect(boardStore().listEntries(cardId).at(-1)?.kind).toBe("review");
  });

  it("reviewer == provider → 403", async () => {
    const cardId = await createCard();
    const card = boardStore().getCard(cardId)!;
    upsertBounty({ ...getBounty(card.bountyId)!, status: "submitted" });
    boardStore().patchCard(cardId, {
      column: "review",
      currentPassportId: "ps_reviewer",
    });
    const res = await post(
      `/api/board/cards/${cardId}/review`,
      {
        verdict: "approve",
        reviewerWallet: "0x1111000000000000000000000000000000000001",
        reviewSig: "0xr",
        sigExpiresAt: NOW + 60_000,
      },
      REVIEWER,
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/board/cards/:id/cancel", () => {
  it("ops → cancelled + journal cancel", async () => {
    const cardId = await createCard();
    const res = await post(`/api/board/cards/${cardId}/cancel`, {}, OPS);
    expect(res.status).toBe(200);
    expect(boardStore().getCard(cardId)?.column).toBe("cancelled");
    expect(boardStore().listEntries(cardId).at(-1)?.kind).toBe("cancel");
  });

  it("non-ops → 403", async () => {
    const cardId = await createCard();
    const res = await post(`/api/board/cards/${cardId}/cancel`, {}, PROVIDER);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/board/cards/:id/journal", () => {
  it("chronological journal, public", async () => {
    const cardId = await createCard();
    await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0x1", sigExpiresAt: NOW + 60_000 },
      PROVIDER,
    );
    const res = await get(`/api/board/cards/${cardId}/journal`);
    const body = (await res.json()) as {
      entries: { kind: string; seq: number }[];
    };
    expect(res.status).toBe(200);
    expect(body.entries.map((e) => e.kind)).toEqual(["create", "claim"]);
    expect(body.entries[0].seq).toBe(1);
  });
});

describe("idempotency + snapshot cache", () => {
  it("Idempotency-Key: repeated claim → identical response, one claim entry", async () => {
    const cardId = await createCard();
    const headers = { "idempotency-key": "idem-1" };
    const body = {
      payoutWallet: PAYOUT,
      claimSig: "0x1",
      sigExpiresAt: NOW + 60_000,
    };
    const r1 = await post(
      `/api/board/cards/${cardId}/claim`, body, PROVIDER, headers,
    );
    const r2 = await post(
      `/api/board/cards/${cardId}/claim`, body, PROVIDER, headers,
    );
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe(await r1.text());
    const kinds = boardStore().listEntries(cardId).map((e) => e.kind);
    expect(kinds.filter((k) => k === "claim")).toHaveLength(1);
  });

  it("board:snap invalidated on mutation — next GET sees fresh state", async () => {
    const cardId = await createCard();
    const l1 = await (await get("/api/board/cards")).json() as {
      cards: { column: string }[];
    };
    expect(l1.cards[0].column).toBe("todo");
    await post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0x1", sigExpiresAt: NOW + 60_000 },
      PROVIDER,
    );
    const l2 = await (await get("/api/board/cards")).json() as {
      cards: { column: string }[];
    };
    expect(l2.cards[0].column).toBe("in_progress");
  });
});

describe("POST /api/board/cards/:id/qa", () => {
  function seedTesting() {
    return createCard().then((cardId) => {
      const card = boardStore().getCard(cardId)!;
      upsertBounty({ ...getBounty(card.bountyId)!, status: "submitted" });
      boardStore().patchCard(cardId, {
        column: "testing",
        currentPassportId: "ps_provider",
      });
      return cardId;
    });
  }

  it("ops qaPass → review + journal qa", async () => {
    const cardId = await seedTesting();
    const res = await post(`/api/board/cards/${cardId}/qa`, { verdict: "pass" }, OPS);
    expect(res.status).toBe(200);
    expect(boardStore().getCard(cardId)?.column).toBe("review");
    expect(boardStore().listEntries(cardId).at(-1)?.kind).toBe("qa");
  });

  it("ops qaFail → bug + fixDeadline + journal bug", async () => {
    const cardId = await seedTesting();
    const res = await post(
      `/api/board/cards/${cardId}/qa`,
      { verdict: "fail", reasonCodes: ["lint_broken"] },
      OPS,
    );
    expect(res.status).toBe(200);
    const card = boardStore().getCard(cardId)!;
    expect(card.column).toBe("bug");
    expect(card.fixDeadlineMs).toBeGreaterThan(NOW);
    expect(boardStore().listEntries(cardId).at(-1)?.kind).toBe("bug");
  });

  it("non-ops → 403; wrong column → 409; bad verdict → 400", async () => {
    const cardId = await seedTesting();
    expect(
      (await post(`/api/board/cards/${cardId}/qa`, { verdict: "pass" }, PROVIDER)).status,
    ).toBe(403);
    expect(
      (await post(`/api/board/cards/${cardId}/qa`, { verdict: "meh" }, OPS)).status,
    ).toBe(400);
    const todoId = await createCard();
    expect(
      (await post(`/api/board/cards/${todoId}/qa`, { verdict: "pass" }, OPS)).status,
    ).toBe(409);
  });
});

describe("audit fixes (199-14)", () => {
  async function doClaim(cardId: string, idem?: string) {
    return post(
      `/api/board/cards/${cardId}/claim`,
      { payoutWallet: PAYOUT, claimSig: "0x1", sigExpiresAt: NOW + 60_000 },
      PROVIDER,
      idem ? { "idempotency-key": idem } : {},
    );
  }

  it("C-1: idem replay survives invalidateTag('board') bump", async () => {
    const cardId = await createCard();
    expect((await doClaim(cardId, "e2e-c1")).status).toBe(200);
    const before = boardStore().listEntries(cardId).length;
    // Same key must replay — the bump after the first claim must not
    // have wiped the board:idem record (tag "idem", not "board").
    const res = await doClaim(cardId, "e2e-c1");
    expect(res.status).toBe(200);
    expect(boardStore().listEntries(cardId).length).toBe(before);
  });

  it("H-2: journal strips wallet/sigHash for anonymous callers", async () => {
    const cardId = await createCard();
    await doClaim(cardId);
    const anon = await (await get(`/api/board/cards/${cardId}/journal`)).json();
    const claimEntry = anon.entries.find(
      (e: { kind: string }) => e.kind === "claim",
    );
    expect(claimEntry.payload.payoutWallet).toBeUndefined();
    const opsRes = await get(`/api/board/cards/${cardId}/journal`, OPS);
    const opsJson = await opsRes.json();
    expect(
      opsJson.entries.find((e: { kind: string }) => e.kind === "claim").payload
        .payoutWallet,
    ).toBe(PAYOUT.toLowerCase());
  });

  it("H-1: 31st mutation in a minute → 429", async () => {
    for (let i = 0; i < 30; i++) {
      await post("/api/board/cards", { title: `r${i}`, spec: "s" }, OPS);
    }
    const res = await post(
      "/api/board/cards",
      { title: "r31", spec: "s" },
      OPS,
    );
    expect(res.status).toBe(429);
  });

  it("M-7: budgetUsdc NaN/negative → 400", async () => {
    expect(
      (
        await post(
          "/api/board/cards",
          { title: "b", spec: "s", budgetUsdc: "NaN" },
          OPS,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await post(
          "/api/board/cards",
          { title: "b", spec: "s", budgetUsdc: "-5" },
          OPS,
        )
      ).status,
    ).toBe(400);
  });
});
