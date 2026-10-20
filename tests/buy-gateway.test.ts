/**
 * SLICE-191-10: buy gateway — quote-first flow, spend envelope before
 * spawn, refusal-only retry discipline, kill-switch.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  atomicToUnits,
  buyPay,
  classifyBuyFailure,
  type BuyQuote,
  type BuyRunner,
} from "../src/server/lib/buy/gateway";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
  type AgentWalletStore,
  type SpendCaps,
} from "../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendLedger,
  type SpendLedger,
} from "../src/server/lib/agent-wallet/ledger";
import {
  createMemoryApprovalStore,
  type ApprovalStore,
} from "../src/server/lib/agent-wallet/approvals";

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

  it("4xx / 503 / verify_payment_failed → refused (pre-settlement)", () => {
    for (const stderr of [
      "402 verify_payment_failed",
      "400 invalid_request",
      "503 service unavailable",
      // sandbox/CLI-side refusals — nothing signed, pre-settlement
      '{"error":{"code":"no_matching_requirements"}}',
      "insufficient_funds: USDC balance too low",
    ]) {
      expect(
        classifyBuyFailure({ code: 1, stdout: "", stderr }),
      ).toBe("refused");
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

  it("refused (503) → retries once then released", async () => {
    const { deps, ledger } = gate();
    await registerWallet(deps.registry);
    let calls = 0;
    const res = await buyPay(quote(), WALLET, "r7", {
      gate: deps,
      maxRetries: 1,
      runner: async () => {
        calls++;
        return { code: 1, stdout: "", stderr: "503 unavailable" };
      },
    });
    expect(res.status).toBe("refused");
    expect(calls).toBe(2); // initial + 1 retry
    expect((await ledger.listByWallet(WALLET))[0]?.state).toBe("released");
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
