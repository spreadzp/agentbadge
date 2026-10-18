/**
 * SLICE-201-2 (EPIC-201): Task Receipt endpoint — a done board card projects
 * to a portable, EIP-712-signed receipt ("AgentBadgeReceipt" domain). The
 * external verifier recovers the platform signer via verifyTypedData — zero
 * trust in our API (D-201-2: projection, no new store).
 *
 *   happy path   DONE card → 200 + agent/task/evidence/payment/signature
 *   determinism  same card → identical signature on repeat GET
 *   404          unknown cardId
 *   409          card not in terminal state (column ≠ done)
 */
import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import { ethers } from "ethers";
import { type Hex } from "viem";

import { useMemoryBoardStoreForTesting } from "../src/server/lib/board/json-store";
import { boardStore } from "../src/server/lib/board/store";
import {
  newEntryId,
  newOutboxId,
  newReputationId,
  computeSpecHash,
  type BoardCardRecord,
} from "../src/server/lib/board/types";
import {
  buildReceiptDomain,
  buildTaskReceipt,
  createReceiptSigner,
  verifyTaskReceiptSignature,
  RECEIPT_DOMAIN_NAME,
} from "../src/server/lib/board/task-receipt";
import { createReceiptRoutes } from "../src/server/routes/board-api-receipt";
import { ReceiptSchemaV1 } from "../src/server/lib/board/task-receipt-schema";

const SPEC = "## Fix flaky bounty e2e\nRun bunx vitest run until green.";
const CHAIN_ID = 5042002;
const SIGNER_KEY = `0x${"11".repeat(32)}` as Hex;
const SIGNER = createReceiptSigner(SIGNER_KEY, CHAIN_ID);
const PAYOUT = "0xabc00000000000000000000000000000000000aa";
const ESCROW = "0x8183abc00000000000000000000000000000000f";
const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const COMPLETE_TX = `0x${"cd".repeat(32)}` as Hex;
const SUBMIT_TX = `0x${"ef".repeat(32)}` as Hex;

function seedDoneCard(): BoardCardRecord {
  const st = boardStore();
  const card: BoardCardRecord = {
    cardId: "board_receipt1",
    bountyId: "bounty_r1",
    column: "done",
    title: "Fix flaky e2e",
    budgetUsdc: "25.00",
    specHash: computeSpecHash(SPEC),
    spec: SPEC,
    createdBy: "ops",
    currentPassportId: "passport_77",
    payload: { onchainJobId: "42" },
    createdAt: "2026-10-18T10:00:00.000Z",
  };
  st.createCard(card);
  const entries = [
    { seq: 1, kind: "claim", actor: "passport_77", attempt: 1, payload: { payoutWallet: PAYOUT } },
    { seq: 2, kind: "submit", actor: "passport_77", attempt: 1, txHash: SUBMIT_TX },
    { seq: 3, kind: "done", actor: "ops", attempt: 1 },
  ] as const;
  for (const e of entries) {
    st.appendEntry({
      id: newEntryId(),
      cardId: card.cardId,
      seq: e.seq,
      attempt: e.attempt,
      kind: e.kind,
      actor: e.actor,
      atMs: 1_760_000_000_000 + e.seq * 1000,
      ...(e as { txHash?: string }).txHash ? { txHash: (e as { txHash: string }).txHash } : {},
      ...(e as { payload?: Record<string, unknown> }).payload
        ? { payload: (e as { payload: Record<string, unknown> }).payload }
        : {},
    });
  }
  st.enqueueOutbox({
    id: newOutboxId(),
    kind: "complete",
    cardId: card.cardId,
    jobAttempt: 1,
    idempotencyKey: `board:${card.cardId}:1:complete`,
    status: "confirmed",
    txHash: COMPLETE_TX,
    attempts: 1,
    payload: { jobId: "42" },
    createdAt: "2026-10-18T12:00:00.000Z",
  });
  st.putReputation({
    id: newReputationId(),
    sourceType: "board",
    sourceId: card.cardId,
    jobAttempt: 1,
    passportId: "passport_77",
    agentId: "8004-agent-99",
    score: 5,
    status: "sent",
    attempts: 1,
  });
  return card;
}

function makeApp() {
  const app = new Hono();
  app.route(
    "/",
    createReceiptRoutes({
      signer: SIGNER,
      chainId: CHAIN_ID,
      agentRegistry: REGISTRY,
      escrowAddress: ESCROW,
      cache: null,
    }),
  );
  return app;
}

