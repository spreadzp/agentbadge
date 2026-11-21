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

describe("selectSigningOffer (D-257-Q8 → 257-13 whole-challenge)", () => {
  it("single offer → vetted", () => {
    const sel = selectSigningOffer({ accepts: [ACCEPT] }, "50000");
    expect(sel.ok && sel.offer.payTo === PAY_TO).toBe(true);
  });
  it("identical-terms duplicates → vetted (same deal, not ambiguous)", () => {
    const sel = selectSigningOffer({ accepts: [ACCEPT, { ...ACCEPT }] }, "50000");
    expect(sel.ok && sel.offer.payTo === PAY_TO).toBe(true);
  });
  it("C-1: cheaper signable entry with different terms → unverifiable_challenge", () => {
    const cheap = { ...ACCEPT, amount: "10000", payTo: `0x${"4".repeat(40)}` };
    expect(
      selectSigningOffer({ accepts: [cheap, ACCEPT] }, "50000"),
    ).toEqual({ ok: false, error: "unverifiable_challenge" });
  });
  it("C-2: field-confusion entry (maxAmountRequired≠amount) is still signable → unverifiable", () => {
    // E0 carries V1 1000000 but V2-normalizes to 999 attacker terms.
    const e0 = {
      scheme: "exact", network: NETWORK, asset: ASSET,
      maxAmountRequired: "50000", amount: "49999",
      payTo: `0x${"4".repeat(40)}`,
    };
    expect(
      selectSigningOffer({ accepts: [e0, ACCEPT] }, "50000"),
    ).toEqual({ ok: false, error: "unverifiable_challenge" });
  });
  it("no at-cap entry → no_matching_offer; distinct at-cap terms → ambiguous", () => {
    expect(
      selectSigningOffer({ accepts: [{ ...ACCEPT, amount: "1" }] }, "50000"),
    ).toEqual({ ok: false, error: "no_matching_offer" });
    const dupe = { ...ACCEPT, payTo: `0x${"4".repeat(40)}` };
    expect(
      selectSigningOffer({ accepts: [ACCEPT, dupe] }, "50000"),
    ).toEqual({ ok: false, error: "ambiguous_offers" });
  });
  it("unparseable under-ceiling entry → unverifiable_challenge; above ceiling → ignored", () => {
    const tron = (amount: string) => ({
      scheme: "exact", network: "tron:x", payTo: "T", asset: "T", amount,
    });
    expect(
      selectSigningOffer({ accepts: [ACCEPT, tron("49999")] }, "50000"),
    ).toEqual({ ok: false, error: "unverifiable_challenge" });
    const sel = selectSigningOffer({ accepts: [ACCEPT, tron("99999")] }, "50000");
    expect(sel.ok && sel.offer.payTo === PAY_TO).toBe(true);
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

    // Owner approves → same quote re-pays: the fp-permit skips the
    // HOLD but not the check — consume-time BLOCK re-verification
    // costs exactly one assessment (257-14 H-3).
    expect(await f.approvals.decide(pending[0].id, "approve", "owner")).toBe(true);
    const r2 = await buyPay(quote(), WALLET, "ref-1", opts);
    expect(r2.status).toBe("paid");
    expect(spawned.n).toBe(1);
    expect(checker.calls).toBe(2); // hold + permit BLOCK re-check

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
    expect(checker.calls).toBe(3);
    const pending2 = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending2).toHaveLength(1);
    expect(pending2[0].dealFingerprint).not.toBe(deal.fingerprint);
  });

  it("unselectable offer → fp-less hold is unapprovable → deny (H-2)", async () => {
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
    // 257-14 (H-2): a hold without a dealFingerprint can never be
    // consumed — parking it was an approval placebo + queue bloat.
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("counterparty_unapprovable");
    const pending = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending).toHaveLength(0); // no placebo in the queue
    expect(spawned.n).toBe(0);
  });

  it("C-1: unverifiable challenge → deny, zero vet402 calls, zero spawn", async () => {
    const cheap = { ...ACCEPT, amount: "10000", payTo: `0x${"4".repeat(40)}` };
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("ALLOW"));
    const spawned = { n: 0 };
    const r = await buyPay(
      quote({ raw: { x402Version: 2, accepts: [cheap, ACCEPT] } }),
      WALLET,
      "ref-uv",
      payOpts(f, checker, spawned),
    );
    expect(r.status).toBe("denied");
    expect(r.deny?.error).toBe("unverifiable_challenge");
    expect(checker.calls).toBe(0); // hostile shape — no assessment spent
    expect(spawned.n).toBe(0);
    // deny is durable in the spend ledger
    const denied = await f.ledger.listByWallet(WALLET);
    expect(denied.some((e) => e.denialReason === "unverifiable_challenge")).toBe(
      true,
    );
  });

  it("H-1: WARN + amountAbove → two approves → paid (no livelock burn)", async () => {
    const f = fixture({ approvalAboveUsd: 0.01 });
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("WARN"));
    const spawned = { n: 0 };
    const opts = payOpts(f, checker, spawned);
    const q = quote();

    // call 1: cp-gate FIRST (N-11) → WARN → cp-hold; the amount-hold
    // is never reached, so no wasted amount approval.
    const r1 = await buyPay(q, WALLET, "ref-ll", opts);
    expect(r1.status).toBe("approval_required");
    let pending = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].approvalReason).toBe("counterparty_warn");
    expect(pending[0].dealFingerprint).toMatch(/^sha256:v1:/);
    await f.approvals.decide(pending[0].id, "approve", "owner");

    // call 2: live fp-permit short-circuits the hold (one BLOCK
    // re-check) → the amount-hold parks — the cp permit was NOT
    // consumed, it stays live for the commit.
    const r2 = await buyPay(q, WALLET, "ref-ll", opts);
    expect(r2.status).toBe("approval_required");
    pending = await f.approvals.listByWallet(WALLET, "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].approvalReason).toBe("amount_threshold");
    await f.approvals.decide(pending[0].id, "approve", "owner");

    // call 3: both permits live → commit consumes both → paid.
    // The old consume-up-front order alternately burned permits
    // forever — this deal could never settle.
    const r3 = await buyPay(q, WALLET, "ref-ll", opts);
    expect(r3.status).toBe("paid");
    expect(spawned.n).toBe(1);
    const approved = await f.approvals.listByWallet(WALLET, "approved");
    expect(approved).toHaveLength(0); // both consumed
  });

  it("H-3: expired approved permit → consume refuses → re-hold, never silent pay", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("WARN"));
    const spawned = { n: 0 };
    const opts = payOpts(f, checker, spawned);

    const r1 = await buyPay(quote(), WALLET, "ref-exp", opts);
    expect(r1.status).toBe("approval_required");
    const pending = await f.approvals.listByWallet(WALLET, "pending");
    // Approve with an ALREADY-EXPIRED window — the permit is dead
    // on arrival (the 30-min default lives in decide(); an explicit
    // expiry overrides).
    await f.approvals.decide(
      pending[0].id,
      "approve",
      "owner",
      Date.now() - 1,
    );
    const r2 = await buyPay(quote(), WALLET, "ref-exp", opts);
    expect(r2.status).toBe("approval_required"); // re-hold, not paid
    expect(spawned.n).toBe(0);
    // a fresh pending for the same deal parked (fp find-or-create)
    const repending = await f.approvals.listByWallet(WALLET, "pending");
    expect(repending).toHaveLength(1);
    expect(repending[0].id).not.toBe(pending[0].id);
  });

  it("H-3: live permit + seller flipped BLOCK → deny (consume re-check)", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("WARN"));
    const spawned = { n: 0 };
    const r1 = await buyPay(
      quote(),
      WALLET,
      "ref-flip",
      payOpts(f, checker, spawned),
    );
    expect(r1.status).toBe("approval_required");
    const pending = await f.approvals.listByWallet(WALLET, "pending");
    await f.approvals.decide(pending[0].id, "approve", "owner");

    // seller flipped after the owner approved — the permit skips the
    // hold, never the check.
    checker.check = async () => verdictA("BLOCK");
    const r2 = await buyPay(
      quote(),
      WALLET,
      "ref-flip",
      payOpts(f, checker, spawned),
    );
    expect(r2.status).toBe("denied");
    expect(r2.deny?.error).toBe("counterparty_blocked");
    expect(spawned.n).toBe(0);
    // the permit was NOT consumed by the deny path
    const rec = await f.approvals.get(pending[0].id);
    expect(rec?.state).toBe("approved");
  });

  it("H-3: vet402 down at consume → permit still pays (logged)", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("WARN"));
    const spawned = { n: 0 };
    const opts = payOpts(f, checker, spawned);
    const r1 = await buyPay(quote(), WALLET, "ref-down", opts);
    expect(r1.status).toBe("approval_required");
    const pending = await f.approvals.listByWallet(WALLET, "pending");
    await f.approvals.decide(pending[0].id, "approve", "owner");

    checker.check = async () => ({
      kind: "unavailable",
      failure: "network_error",
      checkedAt: new Date().toISOString(),
      cacheHit: false,
    });
    const r2 = await buyPay(quote(), WALLET, "ref-down", opts);
    expect(r2.status).toBe("paid");
    expect(spawned.n).toBe(1);
  });

  it("N-7: shadow never consumes the permit (stays approved)", async () => {
    const f = fixture();
    await f.registry.put(f.rec);
    const checker = stubChecker(verdictA("WARN"));
    const spawned = { n: 0 };

    // Seed an approved fp-permit directly.
    const deal = bindDeal(quote(), WALLET.toLowerCase());
    const parked = await f.approvals.park({
      wallet: WALLET.toLowerCase() as `0x${string}`,
      amountUsd: 0.05,
      kind: "buy-gateway",
      refId: "ref-seed",
      expiresAt: Date.now() + 60_000,
      approvalReason: "counterparty_warn",
      dealFingerprint: deal.fingerprint,
      meta: { checkedAt: "2026-11-20T00:00:00.000Z" },
    });
    await f.approvals.decide(parked.id, "approve", "owner");

    const r = await buyPay(
      quote(),
      WALLET,
      "ref-seed",
      payOpts(f, checker, spawned, "shadow"),
    );
    expect(r.status).toBe("paid");
    const rec = await f.approvals.get(parked.id);
    expect(rec?.state).toBe("approved"); // untouched by shadow
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
