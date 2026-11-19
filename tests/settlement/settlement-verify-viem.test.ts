/**
 * SLICE-227-8 / R3-H1: the real VerifyPayoutTx adapter — viem receipt
 * inspection over native USDC (Arc gas token) + pinned ERC-20.
 * The adapter only reports; verifyLegTx() cross-checks the fields.
 */
import { describe, expect, it } from "vitest";
import { formatUnits, keccak256, toBytes } from "viem";

import {
  createViemPayoutVerifier,
  treasuryPayerFromEnv,
  type PayoutTxSource,
} from "../../src/server/lib/settlement/verify-payout-tx-viem.js";
import { verifyLegTx } from "../../src/server/lib/settlement/index.js";

const PAYEE = "0x2222222222222222222222222222222222222222";
const TREASURY = "0x9999999999999999999999999999999999999999";
const USDC_TOKEN = "0x7777777777777777777777777777777777777777";
const FAKE_TOKEN = "0x8888888888888888888888888888888888888888";
const TX = `0x${"c".repeat(64)}`;
const TRANSFER_TOPIC = keccak256(
  toBytes("Transfer(address,address,uint256)"),
);
const topicFor = (addr: string): `0x${string}` =>
  `0x${"0".repeat(24)}${addr.slice(2).toLowerCase()}` as `0x${string}`;

interface Source {
  tx?: {
    to: `0x${string}` | null;
    from: `0x${string}`;
    value: bigint;
  } | null;
  receipt?: {
    status: string;
    blockNumber: bigint;
    logs: { address: string; topics: `0x${string}`[]; data: `0x${string}` }[];
  } | null;
  latest?: bigint;
  blockTs?: bigint;
  chainId?: number;
  /** R4-M1: what eth_chainId actually serves — observed, not echoed. */
  rpcChainId?: number;
}

function stubClient(s: Source): PayoutTxSource {
  return {
    getTransaction: async () => s.tx ?? null,
    getTransactionReceipt: async () => s.receipt ?? null,
    getBlockNumber: async () => s.latest ?? 200n,
    getBlock: async () => ({ timestamp: s.blockTs ?? 1_800_000_000n }),
    getChainId: async () => s.rpcChainId ?? s.chainId ?? 0,
    chain: { id: s.chainId },
  };
}

const okReceipt = {
  status: "success",
  blockNumber: 100n,
  logs: [],
};

