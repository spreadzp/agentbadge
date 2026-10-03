/**
 * SLICE-156-6: DelegateRegistry — unified-balance delegate spends.
 *
 * Model: tenant wallet (owner, often a Circle Wallets SCA that cannot
 * sign its own spends) authorizes our server EOA as a per-chain
 * delegate via App Kit `unifiedBalance.addDelegate`. Server flows
 * (renewals, auto-pay) then call `spend` with `sourceAccount=owner`,
 * signed by the delegate key (`ARC_DELEGATE_KEY`, spend-only scope —
 * it can draw to a destination, never withdraw/removeFund).
 *
 * Spike note: `@circle-fin/unified-balance-kit` is NOT a dependency
 * yet — live spend goes through the `DelegateSpendKit` interface;
 * wiring ships a stub until the kit dep lands (see slice doc).
 *
 * Revocation is two-sided: onchain `removeDelegate` must be signed by
 * the owner (we hand back verbatim params); server-side `revokedAt`
 * stops all spends immediately — checked before every kit call.
 */
import { isAddress, getAddress } from "viem";

export interface DelegateRecord {
  /** Owner wallet — unified balance depositor (checksummed). */
  ownerWallet: `0x${string}`;
  /** Server delegate EOA — derived from ARC_DELEGATE_KEY. */
  delegate: `0x${string}`;
  /** Adapter chain name the delegation covers ("Base_Sepolia"…). */
  chain: string;
  /** Per-tx cap — mirrors the owner's envelope perTxUsd. */
  spendCapUsd: number;
  authorizedAt: number;
  revokedAt?: number;
}

export interface DelegateStore {
  put(rec: DelegateRecord): void;
  get(ownerWallet: string, chain: string): DelegateRecord | undefined;
  /** All records for an owner, newest first. */
  list(ownerWallet: string): DelegateRecord[];
  /** Sets revokedAt=now. Returns false if unknown or already revoked. */
  revoke(ownerWallet: string, chain: string): boolean;
}

export function createMemoryDelegateStore(): DelegateStore {
  const map = new Map<string, DelegateRecord>();
  const key = (w: string, ch: string) => `${w.toLowerCase()}:${ch}`;
  return {
    put(rec) {
      map.set(key(rec.ownerWallet, rec.chain), rec);
    },
    get(w, ch) {
      return map.get(key(w, ch));
    },
    list(w) {
      return [...map.values()]
        .filter((r) => r.ownerWallet.toLowerCase() === w.toLowerCase())
        .sort((a, b) => b.authorizedAt - a.authorizedAt);
    },
    revoke(w, ch) {
      const rec = map.get(key(w, ch));
      if (!rec || rec.revokedAt !== undefined) return false;
      rec.revokedAt = Date.now();
      return true;
    },
  };
}

/** Throws on invalid register input (client-safe messages). */
export function validateDelegateInput(input: {
  ownerWallet: string;
  delegate: string;
  chain: string;
  spendCapUsd: number;
}): DelegateRecord {
  if (!isAddress(input.ownerWallet)) throw new Error("invalid owner wallet");
  if (!isAddress(input.delegate)) throw new Error("invalid delegate address");
  if (!input.chain || input.chain.length > 64)
    throw new Error("invalid chain");
  if (
    !Number.isFinite(input.spendCapUsd) ||
    input.spendCapUsd <= 0 ||
    input.spendCapUsd > 1_000_000
  )
    throw new Error("spendCapUsd must be in (0, 1e6]");
  return {
    ownerWallet: getAddress(input.ownerWallet),
    delegate: getAddress(input.delegate),
    chain: input.chain,
    spendCapUsd: input.spendCapUsd,
    authorizedAt: Date.now(),
  };
}

/* --------------------------- DelegateSpendKit --------------------------- */

export type DelegateStatus = "none" | "pending" | "ready";

/** App Kit `unifiedBalance` slice we depend on — injectable so the
 *  real kit (or a test mock) plugs in without touching call-sites. */
export interface DelegateSpendKit {
  getDelegateStatus(args: {
    ownerWallet: string;
    chain: string;
    delegate: string;
  }): Promise<DelegateStatus>;
  /** Delegate-signed spend drawing from the owner's unified balance. */
  spend(args: {
    sourceAccount: string;
    chain: string;
    amountUsd: string;
    to: { chain: string; recipientAddress: string };
  }): Promise<{ transferId?: string; tx?: string }>;
}

export type DelegateSpendResult =
  | { ok: true; transferId?: string; tx?: string }
  | { ok: false; reason: string };

/**
 * Server-side spend from a delegate-authorized owner. Enforces (in
 * order): record exists & not revoked → per-tx cap → onchain delegate
 * status is 'ready'. Envelope parity: spendCapUsd mirrors the owner's
 * envelope perTxUsd — server-initiated spends don't pass through the
 * request-context envelope (no Hono context), the registry cap is
 * the enforcement point documented in the slice.
 */
export async function spendAsDelegate(
  store: DelegateStore,
  kit: DelegateSpendKit,
  args: {
    ownerWallet: string;
    chain: string;
    amountUsd: string;
    to: { chain: string; recipientAddress: string };
  },
): Promise<DelegateSpendResult> {
  const rec = store.get(args.ownerWallet, args.chain);
  if (!rec || rec.revokedAt !== undefined) {
    return { ok: false, reason: "no-active-delegate" };
  }
  const amount = Number(args.amountUsd);
  if (!Number.isFinite(amount) || amount <= 0 || amount > rec.spendCapUsd) {
    return { ok: false, reason: "cap-exceeded" };
  }
  const status = await kit.getDelegateStatus({
    ownerWallet: rec.ownerWallet,
    chain: rec.chain,
    delegate: rec.delegate,
  });
  if (status !== "ready") {
    return { ok: false, reason: `delegate-${status}` };
  }
  const out = await kit.spend({
    sourceAccount: rec.ownerWallet,
    chain: rec.chain,
    amountUsd: args.amountUsd,
    to: args.to,
  });
  return { ok: true, ...out };
}
