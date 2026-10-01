/**
 * SLICE-152-2: venue job lifecycle state machine.
 *
 * Onchain (ERC-8183): Open → Funded → Submitted → Completed|Rejected;
 * Open|Funded|Submitted + expiredAt < now → Expired → claimRefund.
 * Every mutating route validates the ONCHAIN status first — the store
 * record is a cache, never the source of truth (see slice spec §2).
 *
 * Sign modes: "calldata" (default) returns {to,data} for wallet-connect;
 * "server" sends from a role EOA — only when the derived address matches
 * ARC_VENUE_SERVER_WALLETS (role:0x…,…) and a role key env exists.
 */
import {
  encodeFunctionData,
  keccak256,
  parseUnits,
  toBytes,
  type Hex,
} from "viem";
import type { VenueNetwork } from "./chain";
import type { VenueJob } from "./store";

// Server-sign block lives in lifecycle-sign.ts (max-lines).
export {
  sendAsRole,
  serverSigner,
  serverWalletAllowlist,
  type VenueRole,
} from "./lifecycle-sign";

// ─── State machine ───────────────────────────────────────────────

export type LifecycleAction =
  | "claim"
  | "fund"
  | "submit"
  | "complete"
  | "reject"
  | "refund";

/** Roles that may perform each action (used for allowlist + actor check). */
export const ACTION_ROLE: Record<LifecycleAction, "client" | "provider" | "evaluator" | "any"> = {
  claim: "provider",
  fund: "client",
  submit: "provider",
  complete: "evaluator",
  reject: "evaluator",
  refund: "client",
};

/**
 * Allowed source onchain statuses per action.
 * claim   — provider self-assigns + sets budget; job stays Open.
 * reject  — evaluator on funded|submitted; client may reject own Open job
 *           (role check in the route decides which applies).
 * refund  — Expired, or funded|submitted past expiredAt (contract expires it).
 */
const ALLOWED_FROM: Record<LifecycleAction, string[]> = {
  claim: ["open"],
  fund: ["open"],
  submit: ["funded"],
  complete: ["submitted"],
  reject: ["open", "funded", "submitted"],
  refund: ["expired", "open", "funded", "submitted"],
};

/** Store-facing status after the action's tx confirms. */
export const RESULT_STATUS: Record<LifecycleAction, string> = {
  claim: "open",
  fund: "funded",
  submit: "submitted",
  complete: "completed",
  reject: "rejected",
  refund: "expired",
};

export interface TransitionCheck {
  ok: boolean;
  current: string;
  expected: string[];
  reason?: string;
}

export function assertTransition(
  onchainStatus: string,
  action: LifecycleAction,
  expiredPast = false,
): TransitionCheck {
  const allowed = ALLOWED_FROM[action];
  const current = onchainStatus.toLowerCase();
  // refund needs the deadline passed unless chain already flagged Expired.
  if (action === "refund" && current !== "expired" && !expiredPast) {
    return {
      ok: false,
      current,
      expected: ["expired"],
      reason: "job not expired onchain — wait for expiredAt",
    };
  }
  if (!allowed.includes(current)) {
    return {
      ok: false,
      current,
      expected: allowed,
      reason: `cannot ${action} a job in status "${current}"`,
    };
  }
  return { ok: true, current, expected: allowed };
}

// ─── Calldata builder ────────────────────────────────────────────

export interface PreparedTx {
  to: `0x${string}`;
  data: Hex;
  description: string;
}

const EMPTY_PARAMS = "0x" as Hex;

/** Deliverable accepts 0x<64hex> or a plain string (keccak'd). */
export function deliverableHash(input: string): Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(input)
    ? (input as Hex)
    : keccak256(toBytes(input));
}

