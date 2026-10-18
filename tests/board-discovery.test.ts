/**
 * SLICE-201-3 (EPIC-201): board discovery layer — an external agent must be
 * able to find the Arc task board and follow find → terms → claim → submit →
 * receipt without reading our code (D-201-6: no NEW REST endpoints — the
 * discovery surface wraps the existing ones).
 *
 *   MCP contract  board_list == REST /api/board/cards projection
 *   MCP           board_get / board_claim_status expose card + claim state
 *   Guide page    /agent-guide/hire-or-get-hired serves md + .json
 *   llms.txt      contains an Arc Task Board section with the workflow
 *   agent-card    buildAgentCard output advertises task_board capability
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { handleHttpToolCall, listTools } from "@agentbadge/mcp";

import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import { boardStore } from "../src/server/lib/board/store";
import { computeSpecHash } from "../src/server/lib/board/types";
import { createBoardReadRoutes } from "../src/server/routes/board-api-read";
import { createBoardGuideRoutes } from "../src/server/routes/agent-guide-hire";
import { registerBoardTools } from "../src/mcp/board-tools";
import { buildAgentCard } from "../src/server/lib/agent-discovery";

const SPEC = "## Fix flaky bounty e2e\nRun bunx vitest run until green.";

function seedCard(column: "todo" | "in_progress" | "done" = "todo") {
  const st = boardStore();
  st.createCard({
    cardId: "board_disco1",
    bountyId: "bounty_d1",
    column,
    title: "Discovery task",
    budgetUsdc: "10.00",
    specHash: computeSpecHash(SPEC),
    spec: SPEC,
    createdAt: "2026-10-18T10:00:00.000Z",
  });
}

function toolJson(result: { content: { type: string; text?: string }[] }) {
  const text = result.content[0]?.text;
  expect(typeof text).toBe("string");
  return JSON.parse(text!);
}

describe("MCP board tools", () => {
  beforeEach(() => {
    useMemoryBoardStoreForTesting();
    registerBoardTools();
  });

  it("board_list is registered and returns the same cards as REST", async () => {
    seedCard();
    const tools = listTools().map((t) => t.name);
    expect(tools).toContain("board_list");
    expect(tools).toContain("board_get");
    expect(tools).toContain("board_claim_status");

    const rest = new Hono();
    rest.route("/", createBoardReadRoutes({ cache: null }));
    const restBody = (await (
      await rest.request("/api/board/cards")
    ).json()) as { cards: { cardId: string; title: string }[] };

    const mcp = toolJson(await handleHttpToolCall("board_list", {}));
    expect(mcp.cards.length).toBe(restBody.cards.length);
    expect(mcp.cards[0].cardId).toBe(restBody.cards[0].cardId);
    expect(mcp.cards[0].title).toBe(restBody.cards[0].title);
    // Same public projection — spec internals never leak.
    expect(mcp.cards[0]).not.toHaveProperty("spec");
  });

  it("board_get returns one card by id", async () => {
    seedCard("in_progress");
    const mcp = toolJson(
      await handleHttpToolCall("board_get", { card_id: "board_disco1" }),
    );
    expect(mcp.card.cardId).toBe("board_disco1");
    expect(mcp.card.column).toBe("in_progress");
    expect(mcp.card).not.toHaveProperty("spec");
  });

  it("board_get returns an error for unknown card", async () => {
    const result = await handleHttpToolCall("board_get", { card_id: "nope" });
    expect(result.isError).toBe(true);
  });

  it("board_claim_status reports claimability", async () => {
    seedCard("todo");
    const mcp = toolJson(
      await handleHttpToolCall("board_claim_status", {
        card_id: "board_disco1",
      }),
    );
    expect(mcp.cardId).toBe("board_disco1");
    expect(mcp.claimable).toBe(true);
    expect(mcp.executorPassportId).toBeNull();
  });
});

describe("agent-guide hire page", () => {
  it("serves markdown at /agent-guide/hire-or-get-hired", async () => {
    const app = new Hono();
    app.route("/", createBoardGuideRoutes());
    const res = await app.request("/agent-guide/hire-or-get-hired");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("/api/board/cards");
    expect(md).toContain("receipt");
    expect(md).toContain("agents/register");
  });

  it("serves JSON at /agent-guide/hire-or-get-hired.json", async () => {
    const app = new Hono();
    app.route("/", createBoardGuideRoutes());
    const res = await app.request("/agent-guide/hire-or-get-hired.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workflow: string[] };
    expect(Array.isArray(body.workflow)).toBe(true);
    expect(body.workflow).toContain("claim");
  });
});

describe("llms.txt", () => {
  it("documents the Arc Task Board workflow", async () => {
    const llms = await readFile("public/llms.txt", "utf-8");
    expect(llms).toContain("Task Board");
    expect(llms).toContain("/api/board/cards");
    expect(llms).toContain("/receipt");
    expect(llms).toContain("claim");
  });
});

describe("agent-card", () => {
  it("advertises task-board participation", () => {
    const card = JSON.parse(
      buildAgentCard({
        baseUrl: "https://agentbadge.xyz",
        authSection: "",
        llmsCore: "",
        articles: [],
        faqEntries: [],
        tiers: [],
        appRoutes: [],
        didEnabled: false,
        now: new Date("2026-10-18T00:00:00.000Z"),
      }),
    );
    const caps = card["x-agentbadge"].capabilities as string[];
    expect(caps).toContain("task_board");
    const eps = card["x-agentbadge"].endpoints as Record<string, string>;
    expect(eps.board).toContain("/api/board/cards");
    expect(eps.task_receipt_schema).toContain("task-receipt.schema.json");
  });
});
