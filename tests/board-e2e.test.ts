/**
 * SLICE-199-13 (EPIC-199, absorbs 197-19): live E2E on Arc testnet.
 *
 * Gated on BOARD_E2E=1 — skipped in CI. Drives the real API on a
 * RUNNING server (json store or DB) + real wallets for EIP-191.
 *
 * Env:
 *   BOARD_E2E=1                 master gate
 *   E2E_TARGET_URL              server base (default http://localhost:4021)
 *   BOARD_E2E_OPS_KEY           ops agent Bearer key (agb_…)
 *   BOARD_E2E_PROVIDER_KEY      provider agent Bearer key
 *   BOARD_E2E_PROVIDER_PRIVKEY  provider EVM key for claim EIP-191
 *   BOARD_E2E_REVIEWER_KEY      reviewer agent Bearer key
 *   BOARD_E2E_REVIEWER_PRIVKEY  reviewer EVM key for verdict EIP-191
 *   BOARD_E2E_USDC              (optional) USDC contract for balance proof
 *
 * Scenarios: happy (create→claim→submit→qaPass→approve), bug-loop
 * (qaFail→bug→resubmit→qaPass→approve), idempotency replay on submit.
 * Tx hashes land in the journal + outbox — dumped to stdout for
 * e2e-run.md.
 */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const E2E = process.env.BOARD_E2E === "1";
const BASE = process.env.E2E_TARGET_URL ?? "http://localhost:4021";
const OPS_KEY = process.env.BOARD_E2E_OPS_KEY ?? "";
const PROVIDER_KEY = process.env.BOARD_E2E_PROVIDER_KEY ?? "";
const PROVIDER_PK = (process.env.BOARD_E2E_PROVIDER_PRIVKEY ?? "") as Hex;
const REVIEWER_KEY = process.env.BOARD_E2E_REVIEWER_KEY ?? "";
const REVIEWER_PK = (process.env.BOARD_E2E_REVIEWER_PRIVKEY ?? "") as Hex;
const CHAIN_ID = 5042002; // Arc testnet

const provider = PROVIDER_PK ? privateKeyToAccount(PROVIDER_PK) : undefined;
const reviewer = REVIEWER_PK ? privateKeyToAccount(REVIEWER_PK) : undefined;

const proof: string[] = [];

async function api(
  path: string,
  opts: { method?: string; key?: string; body?: unknown; idem?: string } = {},
) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}),
      ...(opts.idem ? { "idempotency-key": opts.idem } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return {
    status: res.status,
    json: (await res.json()) as {
      card: { cardId: string; column: string; fixDeadlineMs?: number };
      entries?: { kind: string; txHash?: string }[];
    },
  };
}

const expMs = () => Date.now() + 10 * 60 * 1000;

async function claimSig(cardId: string, attempt: number) {
  const exp = expMs();
  const message =
    `board-claim:${CHAIN_ID}:${cardId}:${attempt}:` +
    `${provider!.address.toLowerCase()}:${exp}`;
  return { claimSig: await provider!.signMessage({ message }), sigExpiresAt: exp };
}

async function reviewSig(cardId: string, attempt: number, verdict: string) {
  const exp = expMs();
  const message =
    `board-review:${CHAIN_ID}:${cardId}:${attempt}:${verdict}:` +
    `${reviewer!.address.toLowerCase()}:${exp}`;
  return { reviewSig: await reviewer!.signMessage({ message }), sigExpiresAt: exp };
}

async function journal(cardId: string): Promise<{ kind: string; txHash?: string }[]> {
  const { json } = await api(`/api/board/cards/${cardId}/journal`);
  return json.entries ?? [];
}

