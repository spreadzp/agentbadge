// SLICE-176-4: wallet lifecycle orchestration — kill-switch.
//
// suspendWallet is the ONE call that suspends/resumes a wallet:
//   1. store.setSuspended — flag + suspendedAt/By (resumable quarantine,
//      NOT deactivate: active stays true, suspend ≠ irreversible);
//   2. on suspend: active reserved ledger entries → released —
//      cap space returns instantly (windowUsage/windowCount only count
//      reserved+settled);
//   3. onSuspended hook — SLICE-176-7 will reject pending approvals
//      (reason wallet_suspended); not wired yet (176-6 owns the store).
//
// enforcer.begin reads rec.suspended as the FIRST branch — see the
// branch-order comment there (suspended → kind → permit → caps →
// approval-hold → reserve).

import type { AgentWalletStore } from "./registry";
import type { SpendLedger } from "./ledger";

export interface SuspendDeps {
  store: AgentWalletStore;
  ledger: SpendLedger;
  /** SLICE-176-7: reject pending approvals (reason wallet_suspended). */
  onSuspended?: (wallet: string) => Promise<void>;
}

export interface SuspendResult {
  /** false when the wallet is unknown. */
  ok: boolean;
  /** New flag value. */
  suspended: boolean;
  /** Reserved entries released by this call (suspend only). */
  released: number;
}

/**
 * Release every active reserved entry of the wallet — transitions are
 * reserved-only by ledger contract, so settled/denied/released rows are
 * untouched. Returns the released count.
 */
export async function releaseWalletReserves(
  ledger: SpendLedger,
  wallet: string,
): Promise<number> {
  let released = 0;
  for (const e of await ledger.listByWallet(wallet)) {
    if (e.state !== "reserved") continue;
    if (await ledger.transition(e.id, "released")) released += 1;
  }
  return released;
}

/** Suspend (flag=true) or resume (flag=false) a wallet. */
export async function suspendWallet(
  deps: SuspendDeps,
  address: string,
  flag: boolean,
  actor?: string,
): Promise<SuspendResult> {
  const ok = await deps.store.setSuspended(address, flag, actor);
  if (!ok) return { ok: false, suspended: flag, released: 0 };
  if (!flag) return { ok: true, suspended: false, released: 0 };
  const released = await releaseWalletReserves(deps.ledger, address);
  if (deps.onSuspended) await deps.onSuspended(address);
  return { ok: true, suspended: true, released };
}
