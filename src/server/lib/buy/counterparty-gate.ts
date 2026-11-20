// SLICE-257-5: counterparty trust gate for buyPay — AFTER envelope
// checks / amount-hold, BEFORE reserve/spawn/signing.
//
// Offer selection (D-257-Q8): the accepts[] entry whose amount equals
// quote.maxAmountAtomic is what --max-amount constrains the CLI to
// sign — NOT accepts[0], NOT all entries. Fingerprint + terms-match
// bind THAT offer only (C2: match per payment).
//
// Mode (D-257-Q3): off → skip; shadow → evaluate+record+pass;
// enforce → apply. Prod sets COUNTERPARTY_CHECK_MODE=enforce; dev/test
// default is off so suites that never inject a checker keep working.
// C5: every decision is recorded in our ops log (sanitized host only).

import { logger } from "@agentbadge/passport/logger";
import {
  dealFingerprint,
  matchTerms,
  offeredTermsFromRequirements,
  Vet402Client,
  vet402ClientOptionsFromEnv,
  type CounterpartyChecker,
  type CounterpartyCheckMode,
  type OfferedTerms,
  type TermsMatch,
  type Vet402Assessment,
} from "@agentbadge/circle-payments";
import type { ApprovalMeta, ApprovalStore } from "../agent-wallet/approvals";
import { emitSpendAlert } from "../agent-wallet/audit";
import { tryApprovalHold, type SpendDenyCtx } from "../agent-wallet/deny";
import { newSpendId, type SpendLedger } from "../agent-wallet/ledger";
import type { BuyQuote } from "./gateway";

/** What the deal-binding step derived from the quote's raw challenge. */
export interface DealBinding {
  /** The accepts entry the payment will sign (when unambiguous). */
  offer?: OfferedTerms;
  /** sha256:v1 fingerprint over wallet+url+offer — the permit key. */
  fingerprint?: string;
  /** Why no binding could be derived (unselectable challenge). */
  offerError?: string;
}

export type OfferSelectionError =
  | "no_matching_offer"
  | "ambiguous_offers"
  | "uncomparable_offer";

/**
 * Pick THE signing offer: accepts[] entries whose amount equals
 * maxAmountAtomic. Exactly one → it; zero → no_matching_offer; more →
 * ambiguous_offers (refuse to guess which the CLI would sign). A v1
 * flat challenge (no accepts[]) falls back to top-level fields.
 */
export function selectSigningOffer(
  raw: unknown,
  maxAmountAtomic: string,
): { ok: true; offer: OfferedTerms } | { ok: false; error: OfferSelectionError } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const want = BigInt(maxAmountAtomic);
  const hits: OfferedTerms[] = [];
  const candidates: unknown[] = Array.isArray(r.accepts) ? r.accepts : [r];
  for (const e of candidates) {
    let t: OfferedTerms;
    try {
      t = offeredTermsFromRequirements(e as never);
    } catch {
      continue; // malformed/uncomparable entry — not a candidate
    }
    if (BigInt(t.amount) === want) hits.push(t);
  }
  if (hits.length === 1) return { ok: true, offer: hits[0] };
  if (hits.length > 1) return { ok: false, error: "ambiguous_offers" };
  return { ok: false, error: "no_matching_offer" };
}

/**
 * Derive the deal binding for this quote+wallet — offer + fingerprint.
 * Fingerprint failure (unknown network, bad address) yields offer-only:
 * terms-match still runs, the hold just parks without a fingerprint.
 */