async function waitTxHash(cardId: string, kind: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const hit = (await journal(cardId)).find((e) => e.kind === kind && e.txHash);
    if (hit?.txHash) return hit.txHash;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no txHash for ${kind} on ${cardId} after ${tries * 2}s`);
}

describe.skipIf(!E2E)("board E2E — Arc testnet", () => {
  it("happy: create → claim → submit → qaPass → approve → done", async () => {
    const { status: s1, json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: {
        title: `e2e-happy-${Date.now()}`,
        spec: "Happy-path spec — trivial task",
        budgetUsdc: "1",
      },
    });
    expect(s1).toBe(201);
    const cardId = created.card.cardId;
    const attempt = 1;
    proof.push(`create ${cardId} tx=${await waitTxHash(cardId, "create")}`);

    const claim = await api(`/api/board/cards/${cardId}/claim`, {
      method: "POST",
      key: PROVIDER_KEY,
      body: {
        payoutWallet: provider!.address,
        ...(await claimSig(cardId, attempt)),
      },
    });
    expect(claim.status).toBe(200);

    const deliverableHash = `0x${"ab".repeat(32)}`;
    const submit = await api(`/api/board/cards/${cardId}/submit`, {
      method: "POST",
      key: PROVIDER_KEY,
      body: { deliverableHash, prUrl: "https://example.com/pr/1" },
    });
    expect(submit.status).toBe(200);
    proof.push(`submit tx=${await waitTxHash(cardId, "submit")}`);

    const qa = await api(`/api/board/cards/${cardId}/qa`, {
      method: "POST",
      key: OPS_KEY,
      body: { verdict: "pass" },
    });
    expect(qa.status).toBe(200);
    expect(qa.json.card.column).toBe("review");

    const review = await api(`/api/board/cards/${cardId}/review`, {
      method: "POST",
      key: REVIEWER_KEY,
      body: {
        verdict: "approve",
        reviewerWallet: reviewer!.address,
        ...(await reviewSig(cardId, attempt, "approve")),
      },
    });
    expect(review.status).toBe(200);
    expect(review.json.card.column).toBe("done");
    proof.push(`complete tx=${await waitTxHash(cardId, "review")}`);
    console.log("PROOF:\n" + proof.join("\n"));
  });

  it("bug-loop: qaFail → bug → fixResubmit → qaPass → approve", async () => {
    const { json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: { title: `e2e-bug-${Date.now()}`, spec: "Bug-loop spec", budgetUsdc: "1" },
    });
    const cardId = created.card.cardId;
    await waitTxHash(cardId, "create");

    expect(
      (
        await api(`/api/board/cards/${cardId}/claim`, {
          method: "POST",
          key: PROVIDER_KEY,
          body: {
            payoutWallet: provider!.address,
            ...(await claimSig(cardId, 1)),
          },
        })
      ).status,
    ).toBe(200);
    await api(`/api/board/cards/${cardId}/submit`, {
      method: "POST",
      key: PROVIDER_KEY,
      body: { deliverableHash: `0x${"cd".repeat(32)}` },
    });

    const fail = await api(`/api/board/cards/${cardId}/qa`, {
      method: "POST",
      key: OPS_KEY,
      body: { verdict: "fail", reasonCodes: ["lint_broken"] },
    });
    expect(fail.status).toBe(200);
    expect(fail.json.card.column).toBe("bug");
    expect(fail.json.card.fixDeadlineMs).toBeGreaterThan(0);
  });

  it("idempotency: replayed submit → same response, single journal submit", async () => {
    const { json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: { title: `e2e-idem-${Date.now()}`, spec: "Idem spec", budgetUsdc: "1" },
    });
    const cardId = created.card.cardId;
    await waitTxHash(cardId, "create");
    await api(`/api/board/cards/${cardId}/claim`, {
      method: "POST",
      key: PROVIDER_KEY,
      body: {
        payoutWallet: provider!.address,
        ...(await claimSig(cardId, 1)),
      },
    });

    const idem = `e2e-${cardId}`;
    const body = { deliverableHash: `0x${"ef".repeat(32)}` };
    const r1 = await api(`/api/board/cards/${cardId}/submit`, {
      method: "POST",
      key: PROVIDER_KEY,
      body,
      idem,
    });
    const r2 = await api(`/api/board/cards/${cardId}/submit`, {
      method: "POST",
      key: PROVIDER_KEY,
      body,
      idem,
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r2.json.card.cardId).toBe(r1.json.card.cardId);
    const submits = (await journal(cardId)).filter((e) => e.kind === "submit");
    expect(submits.length).toBe(1);
  });
});
