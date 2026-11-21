/**
 * SLICE-257-7: buyer contour E2E — full advisor acceptance matrix
 * through the REAL Vet402Client + mock vet402 HTTP server, real
 * approvals/ledger stores, stubbed runner (no spawn, no network).
 *
 * Matrix coverage is one test per row; concurrency + shadow rows at
 * the end. Hermetic: nothing reaches vet402.com or @celo/buy.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { logger } from "@agentbadge/passport/logger";
import {
  buyPay,
  type BuyQuote,
  type BuyRunner,
} from "../../src/server/lib/buy/gateway";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../../src/server/lib/agent-wallet/registry";
import { createMemorySpendLedger } from "../../src/server/lib/agent-wallet/ledger";
import { createMemoryApprovalStore } from "../../src/server/lib/agent-wallet/approvals";
import {
  Vet402Client,
  createCounterpartyPolicy,
} from "@agentbadge/circle-payments";
import {
  startMockVet402,
  decisionBody,
  resolveNotInCatalog,
  type MockVet402,
} from "./mock-vet402";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const ASSET = "0x3333333333333333333333333333333333333333";
const NETWORK = "eip155:5042002";
const QUOTE_URL = "https://seller.example/v1/fx/usd-ngn";

const ACCEPT = {
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  amount: "50000",
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
};

/** verified_terms matching the quote's signing offer. */
const matchingTerms = (over: Record<string, unknown> = {}) => ({
  purchase_id: "pid:e2e",
  pay_to: PAY_TO,
  asset: ASSET,
  amount: "50000",
  decimals: 6,
  network: NETWORK,
  scheme: "exact",
  protocol: "x402",
  verified_at: "2026-11-19T00:00:00Z",
  ...over,
});

const quote = (over: Partial<BuyQuote> = {}): BuyQuote => ({
  url: QUOTE_URL,
  method: "POST",
  body: '{"fiat":"NGN"}',
  maxAmount: "0.05",
  maxAmountAtomic: "50000",
  raw: { x402Version: 2, accepts: [ACCEPT] },
  ...over,
});

const okRunner =
  (spawned: { n: number }): BuyRunner =>
  async () => {
    spawned.n += 1;
    return { code: 0, stdout: '{"content":"{}"}', stderr: "" };
  };

function fixture() {
  const registry = createMemoryAgentWalletStore();
  const ledger = createMemorySpendLedger();
  const approvals = createMemoryApprovalStore();
  const rec: AgentWalletRecord = {
    address: WALLET,
    label: "buyer",
    kind: "eoa",
    envelope: {} as never,
    registeredBy: WALLET,
    createdAt: Date.now(),
    active: true,
  };
  return { registry, ledger, approvals, rec };
}

const opts = (
  f: ReturnType<typeof fixture>,
  checker: Vet402Client,
  spawned: { n: number },
  runner: BuyRunner = okRunner(spawned),
  mode: "off" | "shadow" | "enforce" = "enforce",
) => ({
  gate: { registry: f.registry, ledger: f.ledger, approvals: f.approvals },
  runner,
  counterparty: { checker, policy: createCounterpartyPolicy(), mode },
});

