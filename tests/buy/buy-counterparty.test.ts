/**
 * SLICE-257-5: buyer integration — counterparty gate-step in buyPay.
 * ACs: allow+match pays; mismatch denies pre-spawn; WARN parks a
 * fingerprint-bound approval (consume re-verifies the SAME quote);
 * BLOCK/unavailable deny without touching money ops; shadow logs but
 * pays; offer selection picks THE signing accepts entry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buyPay,
  type BuyQuote,
  type BuyRunner,
} from "../../src/server/lib/buy/gateway";
import {
  bindDeal,
  selectSigningOffer,
} from "../../src/server/lib/buy/counterparty-gate";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../../src/server/lib/agent-wallet/registry";
import { createMemorySpendLedger } from "../../src/server/lib/agent-wallet/ledger";
import { createMemoryApprovalStore } from "../../src/server/lib/agent-wallet/approvals";
import {
  createCounterpartyPolicy,
  type CounterpartyChecker,
  type Vet402Assessment,
  type Vet402VerdictAssessment,
} from "@agentbadge/circle-payments";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const ASSET = "0x3333333333333333333333333333333333333333";
const NETWORK = "eip155:5042002";

const ACCEPT = {
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  amount: "50000",
  payTo: PAY_TO,
  maxTimeoutSeconds: 60,
};

const quote = (over: Partial<BuyQuote> = {}): BuyQuote => ({
  url: "https://gateway.usebuy.ai/v1/fx/usd-ngn",
  method: "POST",
  body: '{"fiat":"NGN"}',
  maxAmount: "0.05",
  maxAmountAtomic: "50000",
  raw: { x402Version: 2, accepts: [ACCEPT] },
  ...over,
});

const verdictA = (
  verdict: "ALLOW" | "WARN" | "BLOCK",
  verifiedTerms: Vet402VerdictAssessment["verifiedTerms"] = {
    payTo: PAY_TO,
    asset: ASSET,
    amount: "50000",
    network: NETWORK,
    scheme: "exact",
  },
): Vet402VerdictAssessment => ({
  kind: "verdict",
  verdict,
  reasonCodes: [],
  verifiedTerms,
  checkedAt: "2026-11-20T00:00:00.000Z",
  cacheHit: false,
});

const stubChecker = (
  a: Vet402Assessment,
): CounterpartyChecker & { calls: number } => {
  const c = {
    calls: 0,
    check: async () => {
      c.calls += 1;
      return a;
    },
  };
  return c;
};

const okRunner = (spawned: { n: number }): BuyRunner => async () => {
  spawned.n += 1;
  return {
    code: 0,
    stdout: JSON.stringify({
      content: '{"rate":1540.12}',
      settle_tx:
        "0x" + "ab".repeat(32),
    }),
    stderr: "",
  };
};

function fixture(envelope: Record<string, unknown> = {}) {
  const registry = createMemoryAgentWalletStore();
  const ledger = createMemorySpendLedger();
  const approvals = createMemoryApprovalStore();
  const rec: AgentWalletRecord = {
    address: WALLET,
    label: "buyer",
    kind: "eoa",
    envelope: envelope as never,
    registeredBy: WALLET,
    createdAt: Date.now(),
    active: true,
  };
  return { registry, ledger, approvals, rec };
}

function payOpts(
  deps: ReturnType<typeof fixture>,
  checker: CounterpartyChecker,
  spawned: { n: number },
  mode: "off" | "shadow" | "enforce" = "enforce",
) {
  return {
    gate: {
      registry: deps.registry,
      ledger: deps.ledger,
      approvals: deps.approvals,
    },
    runner: okRunner(spawned),
    counterparty: {
      checker,
      policy: createCounterpartyPolicy(),
      mode,
    },
  };
}

describe("selectSigningOffer (D-257-Q8)", () => {
  it("picks the accepts entry matching maxAmountAtomic", () => {
    const cheap = { ...ACCEPT, amount: "10000", payTo: `0x${"4".repeat(40)}` };
    const sel = selectSigningOffer(
      { x402Version: 2, accepts: [cheap, ACCEPT] },
      "50000",
    );
    expect(sel.ok && sel.offer.payTo === PAY_TO).toBe(true);
  });
  it("no amount match → no_matching_offer; dupes → ambiguous", () => {
    expect(
      selectSigningOffer({ accepts: [{ ...ACCEPT, amount: "1" }] }, "50000"),
    ).toEqual({ ok: false, error: "no_matching_offer" });
    const dupe = { ...ACCEPT, payTo: `0x${"4".repeat(40)}` };
    expect(
      selectSigningOffer({ accepts: [ACCEPT, dupe] }, "50000"),
    ).toEqual({ ok: false, error: "ambiguous_offers" });
  });
});

describe("buyPay counterparty gate (enforce)", () => {
  let env: string | undefined;
  beforeEach(() => {
    env = process.env.BUY_GATEWAY_ENABLED;
    process.env.BUY_GATEWAY_ENABLED = "true";
  });
  afterEach(() => {
    if (env === undefined) delete process.env.BUY_GATEWAY_ENABLED;
    else process.env.BUY_GATEWAY_ENABLED = env;
  });

  it("AC1: ALLOW + matching terms → pays, checker called once", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("ALLOW"));
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "ref-1", payOpts(f, checker, spawned));
    expect(r.status).toBe("paid");
    expect(checker.calls).toBe(1);
    expect(spawned.n).toBe(1);
  });

  it("AC1: ALLOW + terms mismatch → denied terms_mismatch, never spawns", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(
      verdictA("ALLOW", {
        payTo: PAY_TO,
        asset: ASSET,
        amount: "999999",
        network: NETWORK,
        scheme: "exact",
      }),
    );
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "ref-1", payOpts(f, checker, spawned));
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("terms_mismatch");
    expect(spawned.n).toBe(0);
    const denied = await f.ledger.listByWallet(WALLET);
    expect(denied.some((e) => e.state === "denied" && e.denialReason === "terms_mismatch")).toBe(true);
  });

  it("AC3: BLOCK → denied counterparty_blocked without money ops", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("BLOCK"));
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "ref-1", payOpts(f, checker, spawned));
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("counterparty_blocked");
    expect(spawned.n).toBe(0);
  });

  it("AC3: unavailable → denied counterparty_unavailable, retryable", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker({
      kind: "unavailable",
      failure: "timeout",
      checkedAt: "2026-11-20T00:00:00.000Z",
      cacheHit: false,
    });
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "ref-1", payOpts(f, checker, spawned));
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("counterparty_unavailable");
    expect(r.deny?.retryable).toBe(true);
    expect(spawned.n).toBe(0);
    expect(r.status).not.toBe("uncertain"); // AC6: never uncertain
  });

  it("AC2: WARN → fingerprint-bound approval; approve → pay; changed offer fails consume", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("WARN"));
    const spawned = { n: 0 };
    const opts = payOpts(f, checker, spawned);

    const r1 = await buyPay(quote(), WALLET, "ref-1", opts);
    expect(r1.status).toBe("approval_required");
    expect(spawned.n).toBe(0);

    const pending = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending).toHaveLength(1);
    const deal = bindDeal(quote(), WALLET.toLowerCase());
    expect(deal.fingerprint).toMatch(/^sha256:v1:/);
    expect(pending[0].dealFingerprint).toBe(deal.fingerprint);
    expect(pending[0].approvalReason).toBe("counterparty_warn");
    expect(pending[0].meta?.checkedAt).toBe("2026-11-20T00:00:00.000Z");

    // Owner approves → same quote re-pays: consume(fp) re-verifies the
    // identical deal → permit consumed → gate skipped → paid.
    expect(await f.approvals.decide(pending[0].id, "approve", "owner")).toBe(true);
    const r2 = await buyPay(quote(), WALLET, "ref-1", opts);
    expect(r2.status).toBe("paid");
    expect(spawned.n).toBe(1);
    expect(checker.calls).toBe(1); // permit path never re-checks

    // A CHANGED deal (different URL → different fp) → the consumed
    // permit can't cover it: fresh check → WARN again → new pending
    // on the new fp. (A changed OFFER vs the same verifiedTerms would
    // instead deny terms_mismatch — covered above.)
    const r3 = await buyPay(
      quote({ url: "https://gateway.usebuy.ai/v1/fx/usd-eur" }),
      WALLET,
      "ref-1",
      opts,
    );
    expect(r3.status).toBe("approval_required");
    expect(spawned.n).toBe(1);
    expect(checker.calls).toBe(2);
    const pending2 = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending2).toHaveLength(1);
    expect(pending2[0].dealFingerprint).not.toBe(deal.fingerprint);
  });

  it("unselectable offer → terms_uncomparable hold, no fingerprint", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("ALLOW"));
    const spawned = { n: 0 };
    const r = await buyPay(
      quote({ raw: { x402Version: 2, accepts: [] } }),
      WALLET,
      "ref-1",
      payOpts(f, checker, spawned),
    );
    expect(r.status).toBe("approval_required");
    const pending = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending[0].dealFingerprint).toBeUndefined();
    expect(pending[0].approvalReason).toBe("counterparty_unmeasured");
    expect(spawned.n).toBe(0);
  });
});

describe("buyPay counterparty gate (modes)", () => {
  let env: string | undefined;
  beforeEach(() => {
    env = process.env.BUY_GATEWAY_ENABLED;
    process.env.BUY_GATEWAY_ENABLED = "true";
  });
  afterEach(() => {
    if (env === undefined) delete process.env.BUY_GATEWAY_ENABLED;
    else process.env.BUY_GATEWAY_ENABLED = env;
  });

  it("AC4: shadow — deny decision is recorded but the payment proceeds", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("BLOCK"));
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "ref-1", payOpts(f, checker, spawned, "shadow"));
    expect(r.status).toBe("paid");
    expect(checker.calls).toBe(1);
    expect(spawned.n).toBe(1);
  });

  it("off — checker never invoked", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("BLOCK"));
    const spawned = { n: 0 };
    const r = await buyPay(quote(), WALLET, "ref-1", payOpts(f, checker, spawned, "off"));
    expect(r.status).toBe("paid");
    expect(checker.calls).toBe(0);
  });
});