export function bindDeal(quote: BuyQuote, wallet: string): DealBinding {
  const sel = selectSigningOffer(quote.raw, quote.maxAmountAtomic);
  if (!sel.ok) return { offerError: sel.error };
  try {
    return {
      offer: sel.offer,
      fingerprint: dealFingerprint({
        wallet,
        url: quote.url,
        offer: sel.offer,
      }),
    };
  } catch (e) {
    return {
      offer: sel.offer,
      offerError: `fingerprint: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** COUNTERPARTY_CHECK_MODE — prod default enforce (D-257-Q3). */
export function counterpartyModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): CounterpartyCheckMode {
  const v = env.COUNTERPARTY_CHECK_MODE;
  if (v === "off" || v === "shadow" || v === "enforce") return v;
  return env.NODE_ENV === "production" ? "enforce" : "off";
}

let _checker: CounterpartyChecker | null = null;

/** Env-built Vet402Client singleton (COUNTERPARTY_VET402_BASE_URL +
 * TTL/RPM knobs via vet402ClientOptionsFromEnv). */
export function getCounterpartyChecker(): CounterpartyChecker {
  if (!_checker) {
    _checker = new Vet402Client({
      ...(process.env.COUNTERPARTY_VET402_BASE_URL
        ? { baseUrl: process.env.COUNTERPARTY_VET402_BASE_URL }
        : {}),
      ...vet402ClientOptionsFromEnv(process.env),
    });
  }
  return _checker;
}

/** Test/wiring seam — replaces the singleton. */
export function setCounterpartyChecker(
  checker: CounterpartyChecker | null,
): void {
  _checker = checker;
}

export interface CounterpartyGateDeps {
  /** Facts source — undefined in enforce = unavailable (fail-closed). */
  checker?: CounterpartyChecker;
  policy: {
    evaluate(input: {
      assessment: Vet402Assessment;
      termsMatch: TermsMatch;
    }): { action: string; reasonCode: string; holdHint?: string };
  };
  ledger: SpendLedger;
  approvals?: ApprovalStore;
  approvalTtlMs: number;
  mode: CounterpartyCheckMode;
}

export type CounterpartyGateResult =
  | { action: "pass" }
  | { action: "deny" | "hold"; deny: Record<string, unknown> };

/** Assessment summary for the C5 record — sanitized, no secrets. */
function assessmentView(a: Vet402Assessment): Record<string, unknown> {
  const base = { kind: a.kind, checkedAt: a.checkedAt, cacheHit: a.cacheHit };
  if (a.kind === "verdict") {
    return {
      ...base,
      verdict: a.verdict,
      reasonCodes: a.reasonCodes,
      ...(a.evidenceAgeSeconds !== undefined
        ? { evidenceAgeSeconds: a.evidenceAgeSeconds }
        : {}),
      ...(a.degraded !== undefined ? { degraded: a.degraded } : {}),
    };
  }
  if (a.kind === "unavailable") return { ...base, failure: a.failure };
  return a.kind === "privacy_unmeasurable" && a.sanitizeBlock
    ? { ...base, sanitizeBlock: a.sanitizeBlock }
    : base;
}

/**
 * The gate itself. deny/unavailable → durable denied ledger entry +
 * alert + deny body (pre-settlement refusal — never "uncertain",
 * retried only as a fresh preflight). hold → park a fingerprint-bound
 * owner approval and answer approval_required.
 */
export async function counterpartyGate(
  deps: CounterpartyGateDeps,
  ctx: SpendDenyCtx,
  quote: BuyQuote,
  deal: DealBinding,
): Promise<CounterpartyGateResult> {
  if (deps.mode === "off") return { action: "pass" };

  const assessment: Vet402Assessment = deps.checker
    ? await deps.checker.check({ resourceUrl: quote.url })
    : {
        kind: "unavailable",
        failure: "network_error",
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      };
  const verified =
    assessment.kind === "verdict" ? assessment.verifiedTerms : null;
  const termsMatch: TermsMatch = deal.offer
    ? matchTerms(verified, deal.offer)
    : { result: "uncomparable", reason: `offer: ${deal.offerError}` };
  const decision = deps.policy.evaluate({ assessment, termsMatch });

  // C5: self-record every decision (shadow included) — sanitized view.
  let host = "unparseable";
  try {
    host = new URL(quote.url).host;
  } catch {
    /* malformed URL — never echoes it */
  }
  logger.info("counterparty check", {
    mode: deps.mode,
    wallet: ctx.wallet,
    host,
    assessment: assessmentView(assessment),
    termsMatch,
    decision,
    ...(deal.fingerprint ? { dealFingerprint: deal.fingerprint } : {}),
  });

  if (deps.mode === "shadow" || decision.action === "allow") {
    return { action: "pass" };
  }

  if (decision.action === "hold") {
    if (!deps.approvals) {
      // No approval store — a hold has nowhere to park; deny instead
      // (fail-closed, still never "uncertain").
      const deny = { error: "counterparty_hold_no_store", reasonCode: decision.reasonCode };
      return { action: "deny", deny };
    }
    const meta: ApprovalMeta = {
      ...(assessment.kind === "verdict"
        ? {
            verdict: assessment.verdict,
            reasonCodes: [
              ...assessment.reasonCodes,
              decision.reasonCode,
            ],
            ...(assessment.evidenceAgeSeconds !== undefined
              ? { evidenceAgeSeconds: assessment.evidenceAgeSeconds }
              : {}),
          }
        : { verdict: assessment.kind, reasonCodes: [decision.reasonCode] }),
      ...(termsMatch.result === "mismatch"
        ? { termsDiff: termsMatch.diff }
        : {}),
      checkedAt: assessment.checkedAt,
    };
    const deny = await tryApprovalHold(
      deps.approvals,
      {
        ...ctx,
        approvalReason: decision.holdHint as SpendDenyCtx["approvalReason"],
        dealFingerprint: deal.fingerprint,
        fingerprintVersion: deal.fingerprint ? 1 : undefined,
        meta,
      },
      deps.approvalTtlMs,
    );
    return { action: "hold", deny };
  }

  // deny | unavailable — durable denied entry + alert + body
  // (emitSpendDeny convention, fail-closed). counterparty_unavailable
  // is a retryable PREFLIGHT refusal: retry = a fresh buyPay preflight,
  // never a money-retry through this mechanism (C1).
  await deps.ledger.insert({
    id: newSpendId(),
    wallet: ctx.wallet,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    refId: ctx.refId,
    state: "denied",
    denialReason: decision.reasonCode,
    at: Date.now(),
    ...(ctx.venueId ? { venueId: ctx.venueId } : {}),
  });
  emitSpendAlert(
    "counterparty.denied",
    ctx.address,
    {
      reasonCode: decision.reasonCode,
      assessment: assessmentView(assessment),
      amountUsd: ctx.amountUsd,
      kind: ctx.kind,
      refId: ctx.refId,
      ...(deal.fingerprint ? { dealFingerprint: deal.fingerprint } : {}),
    },
    ctx.venueId,
  );
  return {
    action: "deny",
    deny: {
      error: decision.reasonCode,
      counterparty: assessmentView(assessment),
      termsMatch: termsMatch.result,
      ...(decision.action === "unavailable" ? { retryable: true } : {}),
      ...(deal.fingerprint ? { dealFingerprint: deal.fingerprint } : {}),
    },
  };
}