describe("buildTaskReceipt", () => {
  beforeEach(() => useMemoryBoardStoreForTesting());

  it("projects a DONE card into a full receipt", async () => {
    seedDoneCard();
    const r = await buildTaskReceipt("board_receipt1", {
      signer: SIGNER,
      chainId: CHAIN_ID,
      agentRegistry: REGISTRY,
      escrowAddress: ESCROW,
    });
    expect(r).not.toBeNull();
    expect(r!.task.id).toBe("board_receipt1");
    expect(r!.task.title).toBe("Fix flaky e2e");
    expect(r!.task.specHash).toBe(computeSpecHash(SPEC));
    expect(r!.agent.agentId).toBe("8004-agent-99");
    expect(r!.agent.agentRegistry).toBe(REGISTRY);
    expect(r!.payment?.to).toBe(PAYOUT);
    expect(r!.payment.txHash).toBe(COMPLETE_TX);
    expect(r!.payment.chainId).toBe(CHAIN_ID);
    expect(r!.evidence.txHashes).toContain(SUBMIT_TX);
    expect(r!.signature).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("returns null for an unknown card", async () => {
    expect(
      await buildTaskReceipt("nope", {
        signer: SIGNER,
        chainId: CHAIN_ID,
        agentRegistry: REGISTRY,
        escrowAddress: ESCROW,
      }),
    ).toBeNull();
  });

  it("returns 'not-terminal' for a non-done card", async () => {
    const st = boardStore();
    st.createCard({
      cardId: "board_wip",
      bountyId: "bounty_w",
      column: "in_progress",
      title: "wip",
      specHash: computeSpecHash(SPEC),
      spec: SPEC,
      createdAt: "2026-10-18T10:00:00.000Z",
    });
    expect(
      await buildTaskReceipt("board_wip", {
        signer: SIGNER,
        chainId: CHAIN_ID,
        agentRegistry: REGISTRY,
        escrowAddress: ESCROW,
      }),
    ).toEqual({ error: "not-terminal" });
  });

  it("is deterministic — same card → identical signature", async () => {
    seedDoneCard();
    const deps = {
      signer: SIGNER,
      chainId: CHAIN_ID,
      agentRegistry: REGISTRY,
      escrowAddress: ESCROW,
    };
    const a = await buildTaskReceipt("board_receipt1", deps);
    const b = await buildTaskReceipt("board_receipt1", deps);
    expect(a && "task" in a && a.signature).toBe(b && "task" in b && b.signature);
  });
});

describe("EIP-712 signature", () => {
  beforeEach(() => useMemoryBoardStoreForTesting());

  it("verifyTypedData recovers the platform signer", async () => {
    seedDoneCard();
    const r = await buildTaskReceipt("board_receipt1", {
      signer: SIGNER,
      chainId: CHAIN_ID,
      agentRegistry: REGISTRY,
      escrowAddress: ESCROW,
    });
    expect(r && "task" in r && verifyTaskReceiptSignature(r as never)).toBe(true);
    // independent ethers recover — the external verifier path
    const body = (r as { body: Record<string, bigint | string> }).body;
    const recovered = ethers.verifyTypedData(
      buildReceiptDomain(CHAIN_ID),
      {
        TaskReceipt: [
          { name: "taskId", type: "string" },
          { name: "bountyId", type: "string" },
          { name: "specHash", type: "bytes32" },
          { name: "attempt", type: "uint256" },
          { name: "receiptHash", type: "bytes32" },
          { name: "issuedAt", type: "string" },
          { name: "chainId", type: "uint256" },
        ]
      },
      body,
      (r as { signature: Hex }).signature,
    );
    expect(recovered.toLowerCase()).toBe(SIGNER.address.toLowerCase());
  });

  it("detects tampering — modified specHash invalidates signature", async () => {
    seedDoneCard();
    const r = (await buildTaskReceipt("board_receipt1", {
      signer: SIGNER,
      chainId: CHAIN_ID,
      agentRegistry: REGISTRY,
      escrowAddress: ESCROW,
    })) as { task: { specHash: string }; body: Record<string, unknown>; signature: Hex };
    const tampered = {
      ...r,
      body: { ...r.body, specHash: `0x${"00".repeat(32)}` },
    };
    expect(verifyTaskReceiptSignature(tampered as never)).toBe(false);
  });
});

describe("schema", () => {
  it("RECEIPT domain name is AgentBadgeReceipt", () => {
    expect(RECEIPT_DOMAIN_NAME).toBe("AgentBadgeReceipt");
  });

  it("schema v1 validates a built receipt", async () => {
    useMemoryBoardStoreForTesting();
    seedDoneCard();
    const r = await buildTaskReceipt("board_receipt1", {
      signer: SIGNER,
      chainId: CHAIN_ID,
      agentRegistry: REGISTRY,
      escrowAddress: ESCROW,
    });
    const { body: _body, ...publicReceipt } = r as Record<string, unknown>;
    expect(ReceiptSchemaV1.safeParse(publicReceipt).success).toBe(true);
  });
});

describe("GET /api/board/cards/:id/receipt", () => {
  beforeEach(() => useMemoryBoardStoreForTesting());

  it("returns 200 + receipt for a DONE card", async () => {
    seedDoneCard();
    const res = await makeApp().request("/api/board/cards/board_receipt1/receipt");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe("board_receipt1");
    expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(body.agent.agentId).toBe("8004-agent-99");
  });

  it("404 on unknown card", async () => {
    const res = await makeApp().request("/api/board/cards/unknown/receipt");
    expect(res.status).toBe(404);
  });

  it("409 on non-terminal card", async () => {
    boardStore().createCard({
      cardId: "board_live",
      bountyId: "bounty_l",
      column: "testing",
      title: "live",
      specHash: computeSpecHash(SPEC),
      spec: SPEC,
      createdAt: "2026-10-18T10:00:00.000Z",
    });
    const res = await makeApp().request("/api/board/cards/board_live/receipt");
    expect(res.status).toBe(409);
  });

  it("repeat GET yields identical signature (immutability)", async () => {
    seedDoneCard();
    const app = makeApp();
    const a = await (await app.request("/api/board/cards/board_receipt1/receipt")).json();
    const b = await (await app.request("/api/board/cards/board_receipt1/receipt")).json();
    expect(a.signature).toBe(b.signature);
  });
});
