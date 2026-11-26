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
import { checkEnvelope, insertReserved } from "./envelope";
import {
  emitSpendDeny,
  emitKindDeny,
  emitSuspendedDeny,
  emitInvalidAmountDeny,
  tryApprovalHold,
} from "./deny";
import { emitSpendAlert } from "./audit";
import { DEFAULT_APPROVAL_TTL_MS } from "./approvals";
import { createCompleter } from "./enforcer-complete";
import type {
  EnforceBegin,
  SpendEnforcer,
  SpendEnforcerDeps,
} from "./enforcer-types";

/* ------------------------------ wallet resolve ---------------------------- */

// Wallet resolution moved to wallet-resolve.ts (300-line guard) —
// re-exported for existing import sites.
export { resolveSpendWallet } from "./wallet-resolve";
import { resolveSpendWallet } from "./wallet-resolve";

/* ------------------------------- enforcer --------------------------------- */

// Contract types live in enforcer-types.ts (300-line guard) —
// re-exported so enforcer.ts stays the single import surface.
export type {
  EnforceBegin,
  SpendEnforcer,
  SpendEnforcerDeps,
} from "./enforcer-types";

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
      // EPIC-263-1: amount-validity gate — draft §4 NON_POSITIVE before
      // ANY caps check (K08); !finite|≤0 → structured deny, durable
      // entry. Closes the V04/V17/V29/V33 class on this path.
      if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
        const body = await emitInvalidAmountDeny(deps.ledger, {
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
            // 257-4: amount-holds are fingerprint-free; reason still
            // distinguishes them from counterparty holds in alert/UI.
            approvalReason: "amount_threshold",
          },
          deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS,
        );
        return c.json(body, 402);
      }
      // D6: the ONLY amount that may be reserved is verdict.amount
      // (effective after clamp resolution) — begin never re-derives it
      // (D7: entry.amountUsd === verdict.amount, no arithmetic).
      const entry = await insertReserved(
        deps.ledger,
        wallet as `0x${string}`,
        verdict.amount,
        kind,
        refId,
        rec.venueId,
        verdict.clamped,
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
      return {
        wallet: wallet as `0x${string}`,
        entry,
        ...(verdict.clamped
          ? {
              clamped: true,
              requestedAmountUsd: verdict.clamped.requested,
              effectiveCapUsd: verdict.clamped.cap,
            }
          : {}),
      };
    },

    // 263-1: settlement side lives in enforcer-complete.ts (300-line
    // guard) — transition + clamp consistency-guard + no-caps insert.
    complete: createCompleter(deps),
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

/**
 * EPIC-263-1: caller-visible clamp (draft §5 MUST) — appends
 * X-Spend-Clamped/-Effective-Usd/-Requested-Usd onto the FINAL
 * response. `c.header` either mutates an existing c.res (post-next())
 * or lands in preparedHeaders merged into the next response — in both
 * cases downstream headers/status are preserved (D8). Emitted only on
 * an actual clamp — never `X-Spend-Clamped:false` on ordinary spends.
 */
export function applyClampHeaders(c: Context, begun: EnforceBegin): void {
  if (begun.clamped !== true || !begun.entry) return;
  c.header("X-Spend-Clamped", "true");
  c.header("X-Spend-Effective-Usd", String(begun.entry.amountUsd));
  c.header("X-Spend-Requested-Usd", String(begun.requestedAmountUsd));
}

// Gate middleware + withEnvelope live in envelope-gate.ts
// (300-line guard) — re-exported so enforcer.ts stays the surface.
export {
  spendEnvelopeGate,
  withEnvelope,
  type EnvelopeGateOpts,
} from "./envelope-gate";
