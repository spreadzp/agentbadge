// SLICE-257-5: counterparty trust gate for buyPay — AFTER envelope
// checks / amount-hold, BEFORE reserve/spawn/signing.
//
// Offer selection lives in ./offer-selection (SLICE-257-13, arc-audit
// C-1/C-2): the whole signable set must normalize to one deal or the
// gate denies `unverifiable_challenge` before any vet402 call.
//
// Mode (D-257-Q3): off → skip; shadow → evaluate+record+pass;
// enforce → apply. Prod sets COUNTERPARTY_CHECK_MODE=enforce; dev/test
// default is off so suites that never inject a checker keep working.
// C5: every decision is recorded in our ops log (sanitized host only).

import { logger } from "@agentbadge/passport/logger";
import {
  DEAL_FINGERPRINT_VERSION,
  matchTerms,
  Vet402Client,
  vet402ClientOptionsFromEnv,
  type CounterpartyChecker,
  type CounterpartyCheckMode,
  type TermsMatch,
  type Vet402Assessment,
} from "@agentbadge/circle-payments";
import type { ApprovalMeta, ApprovalStore } from "../agent-wallet/approvals";
import { tryApprovalHold, type SpendDenyCtx } from "../agent-wallet/deny";
import type { SpendLedger } from "../agent-wallet/ledger";
import type { BuyQuote } from "./gateway";
import {
  assessmentView,
  boundTermsMatch,
  denyOutcome,
} from "./counterparty-outcomes";
import type { DealBinding } from "./offer-selection";

export {
  bindDeal,
  selectSigningOffer,
  type DealBinding,
  type OfferSelectionError,
} from "./offer-selection";
export { counterpartyPermitRecheck } from "./counterparty-outcomes";

/** COUNTERPARTY_CHECK_MODE — prod default enforce (D-257-Q3).
 * M-1: NODE_ENV unset/unrecognized defaults to ENFORCE (fail-closed —
 * a prod container without NODE_ENV must never silently run open);
 * explicit dev/test values still default to off. */
const DEV_ENVS = new Set(["development", "dev", "test"]);
export function counterpartyModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): CounterpartyCheckMode {
  const v = env.COUNTERPARTY_CHECK_MODE;
  if (v === "off" || v === "shadow" || v === "enforce") return v;
  if (env.NODE_ENV === "production") return "enforce";
  return DEV_ENVS.has(env.NODE_ENV ?? "") ? "off" : "enforce";
}

// M-1: the env-derived default is resolved ONCE (boot), not re-read
// per request — and it is loud: off/shadow under NODE_ENV=production
// or an unrecognized NODE_ENV gets a boot-level warn.
let _modeOnce: CounterpartyCheckMode | undefined;
export function counterpartyModeDefault(): CounterpartyCheckMode {
  if (_modeOnce !== undefined) return _modeOnce;
  const v = process.env.COUNTERPARTY_CHECK_MODE;
  const ne = process.env.NODE_ENV;
  _modeOnce = counterpartyModeFromEnv();
  if ((v === "off" || v === "shadow") && ne === "production") {
    logger.warn("counterparty-gate: counterparty checks disabled in production", {
      mode: v,
      nodeEnv: ne,
    });
  } else if (v === undefined && ne !== "production" && !DEV_ENVS.has(ne ?? "")) {
    logger.warn("counterparty-gate: NODE_ENV unset/unrecognized — defaulting to enforce (fail-closed)", {
      nodeEnv: ne ?? "unset",
    });
  }
  return _modeOnce;
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

  // C-1: a challenge whose signable set is not uniform can never be
  // proven — checked A, signed B. Deny WITHOUT an assessment: the
  // shape itself is hostile, owner approval cannot fix it, and a
  // vet402 call would spend quota for nothing.
  const selectionUnverifiable =
    deal.offerError === "unverifiable_challenge" ||
    deal.offerError === "ambiguous_offers";

  const assessment: Vet402Assessment | null = selectionUnverifiable
    ? null
    : deps.checker
      ? await deps.checker.check({ resourceUrl: quote.url, wallet: ctx.wallet })
      : {
          kind: "unavailable",
          failure: "network_error",
          checkedAt: new Date().toISOString(),
          cacheHit: false,
        };
  const verified =
    assessment?.kind === "verdict" ? assessment.verifiedTerms : null;
  const termsMatch: TermsMatch = deal.offer
    ? matchTerms(verified, deal.offer)
    : { result: "uncomparable", reason: `offer: ${deal.offerError}` };
  const decision = selectionUnverifiable
    ? { action: "deny" as const, reasonCode: deal.offerError as string }
    : deps.policy.evaluate({ assessment: assessment!, termsMatch });

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
    assessment: assessment
      ? assessmentView(assessment)
      : { kind: "not_checked" },
    termsMatch: boundTermsMatch(termsMatch),
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
    // 257-14 (H-2): a hold without a deal fingerprint is an approval
    // placebo — the parked intent could never bind to (or be consumed
    // for) this deal, so it only bloats the queue. Deny instead.
    if (!deal.fingerprint) {
      return {
        action: "deny",
        deny: await denyOutcome(
          deps,
          ctx,
          deal,
          decision.reasonCode,
          assessment,
          termsMatch,
          "counterparty_unapprovable",
        ),
      };
    }
    // hold ⇒ assessment ran (unverifiable selections deny above).
    const a = assessment!;
    const meta: ApprovalMeta = {
      ...(a.kind === "verdict"
        ? {
            verdict: a.verdict,
            reasonCodes: [...a.reasonCodes, decision.reasonCode],
            ...(a.evidenceAgeSeconds !== undefined
              ? { evidenceAgeSeconds: a.evidenceAgeSeconds }
              : {}),
          }
        : { verdict: a.kind, reasonCodes: [decision.reasonCode] }),
      ...(termsMatch.result === "mismatch"
        ? { termsDiff: boundTermsMatch(termsMatch).diff }
        : {}),
      checkedAt: a.checkedAt,
    };
    const deny = await tryApprovalHold(
      deps.approvals,
      {
        ...ctx,
        approvalReason: decision.holdHint as SpendDenyCtx["approvalReason"],
        dealFingerprint: deal.fingerprint,
        fingerprintVersion: deal.fingerprint
          ? DEAL_FINGERPRINT_VERSION
          : undefined,
        meta,
      },
      deps.approvalTtlMs,
    );
    return { action: "hold", deny };
  }

  // deny | unavailable — durable denied entry + alert + body.
  return {
    action: "deny",
    deny: await denyOutcome(
      deps,
      ctx,
      deal,
      decision.reasonCode,
      assessment,
      termsMatch,
      undefined,
      decision.action === "unavailable",
    ),
  };
}
