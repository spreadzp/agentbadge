/**
 * Mint-on-payment for AccessPassNFT (EPIC-137, SLICE-137-4).
 *
 * After an x402 payment settles, the server mints/extends an access pass
 * for the payer wallet on Arc Testnet (D6: tx.from is the AA proof — no
 * extra signature needed at purchase time; D14: mint always on Arc).
 *
 * Duration is computed SERVER-side from the settled amount (D16):
 * day-rate per class in env config, min 1 day. Contract stores only
 * expiresAt — pricing changes need no redeploy.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "@agentbadge/passport";
import { resolveBundleIds, RULE_BUNDLES } from "../../agent-readiness/rule-bundles";

// ─── Class bits (mirror AccessPassNFT.sol / agent-auth.ts) ─────
export const CLASS_MEDIUM = 1;
export const CLASS_HEAVY = 2;
export const CLASS_FULL = 4;

const COST_CLASS_BITS: Record<string, number> = {
  light: 0, // light stays free (D12) — no bit in contract
  medium: CLASS_MEDIUM,
  heavy: CLASS_HEAVY,
};

/**
 * Map requested pack ids → contract class bitmask.
 * - empty packs (full scan) → CLASS_FULL
 * - light-only selection → CLASS_MEDIUM (a paid scan grants at least medium)
 * - mixed → OR of class bits
 */
export function packsToClassMask(packs: readonly string[]): number {
  if (packs.length === 0) return CLASS_FULL;
  const { ok } = resolveBundleIds([...packs]);
  let mask = 0;
  for (const id of ok) {
    const def = RULE_BUNDLES.find((b) => b.id === id);
    if (def) mask |= COST_CLASS_BITS[def.costClass] ?? 0;
  }
  return mask === 0 ? CLASS_MEDIUM : mask;
}

// ─── Pricing (D16/D17): day-rate per class, env-configurable ───
const DAY_SEC = 86_400;

function dayRateUsd(classMask: number): number {
  // Highest bit wins for combined masks
  const envKey =
    classMask & CLASS_FULL
      ? "ACCESS_PASS_DAY_RATE_FULL_USD"
      : classMask & CLASS_HEAVY
        ? "ACCESS_PASS_DAY_RATE_HEAVY_USD"
        : "ACCESS_PASS_DAY_RATE_MEDIUM_USD";
  const fallback = classMask & CLASS_FULL ? 1.5 : classMask & CLASS_HEAVY ? 1.0 : 0.8;
  const raw = process.env[envKey];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** USDC base units (6 decimals) → pass duration in seconds. Min 1 day. */
export function durationSecondsForAmount(
  amountBaseUnits: string,
  classMask: number,
): number {
  const micro = BigInt(amountBaseUnits || "0");
  const usd = Number(micro) / 1e6;
  const days = usd / dayRateUsd(classMask);
  return Math.max(DAY_SEC, Math.floor(days * DAY_SEC));
}

// ─── Minter (server EOA with MINTER_ROLE on Arc) ───────────────
const MINT_ABI = [
  {
    name: "mintOrExtend",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "cls", type: "uint8" },
      { name: "durationSec", type: "uint64" },
      { name: "agentId_", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface MintRequest {
  to: string;
  classMask: number;
  durationSec: number;
  agentId: bigint;
  /** Settled x402 payment tx hash — for audit logs (D20 memo is on-chain metadata, not a contract arg) */
  paymentTx?: string;
}

export type MinterFn = (req: MintRequest) => Promise<string>;

const arcTestnet = defineChain({
  id: 5042002,
  name: "arc-testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network",
      ],
    },
  },
});

let _minterClient: { wallet: ReturnType<typeof createWalletClient>; pub: ReturnType<typeof createPublicClient> } | null = null;

async function defaultMinter(req: MintRequest): Promise<string> {
  const key = process.env.ACCESS_PASS_MINTER_KEY;
  const nft = process.env.ACCESS_PASS_NFT;
  if (!key || !nft) {
    throw new Error("ACCESS_PASS_MINTER_KEY / ACCESS_PASS_NFT not configured");
  }
  if (!_minterClient) {
    const account = privateKeyToAccount(key as `0x${string}`);
    const transport = http(arcTestnet.rpcUrls.default.http[0]);
    _minterClient = {
      wallet: createWalletClient({ account, chain: arcTestnet, transport }),
      pub: createPublicClient({ chain: arcTestnet, transport }),
    };
  }
  // Cast: bundled viem chain types differ from hoisted viem (same as keeperhub-onchain.ts)
  const hash = await _minterClient.wallet.writeContract({
    address: nft as `0x${string}`,
    abi: MINT_ABI,
    functionName: "mintOrExtend",
    args: [
      req.to as `0x${string}`,
      req.classMask,
      BigInt(req.durationSec),
      req.agentId,
    ],
  } as never);
  // Wait for inclusion so hasAccess is true before the agent retries
  await _minterClient.pub.waitForTransactionReceipt({ hash });
  return hash;
}

// ─── Test overrides (same pattern as agent-auth.ts) ────────────
let _overrideMinter: MinterFn | null = null;

export function configureAccessPassMinterForTesting(config: {
  minter?: MinterFn | null;
}) {
  _overrideMinter = config.minter ?? null;
}

export function resetAccessPassMinterForTesting() {
  _overrideMinter = null;
  _minterClient = null;
}

// ─── x402 afterSettle hook ─────────────────────────────────────
interface SettleResultLike {
  success: boolean;
  payer?: string;
  amount?: string;
  transaction?: string;
}

interface SettleContextLike {
  result: SettleResultLike;
  requirements?: { amount?: string };
  transportContext?: unknown;
}

async function packsFromContext(ctx: SettleContextLike): Promise<string[]> {
  try {
    const tc = ctx.transportContext as
      | { request?: { adapter?: { getBody?: () => Promise<unknown> } } }
      | undefined;
    const body = await tc?.request?.adapter?.getBody?.();
    const packs = (body as { packs?: unknown } | undefined)?.packs;
    return Array.isArray(packs) ? (packs as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * AfterSettleHook for x402ResourceServer.onAfterSettle().
 * Mints/extends the payer's pass; failures are logged, never rethrown —
 * the payment is already settled and the response already served (D10).
 */
export function createMintOnSettleHook() {
  return async (ctx: SettleContextLike): Promise<void> => {
    const payer = ctx.result?.payer;
    if (!ctx.result?.success || !payer) {
      if (ctx.result?.success) {
        logger.warn("access-pass-mint: settled but no payer in result — skipping");
      }
      return;
    }
    try {
      const packs = await packsFromContext(ctx);
      const classMask = packsToClassMask(packs);
      const amount = ctx.result.amount ?? ctx.requirements?.amount ?? "0";
      const durationSec = durationSecondsForAmount(amount, classMask);
      const minter = _overrideMinter ?? defaultMinter;
      const tx = await minter({
        to: payer,
        classMask,
        durationSec,
        agentId: 0n,
        paymentTx: ctx.result.transaction,
      });
      logger.info("access-pass-mint: pass minted/extended", {
        payer,
        classMask,
        durationSec,
        mintTx: tx,
        paymentTx: ctx.result.transaction,
      });
    } catch (err) {
      logger.error("access-pass-mint: mint failed after settle", {
        payer,
        err: String(err),
        paymentTx: ctx.result.transaction,
      });
    }
  };
}
