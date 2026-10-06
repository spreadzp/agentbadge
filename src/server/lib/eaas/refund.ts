/**
 * SLICE-181-2: wiring helper — refund ledger + treasury sender + the
 * two-phase settle seam for EaaS routes (keeps wiring/eaas.ts under the
 * 300-line file-size cap).
 *
 * Auto-refund semantics (D-181-3): REFUND_AUTO_ENABLED gates the on-chain
 * send; the sender must own the x402 payTo treasury (REFUND_TREASURY_KEY,
 * falling back to MARKETPLACE_PAYOUT_KEY). Without a key, records stay
 * "pending" — the manual-ops queue — and the API still refuses honestly.
 */

import { createWalletClient, http, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "@agentbadge/passport";
import type { PaymentRouter } from "@agentbadge/circle-payments";
import { createJsonRefundLog, createRefundService } from "../refund-log";
import { createSettleSeamTwoPhase } from "../x402-settle-seam";
import { usdToBaseUnits } from "../marketplace/chain";

const USDC_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface EaasRefundStackOpts {
  router: PaymentRouter;
  /** "$x.xx" price string (config section). */
  evalUsd: string;
  /** resolveVenueNetwork() result — chain id, rpcUrl, usdc address. */
  net: { chain: { rpcUrl: string; usdc: `0x${string}` } };
  chain: Chain;
  /** Override for tests / alternate persistence. */
  refundLogPath?: string;
}

export function createEaasRefundStack(opts: EaasRefundStackOpts) {
  const key =
    process.env.REFUND_TREASURY_KEY ?? process.env.MARKETPLACE_PAYOUT_KEY;
  const account =
    key && /^0x[0-9a-fA-F]{64}$/.test(key)
      ? privateKeyToAccount(key as `0x${string}`)
      : null;
  const wallet = account
    ? createWalletClient({
      account,
      chain: opts.chain,
      transport: http(opts.net.chain.rpcUrl),
    })
    : null;
  if (process.env.REFUND_AUTO_ENABLED === "true" && !wallet) {
    logger.warn(
      "REFUND_AUTO_ENABLED but no REFUND_TREASURY_KEY/MARKETPLACE_PAYOUT_KEY — refunds stay pending",
    );
  }
  const refunds = createRefundService({
    log: createJsonRefundLog(opts.refundLogPath ?? ".data/refunds.json"),
    autoEnabled: () => process.env.REFUND_AUTO_ENABLED === "true",
    ...(wallet && account
      ? {
        send: (rec) =>
          wallet.writeContract({
            address: opts.net.chain.usdc,
            abi: USDC_TRANSFER_ABI,
            functionName: "transfer",
            args: [rec.payer, BigInt(rec.amountAtomic)],
            account,
            chain: opts.chain,
          }),
      }
      : {}),
  });
  const seam = createSettleSeamTwoPhase({
    router: opts.router,
    amountAtomic: () =>
      usdToBaseUnits(opts.evalUsd.replace(/^\$/, "")).toString(),
    description: "EaaS external job evaluation",
    refunds,
  });
  return { refunds, seam };
}
