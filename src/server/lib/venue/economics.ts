/**
 * SLICE-152-4: venue economics — take-rate + evaluator fee config.
 *
 * Reference `complete()` settles the FULL budget to the provider — no
 * native fee split (verified against deployed AgenticCommerce impl
 * 0xA316fd02…351a on Arc testnet). Fee paths, in priority order:
 *
 *   hook  — ARC_VENUE_FEE_HOOK set: createJob passes the hook address;
 *           the hook does afterAction(complete) fee transfer onchain.
 *   sweep — provider is a server EOA: post-settlement `collectFee`-style
 *           USDC transfer from provider wallet to treasury.
 *   none  — external provider, no hook: no take rate (eval fee only).
 *
 * IACPHook (verified from verified source): beforeAction(jobId, bytes4
 * selector, bytes data) / afterAction(jobId, selector, data); hook must be
 * ADMIN-whitelisted (HookNotWhitelisted) and pass ERC165(IACPHook) at
 * createJob; address(0) is always whitelisted (non-hooked path).
 */
import { encodeFunctionData, getAddress, parseUnits } from "viem";
import type { VenueNetwork } from "./chain";
import type { VenueJob } from "./store";
import type { VenueRecord } from "./venues";
import type { PreparedTx } from "./lifecycle";
import { splitPayout } from "@agentbadge/circle-payments";
import { serverSigner } from "./lifecycle-sign";
import { isSubscribed, subscriberTakeBps } from "./billing";

export type VenueFeeMode = "hook" | "sweep" | "none";

export interface VenueEconomics {
  /** Platform take rate, basis points (env ARC_VENUE_TAKE_BPS, default 250). */
  takeRateBps: number;
  /** Evaluator fee in atomic USDC (env ARC_EVAL_FEE_USDC, e.g. "100000"). */
  evalFeeAtomic: bigint;
  /** Treasury EOA receiving the take rate (env ARC_TREASURY_ADDRESS). */
  treasury: `0x${string}` | null;
  /** Deployed VenueFeeHook address (env ARC_VENUE_FEE_HOOK) — hook mode. */
  feeHook: `0x${string}` | null;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

/**
 * 153-5: per-venue take rate resolution —
 *   1. venue.policies.takeRateBps explicit override (admin-patched)
 *   2. ARC_BV_SUBSCRIBER_TAKE_BPS while the venue subscription is active
 *   3. ARC_VENUE_TAKE_BPS platform default
 */
export function effectiveTakeRateBps(venue?: VenueRecord): {
  bps: number;
  source: "override" | "subscriber" | "default";
} {
  const ov = venue?.policies?.takeRateBps;
  if (ov !== undefined && Number.isInteger(ov) && ov >= 0 && ov <= 10_000) {
    return { bps: ov, source: "override" };
  }
  const def = Number(process.env.ARC_VENUE_TAKE_BPS ?? "250");
  const fallback = Number.isInteger(def) && def >= 0 && def <= 10_000 ? def : 250;
  if (venue?.kind === "business" && isSubscribed(venue)) {
    return { bps: subscriberTakeBps(), source: "subscriber" };
  }
  return { bps: fallback, source: "default" };
}

/** Env-driven economics config — fresh read (env is cheap, tests mutate). */
export function venueEconomics(venue?: VenueRecord): VenueEconomics {
  const takeRateBps = effectiveTakeRateBps(venue).bps;
  const feeRaw = process.env.ARC_EVAL_FEE_USDC ?? "0";
  const evalFeeAtomic = /^[0-9]+$/.test(feeRaw) ? BigInt(feeRaw) : 0n;
  const treasuryEnv =
    process.env.ARC_TREASURY_ADDRESS ?? process.env.CIRCLE_TREASURY_ADDRESS;
  const treasury =
    treasuryEnv && /^0x[0-9a-fA-F]{40}$/.test(treasuryEnv)
      ? (getAddress(treasuryEnv) as `0x${string}`)
      : null;
  const hookEnv = process.env.ARC_VENUE_FEE_HOOK;
  const feeHook =
    hookEnv && /^0x[0-9a-fA-F]{40}$/.test(hookEnv) && hookEnv !== ZERO_ADDR
      ? (getAddress(hookEnv) as `0x${string}`)
      : null;
  return { takeRateBps, evalFeeAtomic, treasury, feeHook };
}

/**
 * Per-job fee mode. `hook` when a hook contract is configured (createJob
 * then carries it); `sweep` when provider is a server EOA we control;
 * `none` for external providers without a hook.
 */
export function resolveFeeMode(
  job: VenueJob,
  econ: VenueEconomics,
  net: VenueNetwork,
): VenueFeeMode {
  if (econ.feeHook) return "hook";
  if (econ.treasury && econ.takeRateBps > 0 && job.provider) {
    const signer = serverSigner("provider", net.chain.rpcUrl);
    if (signer && signer.address === getAddress(job.provider)) return "sweep";
  }
  return "none";
}

export interface FeeQuote {
  mode: VenueFeeMode;
  feeBps: number;
  /** Atomic USDC strings (precision-safe for JSON). */
  feeAtomic: string;
  providerAtomic: string;
  treasury: `0x${string}` | null;
}

/** Fee breakdown for a budget in human USDC — UI + GET /economics reuse. */
export function feeQuote(
  budgetUsdc: number,
  econ: VenueEconomics,
  mode: VenueFeeMode,
): FeeQuote {
  const budgetAtomic = parseUnits(String(budgetUsdc), 6);
  if (mode === "none" || econ.takeRateBps === 0) {
    return {
      mode,
      feeBps: 0,
      feeAtomic: "0",
      providerAtomic: budgetAtomic.toString(),
      treasury: econ.treasury,
    };
  }
  const split = splitPayout(budgetAtomic, econ.takeRateBps);
  return {
    mode,
    feeBps: econ.takeRateBps,
    feeAtomic: split.feeAmount.toString(),
    providerAtomic: split.providerAmount.toString(),
    treasury: econ.treasury,
  };
}

const ERC20_TRANSFER_ABI = [
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

/**
 * Post-settlement sweep calldata: USDC `transfer(treasury, fee)` signed by
 * the provider wallet. Returns null when no fee applies.
 */
export function buildFeeSweepTx(
  job: VenueJob,
  econ: VenueEconomics,
  net: VenueNetwork,
): PreparedTx | null {
  if (!econ.treasury) return null;
  const q = feeQuote(job.budgetUsdc, econ, "sweep");
  if (q.feeAtomic === "0") return null;
  return {
    to: net.chain.usdc as `0x${string}`,
    description: `venue fee sweep → treasury ${econ.treasury}`,
    data: encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [econ.treasury, BigInt(q.feeAtomic)],
    }),
  };
}
