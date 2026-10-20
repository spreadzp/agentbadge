/**
 * SLICE-199-12 (EPIC-199): Board UI — SSR kanban /board.
 *   7 columns (todo → cancelled), card = title/budget/attempt/
 *   provider/fixDeadline; role-conditional action buttons; client
 *   filters; card detail with journal. hono/html auto-escapes — spec
 *   and comment XSS must never reach the DOM.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";


import { boardStore } from "../src/server/lib/board/store";
import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import {
  useMemoryBountyStoreForTesting,
  upsertBounty,
} from "../src/server/lib/bounties/store";
import { computeSpecHash } from "../src/server/lib/board/types";
import type { BoardCardRecord } from "../src/server/lib/board/types";
import { createBoardPageRoutes } from "../src/server/routes/board-page";

const COLUMNS = [
  "todo",
  "in_progress",
  "testing",
  "review",
  "bug",
  "done",
  "cancelled",
] as const;

function seedCard(patch: Partial<BoardCardRecord> = {}): BoardCardRecord {
  const st = boardStore();
  const cardId = `bc_${st.listCards().length + 1}`;
  const spec = patch.spec ?? "Do the thing";
  const card: BoardCardRecord = {
    cardId,
    bountyId: `b_${cardId}`,
    title: `Card ${cardId}`,
    spec,
    specHash: computeSpecHash(spec),
    column: "todo",
    budgetUsdc: "50",
    createdAt: "2026-01-01T00:00:00Z",
    payload: {},
    ...patch,
  };
  st.createCard(card);
  upsertBounty({
    bountyId: card.bountyId,
    title: card.title,
    brief: { criteria: [], deliverableType: "pr" },
    budgetUsdc: card.budgetUsdc ?? "0",
    status: "open",
    jobAttempt: 1,
    createdAt: card.createdAt,
  });
  return st.getCard(cardId)!;
}

function app(): Hono {
  const a = new Hono();
  a.route("/", createBoardPageRoutes({ isReviewer: () => true }));
  return a;
}
const get = (p: string) => app().fetch(new Request(`http://x${p}`));

function seedAll() {
  useMemoryBoardStoreForTesting();
  useMemoryBountyStoreForTesting();
  for (const col of COLUMNS) seedCard({ column: col });
}

describe("GET /board — kanban", () => {
  it("renders all 7 columns with cards in the right column", async () => {
    seedAll();
    const html = await (await get("/board")).text();
    for (const col of COLUMNS) {
      expect(html).toContain(`data-column="${col}"`);
    }
    expect((await get("/board")).status).toBe(200);
    const body = html;
    expect(body).toContain("Card bc_1");
    expect(body).toContain("$50");
  });

  it("empty board → all columns render, no crash", async () => {
    useMemoryBoardStoreForTesting();
    const html = await (await get("/board")).text();
    for (const col of COLUMNS) expect(html).toContain(`data-column="${col}"`);
    expect(html).toContain("0");
  });

  it("XSS: <script> in title/spec is escaped", async () => {
    useMemoryBoardStoreForTesting();
    seedCard({ title: "<script>alert(1)</script>", column: "todo" });
    const html = await (await get("/board")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("todo card shows Claim affordance; bug shows resubmit; review shows review CTA", async () => {
    useMemoryBoardStoreForTesting();
    seedCard({ column: "todo" });
    seedCard({
      column: "bug",
      currentPassportId: "ps_holder",
      fixDeadlineMs: 1_700_000_100_000,
    });
    seedCard({ column: "review" });
    const html = await (await get("/board?me=ps_holder")).text();
    expect(html).toContain('data-action="claim"');
    expect(html).toContain('data-action="resubmit"');
    expect(html).toContain('data-action="review"');
  });

  it("claim button hidden for cards in non-todo columns", async () => {
    useMemoryBoardStoreForTesting();
    seedCard({ column: "done" });
    const html = await (await get("/board")).text();
    expect(html).not.toContain('data-action="claim"');
  });
});

describe("GET /board/cards/:id — detail", () => {
  it("spec + chronological journal, XSS-escaped comment", async () => {
    useMemoryBoardStoreForTesting();
    const card = seedCard({ spec: "spec <img onerror=x>" });
    const st = boardStore();
    st.appendEntry({
      id: "be_1",
      cardId: card.cardId,
      seq: 1,
      attempt: 1,
      kind: "create",
      actor: "ops_1",
      atMs: 1,
      payload: {},
    });
    st.appendEntry({
      id: "be_2",
      cardId: card.cardId,
      seq: 2,
      attempt: 1,
      kind: "review",
      actor: "ps_r",
      atMs: 2,
      payload: { comment: "<script>x</script>" },
    });
    const res = await get(`/board/cards/${card.cardId}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<img onerror=x>");
    expect(html).not.toContain("<script>x</script>");
    expect(html.indexOf("be_1")).toBeLessThan(html.indexOf("be_2"));
  });

  it("unknown card → 404", async () => {
    useMemoryBoardStoreForTesting();
    const res = await get("/board/cards/nope");
    expect(res.status).toBe(404);
  });
});
