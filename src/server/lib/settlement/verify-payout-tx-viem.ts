/**
 * EPIC-227 / SLICE-227-8 — the real VerifyPayoutTx adapter (arc-audit
 * R3 H-1). Reads the tx + receipt over the venue public client and
 * reports observed facts; verifyLegTx() cross-checks them against the
 * leg expectation — this adapter never decides, it only reports.
 *
 * USDC is Arc's native gas token, so a payout is a native transfer:
 * `tx.to` is the payee and `tx.value` the amount (18 decimals).
 * An ERC-20 USDC Transfer log is also accepted when `usdcToken` pins
 * the contract — any other token contract reports its own address and
 * cannot satisfy a USDC leg.
 */
import { formatUnits, isAddress, keccak256, toBytes } from "viem";

import type { VerifyPayoutTx } from "./verify-payout-tx.js";

/** Minimal viem surface — the venue PublicClient satisfies it; tests
 *  can stub it without a chain. */
export interface PayoutTxSource {
  getTransaction(args: { hash: `0x${string}` }): Promise<{
    to: `0x${string}` | null;
    from: `0x${string}`;
    value: bigint;
  } | null>;
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{
    status: string;
    blockNumber: bigint;
    logs: { address: string; topics: `0x${string}`[]; data: `0x${string}` }[];
  } | null>;
  getBlockNumber(): Promise<bigint>;
  getBlock?(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  /** R4-M1: the RPC's own chain id — reported, never echoed from
   *  config (a pin that only echoes configuration proves nothing). */
  getChainId?(): Promise<bigint | number>;
  chain?: { id?: number };
}

const TRANSFER_TOPIC = keccak256(
  toBytes("Transfer(address,address,uint256)"),
);

const topicAddress = (t: `0x${string}`): string =>
  `0x${t.slice(-40)}`.toLowerCase();

export function createViemPayoutVerifier(
  client: PayoutTxSource,
  opts: {
    /** Network label reported on the check ("arc"). */
    networkLabel?: string;
    /** Chain id reported + cross-checked (decimal string). */
    chainId?: string;
    /** Pinned ERC-20 USDC contract — absent → only the native rail. */
    usdcToken?: `0x${string}`;
  } = {},
): VerifyPayoutTx {
  const usdcToken = opts.usdcToken?.toLowerCase();
  return async (txHash, expected) => {
    const hash = txHash as `0x${string}`;
    let tx, receipt;
    try {
      [tx, receipt] = await Promise.all([
        client.getTransaction({ hash }),
        client.getTransactionReceipt({ hash }),
      ]);
    } catch (e) {
      return {
        verified: false,
        reason: `rpc read failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (!tx || !receipt) {
      return { verified: false, reason: "tx not found on this chain" };
    }
    if (receipt.status !== "success") {
      return { verified: false, reason: "tx reverted on-chain" };
    }
    const latest = await client.getBlockNumber();
    const confirmations = Number(latest - receipt.blockNumber) + 1;
    // R4-M1: report the chain the RPC actually serves — the expected
    // compare in verifyLegTx fails closed on mismatch; echoing the
    // configured pin would make the cross-check a tautology.
    const observedChainId = client.getChainId
      ? String(await client.getChainId())
      : client.chain?.id !== undefined
        ? String(client.chain.id)
        : undefined;
    // Inclusion-age check — a payout predating the intent can never
    // satisfy it (the seam contract's tx-age clause).
    if (typeof expected.notBeforeMs === "number") {
      if (!client.getBlock) {
        return {
          verified: false,
          reason: "block timestamp unavailable — cannot prove inclusion age",
        };
      }
      const block = await client.getBlock({
        blockNumber: receipt.blockNumber,
      });
      const includedAtMs = Number(block.timestamp) * 1000;
      if (includedAtMs < expected.notBeforeMs) {
        return {
          verified: false,
          reason: `tx included at ${includedAtMs}ms, before intent ${expected.notBeforeMs}ms`,
        };
      }
    }
    const base = {
      verified: true as const,
      network: opts.networkLabel ?? "arc",
      chainId: observedChainId,
      payer: tx.from.toLowerCase(),
      confirmations,
    };

    // Native USDC rail — Arc's gas token IS USDC: tx.to is the payee.
    if (tx.to && tx.value > 0n) {
      return {
        ...base,
        payee: tx.to.toLowerCase(),
        amount: formatUnits(tx.value, 18),
        asset: "USDC",
        token: "native",
      };
    }

    // ERC-20 USDC fallback — only the pinned contract counts. Exactly
    // 3 topics scopes to ERC-20 Transfer (ERC-721 has 4 indexed args);
    // the Transfer's `from` must be the tx sender — a third-party
    // Transfer to the payee cannot satisfy a treasury payout leg.
    const payeeLower = expected.payee.toLowerCase();
    for (const log of receipt.logs) {
      if (log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC) {
        continue;
      }
      if (usdcToken && log.address.toLowerCase() !== usdcToken) continue;
      if (topicAddress(log.topics[1]!) !== tx.from.toLowerCase()) continue;
      const to = topicAddress(log.topics[2]!);
      if (to !== payeeLower) continue;
      if (log.data === "0x" || log.data === "0x0") continue;
      const amount = formatUnits(BigInt(log.data), 6); // ERC-20 USDC: 6 dec
      return {
        ...base,
        payee: to,
        amount,
        asset: usdcToken ? "USDC" : log.address.toLowerCase(),
        token: log.address.toLowerCase(),
      };
    }
    return {
      verified: false,
      reason: "no matching native or pinned-token transfer in receipt",
    };
  };
}

/** Validate the treasury-pin env — a malformed address would make the
 *  pin unmeetable (fail-closed) or silently bypassed; catch it loudly
 *  at wiring time instead. */
export function treasuryPayerFromEnv(
  raw: string | undefined,
): string | undefined {
  if (!raw) return undefined;
  return isAddress(raw) ? raw.toLowerCase() : undefined;
}
