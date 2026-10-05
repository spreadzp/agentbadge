// SLICE-155-2: spend enforcer — the call-site layer over envelope.ts.
// One pattern for every payment entry we control:
//
//   enforcer.begin(c, amountUsd, kind, refId) → EnforceBegin | Response(402)
//   ...payment execution (x402 settle / subscription / pass mint)...
//   enforcer.complete(begun, ok, amountUsd, kind, refId, txHash)
//
// or the middleware form `spendEnvelopeGate({kind, amountUsdFor, refIdFor})`
// (reserve → next() → settle/release by response status), and
// `withEnvelope(...)` for non-middleware call sites.
//
// Wallet identity: agentWallet ctx (verified wallet-sig) → X-Wallet
// header → PAYMENT-SIGNATURE authorization.from (x402 EIP-3009 payer).
// Envelope is a SELF-IMPOSED guardrail — self-declared X-Wallet is
// acceptable for capping (you can only throttle yourself); verified
// agentWallet ctx is preferred when present.
// Unregistered wallets pass opt-in unless requireRegistered (env
// AGENT_WALLET_REQUIRE_REGISTERED=1).

import type { Context } from "hono";
import { isAddress } from "viem";

import { errorResponse } from "../error-response";
import { ErrorCodes } from "../error-codes";
import type { AgentWalletStore, SpendCaps } from "./registry";
import { newSpendId, type SpendEntry, type SpendKind, type SpendLedger } from "./ledger";
import { checkEnvelope, insertReserved } from "./envelope";
import {
  emitSpendDeny,
  emitKindDeny,
  emitSuspendedDeny,
  tryApprovalHold,
} from "./deny";
import { emitSpendAlert } from "./audit";
import {
  DEFAULT_APPROVAL_TTL_MS,
  type ApprovalStore,
} from "./approvals";

/* ------------------------------ wallet resolve ---------------------------- */

// Wallet resolution moved to wallet-resolve.ts (300-line guard) —
// re-exported for existing import sites.
export { resolveSpendWallet } from "./wallet-resolve";
import { resolveSpendWallet } from "./wallet-resolve";

/* ------------------------------- enforcer --------------------------------- */

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

