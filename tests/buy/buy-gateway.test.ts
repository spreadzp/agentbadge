/**
 * SLICE-191-10: buy gateway — quote-first flow, spend envelope before
 * spawn, refusal-only retry discipline, kill-switch.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  atomicToUnits,
  buyPay,
  buyQuote,
  classifyBuyFailure,
  type BuyQuote,
  type BuyRunner,
} from "../../src/server/lib/buy/gateway";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
  type AgentWalletStore,
  type SpendCaps,
} from "../../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendLedger,
  type SpendLedger,
} from "../../src/server/lib/agent-wallet/ledger";
import {
  createMemoryApprovalStore,
  type ApprovalStore,
} from "../../src/server/lib/agent-wallet/approvals";

const WALLET = "0x1111111111111111111111111111111111111111";

const rec = (envelope: SpendCaps = {}): AgentWalletRecord => ({
  address: WALLET,
  label: "buyer",
  kind: "eoa",
  envelope,
  registeredBy: WALLET,
  createdAt: Date.now(),
  active: true,
});

const quote = (over: Partial<BuyQuote> = {}): BuyQuote => ({
  url: "https://gateway.usebuy.ai/v1/fx/usd-ngn",
  method: "POST",
  body: '{"fiat":"NGN"}',
  maxAmount: "0.05",
  maxAmountAtomic: "50000",
  raw: {},
  ...over,
});

function gate(over: {
  store?: AgentWalletStore;
  ledger?: SpendLedger;
  approvals?: ApprovalStore;
} = {}) {
  const store = over.store ?? createMemoryAgentWalletStore();
  const ledger = over.ledger ?? createMemorySpendLedger();
  const approvals = over.approvals ?? createMemoryApprovalStore();
  return { store, ledger, approvals, deps: { registry: store, ledger, approvals } };
}

async function registerWallet(
  store: AgentWalletStore,
  envelope: SpendCaps = {},
) {
  await store.put(rec(envelope));
}

describe("atomicToUnits (402 challenge → envelope USD)", () => {
  it("6-decimal atomic → human units", () => {
    // real challenge: e2-micro VM = 16753 atomic = $0.016753
    expect(atomicToUnits("16753")).toBe("0.016753");
    expect(atomicToUnits("50000")).toBe("0.05");
    expect(atomicToUnits("1000000")).toBe("1");
    expect(atomicToUnits("0")).toBe("0");
  });
});

describe("classifyBuyFailure (buy-skill retry table)", () => {
  it("settle_uncertain / provision_failed / retryable:false → uncertain", () => {
    for (const stderr of [
      "500 settle_uncertain",
      "500 provision_failed",
      '{"retryable": false}',
    ]) {
      expect(
        classifyBuyFailure({ code: 1, stdout: "", stderr }),
      ).toBe("uncertain");
    }
  });

  it("structural 402 challenge + no payment trace → refused", () => {
    for (const stderr of [
      'PAYMENT-REQUIRED: {"x402Version":1,"accepts":[{}]}',
      'error: {"x402Version":2,"accepts":[{"amount":"50000"}]}',
    ]) {
      expect(
        classifyBuyFailure({ code: 1, stdout: "", stderr }),
      ).toBe("refused");
    }
  });

  it("post-signature text / tx trace → uncertain (H-6: never re-pay)", () => {
    const tx = "0x" + "ab".repeat(32);
    for (const stderr of [
      // bare seller 4xx/503 after spawn — signature may have left
      "503 service unavailable",
      "400 invalid_request",
      "404 not found",
      "402 verify_payment_failed",
      '{"error":{"code":"no_matching_requirements"}}',
      "insufficient_funds: USDC balance too low",
      // payment trace overrides any refusal-looking text
      `503 settle failed, tx ${tx}`,
      `PAYMENT-REQUIRED after send, tx ${tx}`,
      "PAYMENT-SIGNATURE echoed then 400",
    ]) {
      expect(
        classifyBuyFailure({ code: 1, stdout: "", stderr }),
      ).toBe("uncertain");
    }
  });
});

describe("buyPay — envelope gate", () => {
  let env: string | undefined;
  let sandboxEnv: string | undefined;
  beforeEach(() => {
    env = process.env.BUY_GATEWAY_ENABLED;
    process.env.BUY_GATEWAY_ENABLED = "true";
    sandboxEnv = process.env.BUY_SANDBOX;
  });
  afterEach(() => {
    if (env === undefined) delete process.env.BUY_GATEWAY_ENABLED;
    else process.env.BUY_GATEWAY_ENABLED = env;
    if (sandboxEnv === undefined) delete process.env.BUY_SANDBOX;
    else process.env.BUY_SANDBOX = sandboxEnv;
  });

  it("kill-switch: disabled → no spawn, no ledger write", async () => {
    process.env.BUY_GATEWAY_ENABLED = "false";
    const { deps, ledger } = gate();
    await registerWallet(deps.registry);
    let spawned = 0;
    const res = await buyPay(quote(), WALLET, "r1", {
      gate: deps,
      runner: async () => {
        spawned++;
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    expect(res.status).toBe("disabled");
    expect(spawned).toBe(0);
    expect(await ledger.listByWallet(WALLET)).toHaveLength(0);
  });

  it("happy path: quote → pay → settled + txHash", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry, { perTxUsd: 1 });
    const runner: BuyRunner = async () => ({
      code: 0,
      stdout: 'paid 0.05 USDC tx 0x' + "ab".repeat(32),
      stderr: "",
    });
    const res = await buyPay(quote(), WALLET, "r2", {
      gate: deps,
      runner,
    });
    expect(res.status).toBe("paid");
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const entries = await ledger.listByWallet(WALLET);
    expect(entries[0]?.state).toBe("settled");
  });

  it("BUY_SANDBOX=true → `-s` global flag BEFORE curl subcommand", async () => {
    process.env.BUY_SANDBOX = "true";
    const { deps } = gate();
    await registerWallet(deps.registry, { perTxUsd: 1 });
    let captured: string[] = [];
    await buyPay(quote(), WALLET, "rsb", {
      gate: deps,
      runner: async (args) => {
        captured = args;
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    const sIdx = captured.indexOf("-s");
    const cIdx = captured.indexOf("curl");
    expect(sIdx).toBeGreaterThanOrEqual(0);
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(sIdx).toBeLessThan(cIdx);
    // default off
    process.env.BUY_SANDBOX = "false";
    captured = [];
    await buyPay(quote(), WALLET, "rsb2", {
      gate: deps,
      runner: async (args) => {
        captured = args;
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    expect(captured).not.toContain("-s");
  });

  it("perTx cap exceeded → denied, never spawns", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry, { perTxUsd: 0.01 });
    let spawned = 0;
    const res = await buyPay(quote({ maxAmount: "0.05" }), WALLET, "r3", {
      gate: deps,
      runner: async () => {
        spawned++;
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    expect(res.status).toBe("denied");
    expect(spawned).toBe(0);
    expect((await ledger.listByWallet(WALLET))[0]?.state).toBe("denied");
  });

  it("kind not in allowedKinds → denied", async () => {
    const { deps } = gate();
    await registerWallet(deps.registry, { allowedKinds: ["x402"] });
    const res = await buyPay(quote(), WALLET, "r4", {
      gate: deps,
      runner: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    expect(res.status).toBe("denied");
  });

  it("above approvalAboveUsd → approval_required, parked intent", async () => {
    const { deps, approvals } = gate();
    await registerWallet(deps.registry, { approvalAboveUsd: 0.01 });
    let spawned = 0;
    const res = await buyPay(quote({ maxAmount: "0.05" }), WALLET, "r5", {
      gate: deps,
      runner: async () => {
        spawned++;
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    expect(res.status).toBe("approval_required");
    expect(spawned).toBe(0);
    const pending = await approvals.listByWallet(WALLET, "pending");
    expect(pending).toHaveLength(1);
  });

  it("suspended wallet → denied", async () => {
    const { deps } = gate();
    await registerWallet(deps.registry);
    await deps.registry.setSuspended(WALLET, true);
    const res = await buyPay(quote(), WALLET, "r6", {
      gate: deps,
      runner: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    expect(res.status).toBe("denied");
  });
});

describe("buyPay — retry discipline", () => {
  let env: string | undefined;
  beforeEach(() => {
    env = process.env.BUY_GATEWAY_ENABLED;
    process.env.BUY_GATEWAY_ENABLED = "true";
  });
  afterEach(() => {
    if (env === undefined) delete process.env.BUY_GATEWAY_ENABLED;
    else process.env.BUY_GATEWAY_ENABLED = env;
  });

  it("refused (structural 402) → retries once then released", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry);
    let calls = 0;
    const res = await buyPay(quote(), WALLET, "r7", {
      gate: deps,
      maxRetries: 1,
      runner: async () => {
        calls++;
        return {
          code: 1,
          stdout: "",
          stderr: 'PAYMENT-REQUIRED {"x402Version":1,"accepts":[{}]}',
        };
      },
    });
    expect(res.status).toBe("refused");
    expect(calls).toBe(2); // initial + 1 retry
    expect((await ledger.listByWallet(WALLET))[0]?.state).toBe("released");
  });

  it("post-settlement 503 → NO retry, entry failed (H-6)", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry);
    let calls = 0;
    const res = await buyPay(quote(), WALLET, "r7b", {
      gate: deps,
      maxRetries: 1,
      runner: async () => {
        calls++;
        return { code: 1, stdout: "", stderr: "503 unavailable" };
      },
    });
    expect(res.status).toBe("uncertain");
    expect(calls).toBe(1); // post-signature text — never re-paid
    expect((await ledger.listByWallet(WALLET))[0]?.state).toBe("failed");
  });

  it("tx hash + non-zero exit → uncertain, never re-paid", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry);
    let calls = 0;
    const tx = "0x" + "cd".repeat(32);
    const res = await buyPay(quote(), WALLET, "r7c", {
      gate: deps,
      runner: async () => {
        calls++;
        return { code: 1, stdout: `paid ${tx}`, stderr: "404" };
      },
    });
    expect(res.status).toBe("uncertain");
    expect(calls).toBe(1);
    expect((await ledger.listByWallet(WALLET))[0]?.state).toBe("failed");
  });

  it("transition throw after paid → typed uncertain, not exception (M-10)", async () => {
    const ledger = createMemorySpendLedger();
    const real = ledger.transition.bind(ledger);
    ledger.transition = (id, to, txHash, sourceChain) =>
      to === "settled"
        ? Promise.reject(new Error("db down"))
        : real(id, to, txHash, sourceChain);
    const { deps } = gate({ ledger });
    await registerWallet(deps.registry);
    const tx = "0x" + "ef".repeat(32);
    const res = await buyPay(quote(), WALLET, "r9", {
      gate: deps,
      runner: async () => ({ code: 0, stdout: `ok ${tx}`, stderr: "" }),
    });
    expect(res.status).toBe("uncertain");
    expect(res.txHash).toBe(tx);
    expect(res.output).toContain("ledger transition failed");
  });

  it("settle_uncertain → NO retry, entry failed", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry);
    let calls = 0;
    const res = await buyPay(quote(), WALLET, "r8", {
      gate: deps,
      runner: async () => {
        calls++;
        return { code: 1, stdout: "", stderr: "500 settle_uncertain" };
      },
    });
    expect(res.status).toBe("uncertain");
    expect(calls).toBe(1); // never retried
    expect((await ledger.listByWallet(WALLET))[0]?.state).toBe("failed");
  });
});

describe("buyQuote — C-2 whole-challenge ceiling", () => {
  const f402 = (body: unknown) => async () => ({
    status: 402,
    json: async () => body,
  });

  it("V2-only challenge (amount, no maxAmountRequired) → works", async () => {
    const q = await buyQuote("https://x", "GET", undefined, {
      fetcher: f402({ accepts: [{ amount: "60000" }] }),
    });
    expect(q.maxAmountAtomic).toBe("60000");
    expect(q.maxAmount).toBe("0.06");
  });

  it("V2 amount wins over V1 maxAmountRequired; ceiling = max across entries", async () => {
    const q = await buyQuote("https://x", "GET", undefined, {
      fetcher: f402({
        accepts: [
          { maxAmountRequired: "5", amount: "900" }, // V2 wins → 900
          { maxAmountRequired: "700" },              // V1 only → 700
        ],
      }),
    });
    // old code anchored on accepts[0].maxAmountRequired → "5"
    expect(q.maxAmountAtomic).toBe("900");
    expect(q.maxAmount).toBe("0.0009");
  });

  it("V1 flat challenge → top-level maxAmountRequired", async () => {
    const q = await buyQuote("https://x", "GET", undefined, {
      fetcher: f402({ maxAmountRequired: "50000" }),
    });
    expect(q.maxAmountAtomic).toBe("50000");
  });

  it("no usable amount field → throws", async () => {
    await expect(
      buyQuote("https://x", "GET", undefined, {
        fetcher: f402({ accepts: [{ payTo: "0x1" }] }),
      }),
    ).rejects.toThrow(/missing usable amount/);
  });
});
