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
 * (qaFail→bug→fix-deadline expiry→reopen attempt 2→full pass),
 * claim-lease expiry (claim→lease lapses→sweeper reopens→re-claim→pass),
 * idempotency replay on submit. Onchain legs are asserted directly via
 * getJob + USDC balanceOf — tx hashes land in the journal + outbox and
 * dump to stdout for e2e-run.md.
 *
 * Server envs the run needs for the expiry scenarios:
 *   BOARD_CLAIM_TTL_MS=45000 BOARD_FIX_TTL_MS=45000
 *   BOUNTY_SWEEPER_INTERVAL_MS=10000 BOARD_DISPATCHER_INTERVAL_MS=3000
 */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  erc20Abi,
  http,
  parseEventLogs,
  type Hex,
} from "viem";
import { ERC8183_REF_ABI, REF_STATUS } from "../src/server/lib/board/erc8183-ref";
import { ARC_TESTNET } from "@agentbadge/circle-payments";

const E2E = process.env.BOARD_E2E === "1";
const BASE = process.env.E2E_TARGET_URL ?? "http://localhost:4021";
const OPS_KEY = process.env.BOARD_E2E_OPS_KEY ?? "";
const PROVIDER_KEY = process.env.BOARD_E2E_PROVIDER_KEY ?? "";
const PROVIDER_PK = (process.env.BOARD_E2E_PROVIDER_PRIVKEY ?? "") as Hex;
const REVIEWER_KEY = process.env.BOARD_E2E_REVIEWER_KEY ?? "";
const REVIEWER_PK = (process.env.BOARD_E2E_REVIEWER_PRIVKEY ?? "") as Hex;
const CHAIN_ID = 5042002; // Arc testnet
const ESCROW = (process.env.ERC8183_REF_ADDRESS ??
  "0x0049e5362736c933055e502b3cf3ba90cc0bf6a0") as Hex;
const USDC = (process.env.BOARD_E2E_USDC ??
  ARC_TESTNET.usdc) as Hex | undefined;
const RPC_URL = process.env.BOARD_E2E_RPC ?? ARC_TESTNET.rpcUrl;

const provider = PROVIDER_PK ? privateKeyToAccount(PROVIDER_PK) : undefined;
const reviewer = REVIEWER_PK ? privateKeyToAccount(REVIEWER_PK) : undefined;
// D-199-7: the onchain job.provider is the SERVER provider EOA — it
// signs setPayoutReceiver/setBudget/submit; the agent wallet only
// receives the payout via payoutReceiver.
const SERVER_PROVIDER_EOA = (process.env.BOARD_E2E_SERVER_PROVIDER ??
  "0x67d43a4065dd69165061062b3128eda50f1f7c96").toLowerCase();

