/**
 * SLICE-257-19 mediums batch — M-1 mode fail-closed, M-2 amount
 * strictness, M-9 asset decimals. Split from buy-counterparty.test.ts
 * (token-limit seam) — self-contained fixture copy.
 */
import { describe, it, expect } from "vitest";
import { buyPay, type BuyQuote, type BuyRunner } from "../../src/server/lib/buy/gateway";
import { counterpartyModeFromEnv } from "../../src/server/lib/buy/counterparty-gate";
import { createMemorySpendLedger } from "../../src/server/lib/agent-wallet/ledger";
import { createMemoryApprovalStore } from "../../src/server/lib/agent-wallet/approvals";
import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
} from "../../src/server/lib/agent-wallet/registry";
import {
  createCounterpartyPolicy,
  type CounterpartyChecker,
  type Vet402Assessment,
} from "@agentbadge/circle-payments";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const ASSET = "0x3333333333333333333333333333333333333333";
const NETWORK = "eip155:5042002";

const quote = (over: Partial<BuyQuote> = {}): BuyQuote => ({
  url: "https://gateway.usebuy.ai/v1/fx/usd-ngn",
  method: "POST",
  body: '{"fiat":"NGN"}',
  maxAmount: "0.05",
  maxAmountAtomic: "50000",
  raw: { x402Version: 2, accepts: [{ scheme: "exact", network: NETWORK, asset: ASSET, amount: "50000", payTo: PAY_TO }] },
  ...over,
});

const verdictA = (verdict: "ALLOW" | "WARN" | "BLOCK"): Vet402Assessment => ({
  kind: "verdict",
  verdict,
  reasonCodes: [],
  verifiedTerms: null,
  checkedAt: "2026-11-20T00:00:00.000Z",
  cacheHit: false,
});

const stubChecker = (a: Vet402Assessment): CounterpartyChecker & { calls: number } => {
  const c = { calls: 0, check: async () => (c.calls += 1, a) };
  return c;
};

const okRunner = (spawned: { n: number }): BuyRunner => async () => {
  spawned.n += 1;
  return { code: 0, stdout: "{}", stderr: "" };
};

function fixture() {
  const registry = createMemoryAgentWalletStore();
  const ledger = createMemorySpendLedger();
  const approvals = createMemoryApprovalStore();
  const rec: AgentWalletRecord = {
    address: WALLET,
    label: "buyer",
    kind: "eoa",
    envelope: {},
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
    gate: { registry: deps.registry, ledger: deps.ledger, approvals: deps.approvals },
    runner: okRunner(spawned),
    counterparty: { checker, policy: createCounterpartyPolicy(), mode },
  };
}

describe("257-19 mediums batch", () => {
  it("M-1: NODE_ENV unset/unknown → enforce (fail-closed), dev/test → off", () => {
    const env = (ne?: string, mode?: string) =>
      counterpartyModeFromEnv({
        NODE_ENV: ne,
        COUNTERPARTY_CHECK_MODE: mode,
      });
    expect(env("production")).toBe("enforce");
    expect(env(undefined)).toBe("enforce"); // unset → fail-closed
    expect(env("staging")).toBe("enforce"); // unknown → fail-closed
    expect(env("test")).toBe("off");
    expect(env("development")).toBe("off");
    expect(env("test", "enforce")).toBe("enforce"); // explicit wins
    expect(env("production", "shadow")).toBe("shadow");
  });

  it("M-2: uncomparable amount (unknown-decimals network) → typed deny before caps", async () => {
    const prev = process.env.BUY_GATEWAY_ENABLED;
    process.env.BUY_GATEWAY_ENABLED = "true";
    try {
      const f = fixture();
      await f.registry.put(f.rec);
      const checker = stubChecker(verdictA("ALLOW"));
      const spawned = { n: 0 };
      const q = { ...quote(), maxAmount: "uncomparable" };
      const r = await buyPay(q, WALLET, "ref-neg", payOpts(f, checker, spawned, "enforce"));
      expect(r.status).toBe("denied");
      if (r.status !== "denied") expect.unreachable();
      expect(r.deny.error).toBe("invalid_amount");
      expect(checker.calls).toBe(0); // never reached the gate
    } finally {
      if (prev === undefined) delete process.env.BUY_GATEWAY_ENABLED;
      else process.env.BUY_GATEWAY_ENABLED = prev;
    }
  });
});
