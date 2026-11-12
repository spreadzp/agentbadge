/**
 * SLICE-207-3: emitter tests — each source maps to a valid canonical
 * event; appends are idempotent (re-emit + backfill re-run → dups);
 * explicit `ledger: null` models DATABASE_ENABLED=false (no-op).
 */

import { describe, expect, it } from "vitest";
import { InMemoryEconLedgerStore } from "@agentbadge/database";
import { validateEconomicEvent } from "@agentbadge/econ-events";
import { boardEntryToEconomic } from "../src/server/lib/econ-ledger/board.js";
import { marketStatusToEconomic } from "../src/server/lib/econ-ledger/market.js";
import { venueJobToEconomic } from "../src/server/lib/econ-ledger/venue.js";
import { verdictToEconomic } from "../src/server/lib/econ-ledger/eaas.js";
import { settleToEconomic } from "../src/server/lib/econ-ledger/x402.js";
import {
  emitEconomicBatch,
  emitEconomicEvent,
} from "../src/server/lib/econ-ledger/emit.js";
import type { BuildEventInput } from "@agentbadge/econ-events";

const HEX32 = `0x${"ab".repeat(32)}`;
const NOW_MS = Date.parse("2026-10-25T00:00:00Z");
const NOW_ISO = new Date(NOW_MS).toISOString();

function valid(input: BuildEventInput) {
  // build+validate would happen inside emit; here we assert the INPUT
  // shape passes the canonical schema when wrapped by the builder.
  const built = {
    spec: "econ-events/1",
    id: "evt_" + "00".repeat(12),
    idempotencyKey: `ev:${input.source}:${input.sourceId}:${input.seq}`,
    ...input,
  };
  const r = validateEconomicEvent(built);
  expect(r.ok, JSON.stringify(r)).toBe(true);
}

describe("board mapper", () => {
  const entry = (kind: string, payload?: Record<string, unknown>) => ({
    id: "e1",
    cardId: "card-9",
    seq: 3,
    attempt: 1,
    kind,
    actor: "agent-executor-1",
    txHash: HEX32,
    payload,
    atMs: NOW_MS,
  });

  it("create → work_offer with taskRef/specHash", () => {
    const out = boardEntryToEconomic(
      entry("create", { specHash: HEX32, budgetUsdc: "2.50" }) as never,
    )!;
    expect(out.kind).toBe("work_offer");
    expect(out.source).toBe("board");
    expect(out.sourceId).toBe("card-9");
    expect(out.seq).toBe(3);
    expect(out.at).toBe(NOW_ISO);
    valid(out);
  });

  it("claim → work_accept", () => {
    const out = boardEntryToEconomic(entry("claim") as never)!;
    expect(out.kind).toBe("work_accept");
    valid(out);
  });

  it("submit → deliver only with hex32 deliverableHash", () => {
    expect(boardEntryToEconomic(entry("submit") as never)).toBeNull();
    const out = boardEntryToEconomic(
      entry("submit", { deliverableHash: HEX32 }) as never,
    )!;
    expect(out.kind).toBe("deliver");
    valid(out);
  });

  it("qa → verify; done → verify pass; note/bug → null", () => {
    expect(boardEntryToEconomic(entry("qa") as never)!.kind).toBe("verify");
    const done = boardEntryToEconomic(entry("done", { score: 4 }) as never)!;
    expect(done.kind).toBe("verify");
    valid(done);
    expect(boardEntryToEconomic(entry("note") as never)).toBeNull();
    expect(boardEntryToEconomic(entry("bug") as never)).toBeNull();
  });

  it("rating → reputation_write requires subject+score", () => {
    expect(boardEntryToEconomic(entry("rating") as never)).toBeNull();
    const out = boardEntryToEconomic(
      entry("rating", { subjectAgent: "agent-1", score: 5 }) as never,
    )!;
    expect(out.kind).toBe("reputation_write");
    valid(out);
  });
});

describe("market mapper", () => {
  const task = {
    taskId: "0.0.5001",
    posterDid: "did:hcs:testnet:0.0.1001:1",
    claimerDid: "did:hcs:testnet:0.0.2002:1",
    priceHbar: 12.5,
    paymentTxId: "0x" + "cd".repeat(32),
    completedTxId: "0x" + "ef".repeat(32),
  };

  it("claimed → work_accept (DID→address actors)", () => {
    const out = marketStatusToEconomic("claimed", task);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("work_accept");
    expect(out[0]!.actor).toBe("0.0.2002");
    expect(out[0]!.counterparty).toBe("0.0.1001");
    expect(out[0]!.seq).toBe(1);
    valid(out[0]!);
  });

  it("delivered → deliver", () => {
    const out = marketStatusToEconomic("delivered", task);
    expect(out[0]!.kind).toBe("deliver");
    valid(out[0]!);
  });

  it("completed → verify + escrow pay leg", () => {
    const out = marketStatusToEconomic("completed", task);
    expect(out.map((e) => e.kind)).toEqual(["verify", "pay"]);
    expect(out[1]!.amountUsdc).toBe("12.5");
    valid(out[0]!);
    valid(out[1]!);
  });

  it("cancelled → work_offer with cancelled terms; posted → []", () => {
    const out = marketStatusToEconomic("cancelled", task);
    expect(out[0]!.kind).toBe("work_offer");
    valid(out[0]!);
    expect(marketStatusToEconomic("posted", task)).toEqual([]);
  });
});