const chain = { id: CHAIN_ID, name: "arc-testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC_URL] } } } as const;
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

/** Decode the jobId off a confirmed createJob receipt (JobCreated). */
async function jobIdFromTx(txHash: string): Promise<bigint> {
  const receipt = await publicClient.getTransactionReceipt({
    hash: txHash as Hex,
  });
  const logs = parseEventLogs({
    abi: ERC8183_REF_ABI,
    eventName: "JobCreated",
    logs: receipt.logs,
  });
  const jobId = (logs[0]?.args as { jobId?: bigint } | undefined)?.jobId;
  if (jobId === undefined) throw new Error(`no JobCreated in ${txHash}`);
  return jobId;
}

async function readOnchainJob(jobId: bigint) {
  return (await publicClient.readContract({
    address: ESCROW,
    abi: ERC8183_REF_ABI,
    functionName: "getJob",
    args: [jobId],
  })) as { status: number; provider: Hex; payoutReceiver: Hex; budget: bigint };
}

async function usdcBalance(addr: Hex): Promise<bigint | null> {
  if (!USDC) return null;
  return publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

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

/** Poll the card until it lands on `column` (sweeper-driven moves). */
async function waitColumn(cardId: string, column: string, tries = 45) {
  for (let i = 0; i < tries; i++) {
    const { json } = await api(`/api/board/cards/${cardId}`);
    if (json.card?.column === column) return json.card;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`card ${cardId} never reached ${column}`);
}

async function waitEntry(cardId: string, kind: string, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const hit = (await journal(cardId)).find((e) => e.kind === kind);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`no ${kind} entry on ${cardId} after ${tries * 2}s`);
}

/** Full provider→reviewer pass for a card currently in `todo`. */
async function runPass(cardId: string, attempt: number, tag: string) {
  const claim = await api(`/api/board/cards/${cardId}/claim`, {
    method: "POST",
    key: PROVIDER_KEY,
    body: {
      payoutWallet: provider!.address,
      ...(await claimSig(cardId, attempt)),
    },
  });
  expect(claim.status).toBe(200);

  const submit = await api(`/api/board/cards/${cardId}/submit`, {
    method: "POST",
    key: PROVIDER_KEY,
    body: {
      deliverableHash: `0x${tag.repeat(2).padEnd(64, "0")}`,
      prUrl: `https://example.com/pr/${tag}`,
    },
  });
  expect(submit.status).toBe(200);
  proof.push(`submit[${tag}] tx=${await waitTxHash(cardId, "submit")}`);

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
  proof.push(`complete[${tag}] tx=${await waitTxHash(cardId, "review")}`);
}

describe.skipIf(!E2E)("board E2E — Arc testnet", () => {
  it("happy: create → claim → submit → qaPass → approve → done (onchain)", async () => {
    const { status: s1, json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: {
        title: `e2e-happy-${Date.now()}`,
        spec: "Happy-path spec — trivial task",
        budgetUsdc: "0.25",
      },
    });
    expect(s1).toBe(201);
    const cardId = created.card.cardId;
    const createTx = await waitTxHash(cardId, "create");
    proof.push(`create ${cardId} tx=${createTx}`);

    // Onchain: the createJob leg landed — decode jobId from the receipt
    // and read the job struct back.
    const jobId = await jobIdFromTx(createTx);
    proof.push(`jobId=${jobId}`);
    const open = await readOnchainJob(jobId);
    expect(open.status).toBe(REF_STATUS.Open);

    const balBefore = await usdcBalance(provider!.address);
    await runPass(cardId, 1, "aa");

    // Onchain after approve: Completed — server EOA signed the provider
    // legs (D-199-7) while the agent's wallet is bound as payoutReceiver.
    const done = await readOnchainJob(jobId);
    expect(done.status).toBe(REF_STATUS.Completed);
    expect(done.provider.toLowerCase()).toBe(SERVER_PROVIDER_EOA);
    expect(done.payoutReceiver.toLowerCase()).toBe(
      provider!.address.toLowerCase(),
    );

    const balAfter = await usdcBalance(provider!.address);
    if (balBefore != null && balAfter != null) {
      proof.push(
        `provider USDC ${balBefore} → ${balAfter} (+${balAfter - balBefore})`,
      );
      expect(balAfter).toBeGreaterThan(balBefore);
    }
    console.log("PROOF:\n" + proof.join("\n"));
  });

  it("bug-loop: qaFail → bug → fix deadline expiry → reopen attempt 2 → pass", async () => {
    const { json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: {
        title: `e2e-bug-${Date.now()}`,
        spec: "Bug-loop spec",
        budgetUsdc: "0.25",
      },
    });
    const cardId = created.card.cardId;
    const jobId = await jobIdFromTx(await waitTxHash(cardId, "create"));

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
    await waitTxHash(cardId, "submit");

    const fail = await api(`/api/board/cards/${cardId}/qa`, {
      method: "POST",
      key: OPS_KEY,
      body: { verdict: "fail", reasonCodes: ["lint_broken"] },
    });
    expect(fail.status).toBe(200);
    expect(fail.json.card.column).toBe("bug");
    expect(fail.json.card.fixDeadlineMs).toBeGreaterThan(0);

    // Let the fix deadline lapse (server: BOARD_FIX_TTL_MS≈45s) — the
    // sweeper rejects the Submitted attempt-1 job and reopens on a fresh
    // attempt-2 job, card back to todo.
    await waitColumn(cardId, "todo");
    const reopen = await waitEntry(cardId, "reopen");
    proof.push(`reopen ${cardId} reason=${reopen.kind}`);

    // Old job rejected onchain (escrow released), new job created. The
    // sweeper enqueues reject + createJob BEFORE the card flips to todo,
    // so poll until the reject leg confirms instead of racing the outbox.
    let rejected = await readOnchainJob(jobId);
    for (
      let i = 0;
      i < 30 &&
      ![REF_STATUS.Rejected, REF_STATUS.Expired].includes(rejected.status);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 2000));
      rejected = await readOnchainJob(jobId);
    }
    expect([REF_STATUS.Rejected, REF_STATUS.Expired]).toContain(
      rejected.status,
    );

    // Attempt 2 — full pass on the new job.
    await runPass(cardId, 2, "bb");
    console.log("PROOF:\n" + proof.join("\n"));
  });

  it("expire: claim lease lapses → sweeper reopens → re-claim attempt 2 → pass", async () => {
    const { json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: {
        title: `e2e-expire-${Date.now()}`,
        spec: "Lease-expiry spec",
        budgetUsdc: "0.25",
      },
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

    // Never submit — let BOARD_CLAIM_TTL_MS lapse. The board claim
    // sweeper expires the lease, enqueues claimRefund (no-op on the
    // Open job) + createJob for attempt 2, card back to todo.
    await waitColumn(cardId, "todo");
    await waitEntry(cardId, "reopen");

    await runPass(cardId, 2, "ee");
    console.log("PROOF:\n" + proof.join("\n"));
  });

  it("idempotency: replayed submit → same response, single journal submit", async () => {
    const { json: created } = await api("/api/board/cards", {
      method: "POST",
      key: OPS_KEY,
      body: { title: `e2e-idem-${Date.now()}`, spec: "Idem spec", budgetUsdc: "0.25" },
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
