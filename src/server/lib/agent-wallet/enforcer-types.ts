// SLICE-263-1: enforcer contract types extracted from enforcer.ts
// (300-line guard). The public surface stays enforcer.ts via
// re-export — these are pure declarations, no runtime code.

import type { Context } from "hono";

import type { AgentWalletStore, SpendCaps } from "./registry";
import type { SpendEntry, SpendKind, SpendLedger } from "./ledger";
import type { ApprovalStore } from "./approvals";

export interface SpendEnforcerDeps {
  ledger: SpendLedger;
  registry: AgentWalletStore;
  /** AGENT_WALLET_REQUIRE_REGISTERED — deny unregistered wallets. */
  requireRegistered: boolean;
  /** AGENT_WALLET_DEFAULT_CAPS — applied when record has no envelope. */
  defaultCaps?: SpendCaps;
  /** SLICE-176-7: parked-intent store for the approval hold-path;
   *  absent → approvalAboveUsd is inert (feature-off pass-through). */
  approvals?: ApprovalStore;
  /** APPROVAL_TTL_MS — parked intent expiry (default 1h, D-176-2). */
  approvalTtlMs?: number;
}

export interface EnforceBegin {
  /** Set when a reservation was made (caps applied). */
  entry?: SpendEntry;
  /** Resolved wallet — for post-settle accounting even without caps. */
  wallet?: `0x${string}`;
  /** SLICE-155-11: venue of the wallet record (typed col on settled rows). */
  venueId?: string;
  /** EPIC-263-1: MMF v0.5 §5 caller-visible fields — present ONLY when
   *  the spend was actually clamped; entry.amountUsd is effective. */
  clamped?: boolean;
  requestedAmountUsd?: number;
  effectiveCapUsd?: number;
}

export interface SpendEnforcer {
  /** Returns Response (402 spend_cap) when denied — return it directly. */
  begin(
    c: Context,
    amountUsd: number,
    kind: SpendKind,
    refId: string,
  ): Promise<Response | EnforceBegin>;
  /** Post-execution transition; also records settled spend when no
   *  reservation existed (no caps configured — ledger completeness).
   *  Async since SLICE-155-11 — ledger writes must be awaited (fail-closed). */
  complete(
    begun: EnforceBegin,
    ok: boolean,
    amountUsd?: number,
    kind?: SpendKind,
    refId?: string,
    txHash?: string,
    sourceChain?: string,
  ): Promise<void>;
}