/** Encode the tx(s) for a lifecycle action — variant-aware via net.abi. */
export function buildActionTxs(
  net: VenueNetwork,
  action: LifecycleAction,
  args: { onchainJobId: bigint; amountUsdc?: number; deliverable?: Hex; reason?: Hex },
): PreparedTx[] {
  const to = net.agenticCommerce;
  const abi = net.abi;
  const isAcp = net.variant === "acp";
  const enc = (functionName: string, callArgs: unknown[]): Hex =>
    encodeFunctionData({ abi, functionName, args: callArgs } as never);

  switch (action) {
    case "claim": {
      if (args.amountUsdc == null) return [];
      const amount = parseUnits(String(args.amountUsdc), 6);
      return [{
        to,
        data: enc("setBudget", [args.onchainJobId, amount, EMPTY_PARAMS]),
        description: `setBudget(${args.onchainJobId}, ${amount}) — provider price`,
      }];
    }
    case "fund": {
      if (args.amountUsdc == null) return [];
      const amount = parseUnits(String(args.amountUsdc), 6);
      const fundArgs = isAcp
        ? [args.onchainJobId, amount, EMPTY_PARAMS]
        : [args.onchainJobId, EMPTY_PARAMS];
      return [
        {
          to: net.chain.usdc as `0x${string}`,
          data: encodeFunctionData({
            abi: [
              {
                type: "function",
                name: "approve",
                stateMutability: "nonpayable",
                inputs: [
                  { name: "spender", type: "address" },
                  { name: "amount", type: "uint256" },
                ],
                outputs: [{ name: "", type: "bool" }],
              },
            ] as const,
            functionName: "approve",
            args: [to, amount],
          }),
          description: `USDC approve(${to}, ${amount}) — must confirm before fund`,
        },
        {
          to,
          data: enc("fund", fundArgs),
          description: `fund(${args.onchainJobId}${isAcp ? `, ${amount}` : ""}) — escrow lock`,
        },
      ];
    }
    case "submit":
      return [{
        to,
        data: enc("submit", [args.onchainJobId, args.deliverable ?? keccak256(toBytes("")), EMPTY_PARAMS]),
        description: `submit(${args.onchainJobId}, deliverable)`,
      }];
    case "complete":
      return [{
        to,
        data: enc("complete", [args.onchainJobId, args.reason ?? EMPTY_PARAMS, EMPTY_PARAMS]),
        description: `complete(${args.onchainJobId}) — release escrow to provider`,
      }];
    case "reject":
      return [{
        to,
        data: enc("reject", [args.onchainJobId, args.reason ?? EMPTY_PARAMS, EMPTY_PARAMS]),
        description: `reject(${args.onchainJobId}) — refund escrow to client`,
      }];
    case "refund":
      return [{
        to,
        data: enc("claimRefund", [args.onchainJobId]),
        description: `claimRefund(${args.onchainJobId}) — expired escrow → client`,
      }];
  }
}

// ─── Actor gating ────────────────────────────────────────────────

/** Raw onchain tuple subset used by lifecycle routes. */
export interface OnchainJobRaw {
  status: number;
  expiredAt?: bigint | number;
  client?: string;
  provider?: string;
  evaluator?: string;
}

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export function sameWallet(a: string | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase() && b !== ZERO_ADDR;
}

/**
 * Actor-role check against onchain actors (store as fallback).
 * Provider may be unset onchain until claim — claim self-assigns.
 */
export function actorAllowed(
  role: "client" | "provider" | "evaluator" | "any",
  wallet: string,
  job: VenueJob,
  raw: OnchainJobRaw,
): boolean {
  if (role === "any") return true;
  const onchain = raw[role];
  const stored =
    role === "client" ? job.client
    : role === "provider" ? job.provider
    : job.evaluator;
  if (role === "provider" && !sameWallet(onchain, wallet)) {
    return !onchain || onchain === ZERO_ADDR
      ? !job.provider || sameWallet(job.provider, wallet)
      : false;
  }
  return (
    sameWallet(onchain, wallet) ||
    ((!onchain || onchain === ZERO_ADDR) && sameWallet(stored, wallet))
  );
}