export function createSpendEnforcer(deps: SpendEnforcerDeps): SpendEnforcer {
  return {
    async begin(c, amountUsd, kind, refId) {
      const wallet = resolveSpendWallet(c);
      if (!wallet || !isAddress(wallet)) {
        if (deps.requireRegistered) {
          return errorResponse(
            c,
            402,
            ErrorCodes.PAYMENT_REQUIRED,
            "spend envelope requires a registered agent wallet",
          );
        }
        return {};
      }
      const rec = await deps.registry.get(wallet);
      if (!rec || !rec.active) {
        if (deps.requireRegistered) {
          return errorResponse(
            c,
            402,
            ErrorCodes.PAYMENT_REQUIRED,
            "wallet not registered — POST /api/wallets first",
          );
        }
        return { wallet: wallet as `0x${string}` };
      }
      // SLICE-176-4: kill-switch — suspended is the FIRST branch (order:
      // suspended → kind → permit → caps → approval-hold → reserve);
      // resume (store.setSuspended false) restores instantly.
      if (rec.suspended) {
        const body = await emitSuspendedDeny(deps.ledger, {
          wallet: wallet as `0x${string}`,
          address: rec.address,
          ...(rec.venueId ? { venueId: rec.venueId } : {}),
          amountUsd,
          kind,
          refId,
        });
        return c.json(body, 402);
      }
      const caps =
        Object.keys(rec.envelope).length > 0 ? rec.envelope : deps.defaultCaps;
      if (!caps) {
        return { wallet: wallet as `0x${string}`, ...(rec.venueId ? { venueId: rec.venueId } : {}) };
      }
      // SLICE-176-3: kind gate — cheapest of the cap branches.
      if (caps.allowedKinds && !caps.allowedKinds.includes(kind)) {
        const body = await emitKindDeny(
          deps.ledger,
          {
            wallet: wallet as `0x${string}`,
            address: rec.address,
            ...(rec.venueId ? { venueId: rec.venueId } : {}),
            amountUsd,
            kind,
            refId,
          },
          caps.allowedKinds,
        );
        return c.json(body, 402);
      }
      // SLICE-176-8: permit lookup — approved (wallet,amountUsd,kind,
      // refId) match → atomic consume → платёж идёт нормально минуя
      // hold-ветку. Consume-race: проигравший идёт обычным путём.
      let consumedApproval: string | null = null;
      if (deps.approvals) {
        const approved = await deps.approvals.listByWallet(wallet, "approved");
        const match = approved.find(
          (a) =>
            a.amountUsd === amountUsd &&
            a.kind === kind &&
            a.refId === refId,
        );
        if (match && (await deps.approvals.consume(match.id))) {
          consumedApproval = match.id;
        }
      }
      const verdict = await checkEnvelope(
        deps.ledger,
        caps,
        wallet,
        amountUsd,
      );
      if (!verdict.allow) {
        // SLICE-176-2: deny side-effects (durable entry + alert + body)
        // live in deny.ts — one place for every envelope deny.
        const body = await emitSpendDeny(deps.ledger, verdict.deny, {
          wallet: wallet as `0x${string}`,
          address: rec.address,
          ...(rec.venueId ? { venueId: rec.venueId } : {}),
          amountUsd,
          kind,
          refId,
        });
        return c.json(body, 402);
      }
      // SLICE-176-7: approval hold — amount > approvalAboveUsd parks a
      // pending intent instead of reserving (pending не ест кап, D-176-7).
      // Order per spec: suspended → kind → caps → hold → reserve.
      // 176-8: consumed permit одноразово обходит hold — дальше reserve.
      if (
        !consumedApproval &&
        deps.approvals &&
        caps.approvalAboveUsd !== undefined &&
        amountUsd > caps.approvalAboveUsd
      ) {
        const body = await tryApprovalHold(
          deps.approvals,
          {
            wallet: wallet as `0x${string}`,
            address: rec.address,
            ...(rec.venueId ? { venueId: rec.venueId } : {}),
            amountUsd,
            kind,
            refId,
          },
          deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS,
        );
        return c.json(body, 402);
      }
      const entry = await insertReserved(
        deps.ledger,
        wallet as `0x${string}`,
        amountUsd,
        kind,
        refId,
        rec.venueId,
      );
      // 176-8: emit only once the entry exists — alert links permit↔spendId.
      if (consumedApproval) {
        emitSpendAlert(
          "approval.consumed",
          rec.address,
          {
            approvalId: consumedApproval,
            spendId: entry.id,
            amountUsd,
            kind,
            refId,
          },
          rec.venueId,
        );
      }
      return { wallet: wallet as `0x${string}`, entry };
    },

    async complete(begun, ok, amountUsd, kind, refId, txHash, sourceChain) {
      if (begun.entry) {
        await deps.ledger.transition(
          begun.entry.id,
          ok ? "settled" : "released",
          txHash,
          sourceChain,
        );
        // SLICE-155-6: settle tx failed after reserve — alertable.
        if (!ok && begun.wallet) {
          emitSpendAlert(
            "spend.failed",
            begun.wallet,
            { entryId: begun.entry.id, amountUsd, kind, refId },
          );
        }
        return;
      }
      // No reservation (no caps) — still record settled spend so the
      // ledger reflects every platform payment.
      if (ok && begun.wallet && amountUsd !== undefined && kind && refId) {
        await deps.ledger.insert({
          id: newSpendId(),
          wallet: begun.wallet,
          amountUsd,
          kind,
          refId,
          state: "settled",
          at: Date.now(),
          ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
          ...(sourceChain ? { sourceChain } : {}),
          ...(begun.venueId ? { venueId: begun.venueId } : {}),
        });
      }
    },
  };
}

/* ------------------------- module singleton + gate ------------------------ */

let _enforcer: SpendEnforcer | null = null;

/** Called by wiring when AGENT_WALLET_ENABLED — off = gates pass-through. */
export function initSpendEnforcer(e: SpendEnforcer | null): void {
  _enforcer = e;
}
export function getSpendEnforcer(): SpendEnforcer | null {
  return _enforcer;
}

// Gate middleware + withEnvelope live in envelope-gate.ts
// (300-line guard) — re-exported so enforcer.ts stays the surface.
export {
  spendEnvelopeGate,
  withEnvelope,
  type EnvelopeGateOpts,
} from "./envelope-gate";