describe("257-7 E2E acceptance — buyer contour (mock vet402)", () => {
  let mock: MockVet402;
  let checker: Vet402Client;
  let envBak: string | undefined;

  beforeEach(async () => {
    mock = await startMockVet402();
    checker = new Vet402Client({ baseUrl: mock.url });
    envBak = process.env.BUY_GATEWAY_ENABLED;
    process.env.BUY_GATEWAY_ENABLED = "true";
  });
  afterEach(async () => {
    await mock.close();
    if (envBak === undefined) delete process.env.BUY_GATEWAY_ENABLED;
    else process.env.BUY_GATEWAY_ENABLED = envBak;
  });

  const pay = (f: ReturnType<typeof fixture>, spawned = { n: 0 }) =>
    buyPay(quote(), WALLET, "ref-e2e", opts(f, checker, spawned));

  it("ALLOW + exact offer → pays", async () => {
    mock.onDecision = () => decisionBody({ verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "r1", opts(f, checker, spawned));
    expect(r.status).toBe("paid");
    expect(spawned.n).toBe(1);
    expect(mock.resolveHits).toBe(1);
    expect(mock.decisionHits).toBe(1);
  });

  it("ALLOW + different payTo → deny (terms_mismatch, no spawn)", async () => {
    mock.onDecision = () =>
      decisionBody({
        verified_terms: matchingTerms({
          pay_to: `0x${"9".repeat(40)}`,
        }),
      });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "r1", opts(f, checker, spawned));
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("terms_mismatch");
    expect(spawned.n).toBe(0);
  });

  it.each(["60000", "40000"])(
    "ALLOW + amount %s (up/down) → deny (exact-equality v1)",
    async (amount) => {
      mock.onDecision = () =>
        decisionBody({ verified_terms: matchingTerms({ amount }) });
      const f = fixture();
      await f.registry.put(f.rec);
      const spawned = { n: 0 };
      const r = await buyPay(quote(), WALLET, "r1", opts(f, checker, spawned));
      expect(r.status).toBe("denied");
      expect(r.deny?.error).toBe("terms_mismatch");
      expect(spawned.n).toBe(0);
    },
  );

  it("C-1: cheaper signable accepts[] entry → deny unverifiable_challenge", async () => {
    // 257-13: the old expectation (pay the vetted entry while a cheaper
    // attacker entry stays signable) was the audit's exploit shape.
    const cheap = { ...ACCEPT, amount: "10000", payTo: `0x${"4".repeat(40)}` };
    mock.onDecision = () =>
      decisionBody({ verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const r = await buyPay(
      quote({ raw: { x402Version: 2, accepts: [cheap, ACCEPT] } }),
      WALLET,
      "r1",
      opts(f, checker, spawned),
    );
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("unverifiable_challenge");
    expect(spawned.n).toBe(0);
    expect(mock.decisionHits).toBe(0); // no assessment on hostile shape
  });

  it("identical-terms duplicate accepts[] → pays (uniform signable set)", async () => {
    mock.onDecision = () =>
      decisionBody({ verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const r = await buyPay(
      quote({ raw: { x402Version: 2, accepts: [ACCEPT, { ...ACCEPT }] } }),
      WALLET,
      "r1",
      opts(f, checker, spawned),
    );
    expect(r.status).toBe("paid");
  });

  it("C-2: field-confusion entry (V1 vs V2 amount) → deny unverifiable", async () => {
    const e0 = {
      ...ACCEPT,
      maxAmountRequired: "50000",
      amount: "49999",
      payTo: `0x${"4".repeat(40)}`,
    };
    mock.onDecision = () =>
      decisionBody({ verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const r = await buyPay(
      quote({ raw: { x402Version: 2, accepts: [e0, ACCEPT] } }),
      WALLET,
      "r1",
      opts(f, checker, spawned),
    );
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("unverifiable_challenge");
    expect(spawned.n).toBe(0);
  });

  it("BLOCK → deny counterparty_blocked", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "BLOCK", verified_terms: null });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "r1", opts(f, checker, spawned));
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("counterparty_blocked");
    expect(spawned.n).toBe(0);
  });

  it("WARN → exactly one pending HOLD", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "WARN", verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const r = await pay(f);
    expect(r.status).toBe("approval_required");
    expect(r.deny?.approvalId).toBeTruthy();
    expect(await f.approvals.countPending(WALLET)).toBe(1);
  });

  it("parallel identical HOLDs → 1 approval + singleflight (1 resolve, 1 decision)", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "WARN", verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        buyPay(quote(), WALLET, "ref-par", opts(f, checker, { n: 0 })),
      ),
    );
    expect(results.every((r) => r.status === "approval_required")).toBe(true);
    expect(await f.approvals.countPending(WALLET)).toBe(1);
    // singleflight: concurrent same-URL checks joined ONE outbound chain
    expect(mock.resolveHits).toBe(1);
    expect(mock.decisionHits).toBe(1);
    // every caller got the SAME parked approval id
    const ids = new Set(results.map((r) => r.deny?.approvalId));
    expect(ids.size).toBe(1);
  });

  it("repeat consume → reject; second pay attempt re-holds", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "WARN", verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const r1 = await pay(f);
    const id = r1.deny?.approvalId as string;
    expect(await f.approvals.decide(id, "approve", "owner")).toBe(true);
    const r2 = await pay(f);
    expect(r2.status).toBe("paid"); // permit consumed, deal allowed
    // the consumed permit can never be consumed again
    expect(await f.approvals.consume(id)).toBe(false);
    // a THIRD payment re-gates: WARN → a NEW pending hold
    const r3 = await pay(f);
    expect(r3.status).toBe("approval_required");
  });

  it("approve → consume → offer changed → consume fails, no pay", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "WARN", verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const r1 = await pay(f);
    const id = r1.deny?.approvalId as string;
    await f.approvals.decide(id, "approve", "owner");
    // owner approved deal A; the deal CHANGED (different resource URL →
    // different fingerprint) — the permit must not transfer.
    const spawned = { n: 0 };
    const r2 = await buyPay(
      quote({ url: "https://seller.example/v1/fx/usd-kes" }),
      WALLET,
      "r2",
      opts(f, checker, spawned),
    );
    expect(r2.status).toBe("approval_required");
    expect(spawned.n).toBe(0);
    // the permit is still approved — bound to the OLD fingerprint;
    // a consume carrying any other fingerprint refuses without consuming
    expect(await f.approvals.consume(id, "sha256:v1:other-deal")).toBe(false);
    const rec = (await f.approvals.listByWallet(WALLET, "approved"))[0];
    expect(rec.state).toBe("approved");
  });

  it.each([
    ["429", { status: 429 }],
    ["500", { status: 500 }],
    ["timeout", { delayMs: 300 }],
  ])("vet402 %s → unavailable, retryable, no spawn", async (_label, reply) => {
    mock.onResolve = () => reply;
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    const slowChecker =
      _label === "timeout"
        ? new Vet402Client({
            baseUrl: mock.url,
            totalTimeoutMs: 120,
            connectTimeoutMs: 60,
          })
        : checker;
    const r = await buyPay(
      quote(),
      WALLET,
      "r1",
      opts(f, slowChecker, spawned),
    );
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("counterparty_unavailable");
    expect(r.deny?.retryable).toBe(true);
    expect(spawned.n).toBe(0);
  });

  it("repeat URL within TTL → cache hit, zero new outbound", async () => {
    mock.onDecision = () => decisionBody({ verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const spawned = { n: 0 };
    await buyPay(quote(), WALLET, "r1", opts(f, checker, spawned));
    const hits = mock.totalHits;
    await buyPay(quote(), WALLET, "r2", opts(f, checker, spawned));
    expect(mock.totalHits).toBe(hits); // decision + resolve both cached
    expect(spawned.n).toBe(2);
  });

  it("URL carrying a secret query → 0 outbound, privacy HOLD", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const r = await buyPay(
      quote({ url: `${QUOTE_URL}?api_key=deadbeef` }),
      WALLET,
      "r1",
      opts(f, checker, { n: 0 }),
    );
    expect(mock.totalHits).toBe(0); // sanitize refused — nothing sent
    expect(r.status).toBe("approval_required");
  });

  it("token in hostname label → 0 outbound, privacy HOLD (H-4)", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const r = await buyPay(
      quote({
        url: "https://k3j9x2m8q1x7z5c4v6b0n2l9p8o7i6u5r4.pages.dev/api",
      }),
      WALLET,
      "r1h",
      opts(f, checker, { n: 0 }),
    );
    expect(mock.totalHits).toBe(0); // hostname secret — nothing sent
    expect(r.status).toBe("approval_required");
  });

  it("not_in_catalog → HOLD (unknown seller, parked for owner)", async () => {
    mock.onResolve = (q) => resolveNotInCatalog(q);
    const f = fixture();
    await f.registry.put(f.rec);
    const r = await pay(f);
    expect(r.status).toBe("approval_required");
  });

  it("race: 2 payments, one fingerprint → exactly one consume/pay", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "WARN", verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const hold = await pay(f);
    await f.approvals.decide(hold.deny?.approvalId as string, "approve", "owner");
    const spawned = { n: 0 };
    const [a, b] = await Promise.all([
      buyPay(quote(), WALLET, "ref-race", opts(f, checker, spawned)),
      buyPay(quote(), WALLET, "ref-race", opts(f, checker, spawned)),
    ]);
    const statuses = [a.status, b.status].sort();
    // 257-14 park-commit: both lookups see the live permit and skip
    // the gate; commit-time consume is atomic — the loser denies
    // honestly instead of re-holding or double-paying.
    expect(statuses).toEqual(["denied", "paid"]);
    const loser = a.status === "denied" ? a : b;
    expect(loser.deny?.error).toBe("approval_permit_lost");
    expect(spawned.n).toBe(1); // only the consume winner signed
  });

  it("shadow → enforce: shadow logs the same decision but pays", async () => {
    const info = logger.info;
    const seen: unknown[] = [];
    logger.info = (m: string, ctx: unknown) => {
      if (m === "counterparty check") seen.push(ctx);
      return info.call(logger, m, ctx as never);
    };
    try {
      mock.onDecision = () =>
        decisionBody({ recommendation: "BLOCK", verified_terms: null });
      const f = fixture();
      await f.registry.put(f.rec);
      const spawned = { n: 0 };
      const shadow = await buyPay(
        quote(),
        WALLET,
        "r1",
        opts(f, checker, spawned, okRunner(spawned), "shadow"),
      );
      expect(shadow.status).toBe("paid"); // shadow observes, doesn't act
      const enforce = await buyPay(
        quote(),
        WALLET,
        "r2",
        opts(f, checker, spawned, okRunner(spawned), "enforce"),
      );
      expect(enforce.status).toBe("denied");
      expect(enforce.deny?.error).toBe("counterparty_blocked");
      // the shadow record carries the SAME decision enforce applied
      const decisions = seen
        .map((c) => (c as { decision?: { action?: string } })?.decision?.action)
        .filter(Boolean);
      expect(decisions).toContain("deny");
    } finally {
      logger.info = info;
    }
  });

  it("consume → runner dies (CLI response lost) → uncertain, no re-pay", async () => {
    mock.onDecision = () =>
      decisionBody({ recommendation: "WARN", verified_terms: matchingTerms() });
    const f = fixture();
    await f.registry.put(f.rec);
    const hold = await pay(f);
    await f.approvals.decide(hold.deny?.approvalId as string, "approve", "owner");
    const spawned = { n: 0 };
    const dyingRunner: BuyRunner = async () => {
      spawned.n += 1;
      throw new Error("process exited — response lost");
    };
    const r = await buyPay(
      quote(),
      WALLET,
      "ref-lost",
      opts(f, checker, spawned, dyingRunner),
    );
    expect(r.status).toBe("uncertain"); // C1: money may have moved
    expect(spawned.n).toBe(1); // exactly one attempt — never retried
  });
});
