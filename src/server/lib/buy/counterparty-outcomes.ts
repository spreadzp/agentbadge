// SLICE-257-14 (arc-audit H-3): durable gate outcomes — the denied
// ledger write + alert + wire body shared by the gate's deny paths
// and the consume-time permit re-check.

import { logger } from "@agentbadge/passport/logger";
import type { TermsMatch, Vet402Assessment } from "@agentbadge/circle-payments";
import { emitSpendAlert } from "../agent-wallet/audit";
import type { SpendDenyCtx } from "../agent-wallet/deny";
import { newSpendId } from "../agent-wallet/ledger";
import type {
  CounterpartyGateDeps,
  CounterpartyGateResult,
} from "./counterparty-gate";
import type { DealBinding } from "./offer-selection";

/** Assessment summary for the C5 record — sanitized, no secrets. */
export function assessmentView(
  a: Vet402Assessment,
): Record<string, unknown> {
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
 * Durable deny — denied ledger entry + counterparty.denied alert +
 * deny body (emitSpendDeny convention, fail-closed: write fails →
 * request fails). `unavailable` outcomes are retryable PREFLIGHT
 * refusals: retry = a fresh buyPay preflight, never a money-retry
 * through this mechanism (C1).
 */
export async function denyOutcome(
  deps: CounterpartyGateDeps,
  ctx: SpendDenyCtx,
  deal: DealBinding,
  reasonCode: string,
  assessment: Vet402Assessment | null,
  termsMatch: TermsMatch,
  errorOverride?: string,
  retryable = false,
): Promise<Record<string, unknown>> {
  await deps.ledger.insert({
    id: newSpendId(),
    wallet: ctx.wallet,
    amountUsd: ctx.amountUsd,
    kind: ctx.kind,
    refId: ctx.refId,
    state: "denied",
    denialReason: reasonCode,
    at: Date.now(),
    ...(ctx.venueId ? { venueId: ctx.venueId } : {}),
  });
  const view = assessment
    ? assessmentView(assessment)
    : { kind: "not_checked" };
  emitSpendAlert(
    "counterparty.denied",
    ctx.address,
    {
      reasonCode,
      assessment: view,
      amountUsd: ctx.amountUsd,
      kind: ctx.kind,
      refId: ctx.refId,
      ...(deal.fingerprint ? { dealFingerprint: deal.fingerprint } : {}),
    },
    ctx.venueId,
  );
  return {
    error: errorOverride ?? reasonCode,
    reasonCode,
    counterparty: view,
    termsMatch: termsMatch.result,
    ...(retryable ? { retryable: true } : {}),
    ...(deal.fingerprint ? { dealFingerprint: deal.fingerprint } : {}),
  };
}

/**
 * 257-14 (H-3): a fingerprint-bound owner permit skips the HOLD —
 * never the check. Before consuming, re-run a cheap fresh assessment
 * (the client's decision-cache makes this a TTL-hit in the common
 * case): a seller that flipped to BLOCK after the owner approved
 * denies even with a live permit. vet402 unavailable here does NOT
 * block — the permit is honestly consumed (logged), matching the
 * policy matrix for unmeasurable counterparties post-approval.
 */
export async function counterpartyPermitRecheck(
  deps: CounterpartyGateDeps,
  ctx: SpendDenyCtx,
  deal: DealBinding,
  url: string,
): Promise<CounterpartyGateResult> {
  const assessment: Vet402Assessment | null = deps.checker
    ? await deps.checker.check({ resourceUrl: url }).catch(() => null)
    : null;
  const blocked =
    assessment?.kind === "verdict" && assessment.verdict === "BLOCK";
  logger.info("counterparty permit re-check", {
    mode: deps.mode,
    wallet: ctx.wallet,
    blocked,
    assessment: assessment
      ? assessmentView(assessment)
      : { kind: "not_checked" },
    ...(deal.fingerprint ? { dealFingerprint: deal.fingerprint } : {}),
  });
  if (!blocked) return { action: "pass" };
  return {
    action: "deny",
    deny: await denyOutcome(
      deps,
      ctx,
      deal,
      "counterparty_blocked",
      assessment,
      { result: "match" },
    ),
  };
}
