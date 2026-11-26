/**
 * EPIC-263-3: draft v0.5-clamp corpus runners (pin a91b7f4).
 *
 * K-track  (clamp-core.json, 16 vectors): lifecycle step-grammar run
 *   through the REAL createSpendEnforcer.begin via runLifecycleVector
 *   (D-263-Q4 — never emulated), then re-classified: a step whose
 *   decisive mechanism prod doesn't have reports NOT_MAPPABLE, not
 *   DIVERGENCE (D-263-Q5):
 *     - replayed:true            → no stored decision-store
 *     - check ∉ OUR_CHECKS       → PAYEE/CURRENCY/EXPIRED/TX_CONFLICT/…
 *     - BUDGET + unwindowed      → draft total_budget carries no
 *       budget_window_days → no windowed cap exists to charge
 *     - claim/unknown steps      → "unmapped" inside the runner already
 *   Everything else mismatched stays DIVERGENCE-MODEL (honest delta).
 *
 * KD-track (clamp-delegation.json, 5 vectors): the REAL
 *   spendAsDelegate via runDelegationVector({clampTrack:true}) —
 *   bounds.clamp reaches validateDelegateInput, clamp verdict-fields
 *   compare per step, BUDGET-on-delegate-path → unmapped (KD05's
 *   ancestor-budget dimension has no prod mechanism).
 */
import { runLifecycleVector } from "./lifecycle-harness";
import { runDelegationVector } from "./delegation-harness";
import { CAPS_TO_WINDOW } from "./adapter";
import { OUR_CHECKS } from "./classify";
import {
  DRAFT_CORPUS_VERSION,
  type VectorResult,
} from "./result";
import type {
  ClampCoreVector,
  DelegationVector,
} from "./mmf-types";

const PROD_PATH = "createSpendEnforcer.begin+settleEntry/releaseEntry";

interface StepRow {
  kind?: string;
  verdict?: string;
  expected?: Record<string, unknown>;
}

/** Why a mismatching step's decisive check is unmappable — null when
 *  the step is a REAL model delta (keeps DIVERGENCE-MODEL honest). */
function unmappableCause(
  step: StepRow,
  budgetUnwindowed: boolean,
): string | null {
  const exp = step.expected ?? {};
  if (exp.replayed === true) {
    return "stored-decision replay — no decision-store in prod (tx_id is correlation-only)";
  }
  const check = exp.check;
  if (typeof check === "string" && !OUR_CHECKS.has(check)) {
    return `check ${check} has no prod mechanism`;
  }
  if (check === "BUDGET" && budgetUnwindowed) {
    return "draft total_budget carries no budget_window_days — unwindowed budget has no prod mechanism";
  }
  return null;
}

/** K-track: lifecycle runner + draft identity + NOT_MAPPABLE rules. */
export async function runClampCoreVector(
  v: ClampCoreVector,
  corpusSha256: string,
): Promise<VectorResult> {
  const r = await runLifecycleVector(
    v as unknown as Parameters<typeof runLifecycleVector>[0],
    corpusSha256,
  );
  r.track = "clamp";
  r.corpus_version = DRAFT_CORPUS_VERSION;
  r.production_path = PROD_PATH;

  // Draft's total_budget is unwindowed (no budget_window_days) — our
  // adapter can only map windowed budgets; say so per-dimension.
  const budgetUnwindowed =
    v.mandate.bounds.total_budget !== undefined &&
    CAPS_TO_WINDOW[
      v.mandate.bounds.budget_window_days as keyof typeof CAPS_TO_WINDOW
    ] === undefined;
  if (budgetUnwindowed) {
    r.dimensions.bounds_total_budget = {
      mapped_to: null,
      equivalence: "None",
      note: "unwindowed total_budget — no prod mechanism (draft bounds carry no budget_window_days)",
    };
    r.equivalence = "None";
  }
  r.dimensions.bounds_clamp = {
    mapped_to: "SpendCaps.clamp (envelope) → checkEnvelope effective verdict",
    equivalence: "Exact",
    note: "263-1 — Shape 2 check=CAP_EXCEEDED on allowed+clamped",
  };

  // Re-classify: every mismatching step explained by an absent
  // mechanism flips DIVERGENCE-MODEL → NOT_MAPPABLE (honest coverage
  // report — a REAL delta stays MODEL).
  if (r.result === "DIVERGENCE-MODEL") {
    const steps = (r.steps ?? []) as StepRow[];
    const mismatches = steps.filter((s) => s.verdict === "mismatch");
    const causes = mismatches.map((s) => unmappableCause(s, budgetUnwindowed));
    if (mismatches.length > 0 && causes.every((c) => c !== null)) {
      r.result = "NOT_MAPPABLE";
      r.notes = [...new Set(causes as string[])].join("; ");
    }
  }
  return r;
}

/** KD-track: REAL spendAsDelegate, leaf-governs clamp, BUDGET→unmapped. */
export async function runClampDelegationVector(
  v: DelegationVector,
  corpusSha256: string,
): Promise<VectorResult> {
  const r = await runDelegationVector(v, corpusSha256, {
    clampTrack: true,
  });
  r.track = "clamp";
  r.corpus_version = DRAFT_CORPUS_VERSION;
  r.dimensions.bounds_clamp = {
    mapped_to: "DelegateRecord.clamp → spendAsDelegate effective-cap verdict",
    equivalence: "Exact",
    note: "263-2 — leaf governs (record is the leaf); kit.spend gets STRICTLY effective",
  };
  return r;
}