describe("venue mapper", () => {
  const job = {
    jobId: "vj-7",
    onchainJobId: 42,
    title: "t",
    description: "d",
    budgetUsdc: 8,
    client: "0xclient",
    provider: "0xprov",
    evaluator: "0xeval",
    deliverableHash: HEX32,
  };

  it("funded → pay escrow leg with amount", () => {
    const out = venueJobToEconomic({ ...job, status: "funded" } as never);
    expect(out[0]!.kind).toBe("pay");
    expect(out[0]!.amountUsdc).toBe("8");
    expect(out[0]!.seq).toBe(1);
    valid(out[0]!);
  });

  it("submitted → deliver (requires hex32 hash)", () => {
    const out = venueJobToEconomic({ ...job, status: "submitted" } as never);
    expect(out[0]!.kind).toBe("deliver");
    valid(out[0]!);
    expect(
      venueJobToEconomic({ ...job, status: "submitted", deliverableHash: "ipfs" } as never),
    ).toEqual([]);
  });

  it("completed → verify pass; rejected → verify fail; open → []", () => {
    expect(venueJobToEconomic({ ...job, status: "completed" } as never)[0]!.kind).toBe("verify");
    const rej = venueJobToEconomic({ ...job, status: "rejected" } as never)[0]!;
    expect(rej.kind).toBe("verify");
    valid(rej);
    expect(venueJobToEconomic({ ...job, status: "open" } as never)).toEqual([]);
  });
});

describe("eaas mapper", () => {
  it("approve verdict → verify pass", () => {
    const out = verdictToEconomic({
      artifact: {
        verdictId: HEX32,
        kind: "approve",
        policy: "deliverable-present",
        deliverableHash: HEX32,
        evaluator: "0xeval",
        issuedAt: NOW_ISO,
        chainId: 5042002,
      },
      consumerWallet: "0xconsumer",
    } as never);
    expect(out.source).toBe("eaas");
    expect(out.sourceId).toBe(HEX32);
    expect(out.seq).toBe(1);
    valid(out);
  });

  it("verify carries policyRef + verifierVersion from artifact (207-9)", () => {
    const out = verdictToEconomic({
      artifact: {
        verdictId: HEX32,
        kind: "approve",
        policy: "deliverable-present",
        deliverableHash: HEX32,
        evaluator: "0xeval",
        issuedAt: NOW_ISO,
        chainId: 5042002,
      },
      consumerWallet: "0xconsumer",
    } as never);
    const p = out.payload as Record<string, unknown>;
    expect(p.policyRef).toBe("deliverable-present");
    expect(p.verifierVersion).toBe("AgentBadgeVerdict@1");
    valid(out);
  });
});

describe("x402 mapper", () => {
  it("settled payment → pay leg, atomic → USDC", () => {
    const out = settleToEconomic({
      payer: "0xpayer",
      payTo: "0xpayee",
      amountAtomic: "5000000",
      tx: HEX32,
      network: "arc-testnet",
      scheme: "exact",
    });
    expect(out.kind).toBe("pay");
    expect(Number(out.amountUsdc)).toBe(5);
    expect(out.sourceId).toBe(HEX32);
    valid(out);
  });

  it("resource → payload.endpoint; absent resource → field omitted (242-8)", () => {
    const withRes = settleToEconomic({
      payer: "0xpayer",
      payTo: "0xpayee",
      amountAtomic: "5000000",
      network: "arc",
      scheme: "exact",
      resource: "/api/total-scan",
    });
    expect((withRes.payload as Record<string, unknown>).endpoint).toBe(
      "/api/total-scan",
    );
    valid(withRes);

    const noRes = settleToEconomic({
      payer: "0xpayer",
      payTo: "0xpayee",
      amountAtomic: "5000000",
      network: "arc",
      scheme: "exact",
    });
    expect((noRes.payload as Record<string, unknown>).endpoint).toBeUndefined();
    valid(noRes);
  });

  it("missing tx → deterministic sourceId still dedupes", () => {
    const leg = {
      payer: "0xpayer",
      payTo: "0xpayee",
      amountAtomic: 1000000n,
      network: "arc",
      scheme: "exact",
    };
    const a = settleToEconomic(leg);
    const b = settleToEconomic(leg);
    expect(a.sourceId).toBe(b.sourceId);
    valid(a);
  });
});

describe("append semantics (in-memory ledger)", () => {
  it("re-emit of same input dedupes via idempotency key", async () => {
    const ledger = new InMemoryEconLedgerStore();
    const input = settleToEconomic({
      payer: "0xp",
      payTo: "0xq",
      amountAtomic: "1000000",
      tx: HEX32,
      network: "arc",
      scheme: "exact",
    });
    const first = await emitEconomicBatch([input], ledger);
    expect(first.appended).toBe(1);
    const second = await emitEconomicBatch([input], ledger);
    expect(second).toMatchObject({ appended: 0, duplicate: 1 });
    expect(await ledger.scan(0n)).toHaveLength(1);
  });

  it("ledger:null (DATABASE_ENABLED=false) is a no-op, never throws", () => {
    expect(() =>
      emitEconomicEvent(
        {
          source: "x402",
          sourceId: "t",
          seq: 1,
          kind: "pay",
          actor: "0xp",
          at: NOW_ISO,
          payload: { rail: "x402" },
        },
        null,
      ),
    ).not.toThrow();
  });

  it("invalid input is dropped, not thrown", async () => {
    const ledger = new InMemoryEconLedgerStore();
    const res = await emitEconomicBatch(
      [
        {
          source: "x",
          sourceId: "s",
          seq: 1,
          kind: "not-a-kind",
          actor: "a",
          at: NOW_ISO,
          payload: {},
        },
      ],
      ledger,
    );
    expect(res.dropped).toBe(1);
    expect(res.appended).toBe(0);
  });
});