describe("createViemPayoutVerifier (R3-H1)", () => {
  it("verifies a native USDC transfer: payee, amount, payer, chain, confirmations", async () => {
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: PAYEE as `0x${string}`, from: TREASURY as `0x${string}`, value: 7_500_000_000_000_000_000n },
        receipt: okReceipt,
        chainId: 5042002,
      }),
      { networkLabel: "arc", chainId: "5042002" },
    );
    const check = await v(TX, {
      payee: PAYEE,
      amount: "7.5",
      currency: "USDC",
      chainId: "5042002",
      expectedPayer: TREASURY,
    });
    expect(check.verified).toBe(true);
    expect(check.payee).toBe(PAYEE);
    expect(check.payer).toBe(TREASURY);
    expect(check.asset).toBe("USDC");
    expect(check.token).toBe("native");
    expect(check.chainId).toBe("5042002");
    expect(check.amount).toBe(formatUnits(7_500_000_000_000_000_000n, 18));
    expect(check.confirmations).toBe(101);
  });

  it("fails on missing tx / reverted receipt", async () => {
    const v = createViemPayoutVerifier(
      stubClient({ tx: null, receipt: null }),
    );
    expect((await v(TX, {} as never)).verified).toBe(false);
    const reverted = createViemPayoutVerifier(
      stubClient({
        tx: { to: PAYEE as `0x${string}`, from: TREASURY as `0x${string}`, value: 1n },
        receipt: { ...okReceipt, status: "reverted" },
      }),
    );
    expect((await reverted(TX, {} as never)).verified).toBe(false);
  });

  it("accepts an ERC-20 Transfer on the pinned USDC contract", async () => {
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: USDC_TOKEN as `0x${string}`, from: TREASURY as `0x${string}`, value: 0n },
        receipt: {
          ...okReceipt,
          logs: [
            {
              address: USDC_TOKEN,
              topics: [TRANSFER_TOPIC, topicFor(TREASURY), topicFor(PAYEE)],
              data: `0x${(7_500_000n).toString(16).padStart(64, "0")}`,
            },
          ],
        },
      }),
      { usdcToken: USDC_TOKEN as `0x${string}` },
    );
    const check = await v(TX, {
      payee: PAYEE,
      amount: "7.5",
      currency: "USDC",
      token: USDC_TOKEN,
    } as never);
    expect(check.verified).toBe(true);
    expect(check.amount).toBe("7.5");
    expect(check.token).toBe(USDC_TOKEN);
  });

  it("a fake-USDC ERC-20 can never satisfy a pinned leg", async () => {
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: FAKE_TOKEN as `0x${string}`, from: TREASURY as `0x${string}`, value: 0n },
        receipt: {
          ...okReceipt,
          logs: [
            {
              address: FAKE_TOKEN,
              topics: [TRANSFER_TOPIC, topicFor(TREASURY), topicFor(PAYEE)],
              data: `0x${(7_500_000n).toString(16).padStart(64, "0")}`,
            },
          ],
        },
      }),
      { usdcToken: USDC_TOKEN as `0x${string}` },
    );
    // The adapter sees no pinned-contract transfer → not verified.
    expect(
      (
        await v(TX, {
          payee: PAYEE,
          amount: "7.5",
          currency: "USDC",
          token: USDC_TOKEN,
        } as never)
      ).verified,
    ).toBe(false);
  });

  it("rejects a tx included before the intent (notBeforeMs)", async () => {
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: PAYEE as `0x${string}`, from: TREASURY as `0x${string}`, value: 1_000_000_000_000_000_000n },
        receipt: okReceipt,
        blockTs: 1_000_000n,
      }),
    );
    const check = await v(TX, {
      payee: PAYEE,
      amount: "1",
      currency: "USDC",
      notBeforeMs: 1_000_000_001_000,
    });
    expect(check.verified).toBe(false);
    expect(check.reason).toContain("before intent");
  });

  it("R4-M1: reports the RPC's observed chain id, not the configured pin", async () => {
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: PAYEE as `0x${string}`, from: TREASURY as `0x${string}`, value: 7_500_000_000_000_000_000n },
        receipt: okReceipt,
        rpcChainId: 1, // RPC actually serves a different chain
      }),
      { networkLabel: "arc", chainId: "5042002" },
    );
    const check = await v(TX, {
      payee: PAYEE,
      amount: "7.5",
      currency: "USDC",
      chainId: "5042002",
    });
    expect(check.verified).toBe(true);
    expect(check.chainId).toBe("1"); // observed, not echoed
    // …and verifyLegTx's compare fails closed on the mismatch:
    const res = await verifyLegTx(v, TX, {
      payee: PAYEE,
      amount: "7.5",
      currency: "USDC",
      chainId: "5042002",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("TX_UNVERIFIED");
  });

  it("R4-M2: a token pin does not break the native rail", async () => {
    // markLegPaid always forwards deps.usdcToken as expected.token —
    // a native payout must still verify while the pin is configured.
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: PAYEE as `0x${string}`, from: TREASURY as `0x${string}`, value: 7_500_000_000_000_000_000n },
        receipt: okReceipt,
        rpcChainId: 5042002,
      }),
      { usdcToken: USDC_TOKEN as `0x${string}` },
    );
    const res = await verifyLegTx(v, TX, {
      payee: PAYEE,
      amount: "7.5",
      currency: "USDC",
      token: USDC_TOKEN,
      expectedPayer: TREASURY,
    });
    expect(res.ok).toBe(true);
  });

  it("R4 nit: an ERC-20 token fact with no pin configured fails closed", async () => {
    const res = await verifyLegTx(
      async () => ({
        verified: true,
        network: "arc",
        payer: TREASURY,
        payee: PAYEE,
        asset: "USDC",
        amount: "7.5",
        token: USDC_TOKEN, // adapter claims an ERC-20 transfer
        confirmations: 3,
      }),
      TX,
      { payee: PAYEE, amount: "7.5", currency: "USDC" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("TX_UNVERIFIED");
  });

  it("R4 nit: ERC-20 Transfer must originate from the tx sender", async () => {
    const STRANGER = "0x5555555555555555555555555555555555555555";
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: USDC_TOKEN as `0x${string}`, from: STRANGER as `0x${string}`, value: 0n },
        receipt: {
          ...okReceipt,
          logs: [
            {
              address: USDC_TOKEN,
              // transfer FROM treasury — but tx.from is the stranger
              topics: [TRANSFER_TOPIC, topicFor(TREASURY), topicFor(PAYEE)],
              data: `0x${(7_500_000n).toString(16).padStart(64, "0")}`,
            },
          ],
        },
      }),
      { usdcToken: USDC_TOKEN as `0x${string}` },
    );
    expect(
      (
        await v(TX, {
          payee: PAYEE,
          amount: "7.5",
          currency: "USDC",
          token: USDC_TOKEN,
        } as never)
      ).verified,
    ).toBe(false);
  });

  it("R4 nit: a 4-topic (ERC-721-shaped) log is not an ERC-20 payout", async () => {
    const v = createViemPayoutVerifier(
      stubClient({
        tx: { to: USDC_TOKEN as `0x${string}`, from: TREASURY as `0x${string}`, value: 0n },
        receipt: {
          ...okReceipt,
          logs: [
            {
              address: USDC_TOKEN,
              topics: [
                TRANSFER_TOPIC,
                topicFor(TREASURY),
                topicFor(PAYEE),
                `0x${"0".repeat(63)}1` as `0x${string}`, // tokenId
              ],
              data: "0x",
            },
          ],
        },
      }),
      { usdcToken: USDC_TOKEN as `0x${string}` },
    );
    expect(
      (
        await v(TX, {
          payee: PAYEE,
          amount: "7.5",
          currency: "USDC",
          token: USDC_TOKEN,
        } as never)
      ).verified,
    ).toBe(false);
  });

  it("treasuryPayerFromEnv validates EVM addresses", () => {
    expect(treasuryPayerFromEnv(undefined)).toBeUndefined();
    expect(treasuryPayerFromEnv("not-an-address")).toBeUndefined();
    expect(treasuryPayerFromEnv(TREASURY)).toBe(TREASURY);
  });
});

describe("verifyLegTx normalization (R3-M6)", () => {
  it("accepts a hex/number chain id equal to the decimal pin", async () => {
    const hexId = `0x${(5042002).toString(16)}`;
    const res = await verifyLegTx(
      async () => ({
        verified: true,
        network: "ARC",
        chainId: hexId,
        payer: TREASURY,
        payee: PAYEE,
        asset: "usdc",
        amount: "7.50",
        confirmations: 3,
      }),
      TX,
      {
        payee: PAYEE,
        amount: "7.5",
        currency: "USDC",
        network: "arc",
        chainId: "5042002",
        expectedPayer: TREASURY,
      },
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a >6dp adapter amount (no silent truncation)", async () => {
    const res = await verifyLegTx(
      async () => ({
        verified: true,
        network: "arc",
        payer: TREASURY,
        payee: PAYEE,
        asset: "USDC",
        amount: "10.0000009",
        confirmations: 3,
      }),
      TX,
      {
        payee: PAYEE,
        amount: "10.00",
        currency: "USDC",
        expectedPayer: TREASURY,
      },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("TX_UNVERIFIED");
  });
});
