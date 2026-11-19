/**
 * EPIC-227 / SLICE-227-2 — settlement invariants: decimal-string money
 * math, field caps, participant guards, plan/intent sum checks.
 *
 * Decimal helpers come from the FinOps guard module (integer micro-unit
 * BigInt math — floats never touch money). The domain imports finops
 * guards/admin-actions (shared infra) but NEVER commerce (slice rule).
 */

import {
  checkTextField,
  decimalSub,
  decimalToMicro,
  isDecimalString,
  isEvmAddress,
  microToDecimal,
  normalizeOperator,
  sumDecimals,
} from "../finops/guards.js";
import {
  DISPUTE_RESOLUTIONS,
  DISPUTE_SUBJECT_TYPES,
  EXECUTORS,
  LEG_ROLES,
  RELEASE_POLICIES,
  type SettlementResult,
  fail,
} from "./types.js";

export { isEvmAddress, normalizeOperator };

// ---------- field caps ----------

export const MAX_ID_FIELD = 128;
export const MAX_TITLE_FIELD = 256;
/** Contract-guard parity (206): free text ≤4000, refs ≤50 × ≤1000. */
export const MAX_REASON_FIELD = 4000;
export const MAX_EVIDENCE_REFS = 50;
export const MAX_EVIDENCE_REF_LEN = 1000;
export const MAX_MILESTONES_PER_PLAN = 64;
export const MAX_LEGS_PER_INTENT = 32;

// ---------- decimal money ----------

/** Decimal string AND > 0 — plan totals, milestone and leg amounts. */
export function isPositiveAmount(v: unknown): v is string {
  return isDecimalString(v) && !v.startsWith("-") && decimalToMicro(v) > 0n;
}

export function assertAmount(
  v: unknown,
  field: string,
): SettlementResult<never> | null {
  if (!isPositiveAmount(v)) {
    return fail("BAD_INPUT", `${field} must be a positive decimal string`);
  }
  return null;
}

/** Σ decimal strings — throws on malformed entries (money never skips). */
export { decimalSub, decimalToMicro, microToDecimal, sumDecimals };

/** Σ amounts === expected — the plan/intent conservation invariant. */
export function sumsEqual(amounts: readonly string[], expected: string) {
  try {
    return sumDecimals(amounts) === microToDecimal(decimalToMicro(expected));
  } catch {
    return false;
  }
}

// ---------- participants ----------

/** Buyer or provider wallet of the plan — the dispute/plan write guard. */
export function isParticipant(
  wallet: string,
  buyerWallet: string,
  providerWallet: string,
): boolean {
  const w = wallet.toLowerCase();
  return w === buyerWallet.toLowerCase() || w === providerWallet.toLowerCase();
}

// ---------- controlled-vocabulary guards ----------

export function checkEnum<T extends string>(
  v: unknown,
  set: readonly T[],
  field: string,
): SettlementResult<never> | null {
  if (typeof v !== "string" || !set.includes(v as T)) {
    return fail("BAD_INPUT", `${field} must be one of ${set.join("|")}`);
  }
  return null;
}

export const checkReleasePolicy = (v: unknown) =>
  checkEnum(v, RELEASE_POLICIES, "releasePolicy");
export const checkExecutor = (v: unknown) =>
  checkEnum(v, EXECUTORS, "executor");
export const checkLegRole = (v: unknown) =>
  checkEnum(v, LEG_ROLES, "role");
export const checkSubjectType = (v: unknown) =>
  checkEnum(v, DISPUTE_SUBJECT_TYPES, "subjectType");
export const checkResolution = (v: unknown) =>
  checkEnum(v, DISPUTE_RESOLUTIONS, "resolution");

export function checkField(
  v: unknown,
  name: string,
  max: number,
): SettlementResult<never> | null {
  if (typeof v !== "string" || v.trim().length === 0) {
    return fail("BAD_INPUT", `${name} is required`);
  }
  return checkTextField(v, name, max) as SettlementResult<never> | null;
}

/** evidenceRefs ≤50 entries × ≤1000 chars each (contract guards 206). */
export function checkEvidenceRefs(
  refs: unknown,
): SettlementResult<string[]> {
  if (refs === undefined || refs === null)
    return { ok: true, value: [] as string[] };
  if (!Array.isArray(refs) || refs.length > MAX_EVIDENCE_REFS) {
    return fail(
      "BAD_INPUT",
      `evidenceRefs must be an array of ≤${MAX_EVIDENCE_REFS} refs`,
    );
  }
  for (const r of refs) {
    if (typeof r !== "string" || r.length === 0) {
      return fail("BAD_INPUT", "evidenceRefs entries must be strings");
    }
    if (r.length > MAX_EVIDENCE_REF_LEN) {
      return fail(
        "BAD_INPUT",
        `evidenceRefs entries must be ≤${MAX_EVIDENCE_REF_LEN} chars`,
      );
    }
  }
  return { ok: true, value: refs as string[] };
}

// ---------- structural checks (plan create / split resolve) ----------

interface LegShape {
  payee: string;
  amountUsdc: string;
  role: string;
}

interface MilestoneShape {
  milestoneId: string;
  title: string;
  amountUsd: string;
  acceptanceCriteria?: string;
  dueAtMs?: number;
  releasePolicy?: string;
  legs?: LegShape[];
}

/** Leg-template validation — sum must equal the milestone amount (D-227-5). */
export function checkLegTemplate(
  legs: LegShape[],
  milestoneAmount: string,
  label: string,
): SettlementResult<never> | null {
  if (!Array.isArray(legs) || legs.length === 0) {
    return fail("BAD_INPUT", `${label} must be a non-empty array`);
  }
  if (legs.length > MAX_LEGS_PER_INTENT) {
    return fail(
      "BAD_INPUT",
      `${label} must contain ≤${MAX_LEGS_PER_INTENT} legs`,
    );
  }
  const seen = new Set<string>();
  for (const [i, leg] of legs.entries()) {
    // M8: non-object entries reach .payee as TypeError — guard first.
    if (typeof leg !== "object" || leg === null) {
      return fail("BAD_INPUT", `${label}[${i}] must be an object leg`);
    }
    if (!isEvmAddress(leg.payee)) {
      return fail(
        "BAD_INPUT",
        `${label}[${i}].payee must be an EVM address`,
      );
    }
    // M11: a leg paying nobody is unspendable and breaks the sums.
    if (leg.payee.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      return fail("BAD_INPUT", `${label}[${i}].payee is the zero address`);
    }
    const key = `${leg.payee.toLowerCase()}:${leg.role}`;
    if (seen.has(key)) {
      return fail(
        "BAD_INPUT",
        `${label}[${i}] duplicates payee+role of another leg`,
      );
    }
    seen.add(key);
    const amt = assertAmount(leg.amountUsdc, `${label}[${i}].amountUsdc`);
    if (amt) return amt;
    const role = checkLegRole(leg.role);
    if (role) return role;
  }
  if (!sumsEqual(legs.map((l) => l.amountUsdc), milestoneAmount)) {
    return fail(
      "BAD_INPUT",
      `sum(${label}.amountUsdc) must equal the milestone amount`,
    );
  }
  return null;
}

/** Full milestone-array validation for plan create (D-227-3). */
export function checkMilestoneInputs(
  ms: MilestoneShape[],
  totalUsd: string,
): SettlementResult<never> | null {
  if (!Array.isArray(ms) || ms.length === 0) {
    return fail("BAD_INPUT", "milestones must be a non-empty array");
  }
  if (ms.length > MAX_MILESTONES_PER_PLAN) {
    return fail(
      "BAD_INPUT",
      `milestones must contain ≤${MAX_MILESTONES_PER_PLAN} entries`,
    );
  }
  const seen = new Set<string>();
  for (const [i, m] of ms.entries()) {
    const label = `milestones[${i}]`;
    const idCheck = checkField(
      m.milestoneId,
      `${label}.milestoneId`,
      MAX_ID_FIELD,
    );
    if (idCheck) return idCheck;
    if (seen.has(m.milestoneId)) {
      return fail("BAD_INPUT", `${label}.milestoneId duplicates another entry`);
    }
    seen.add(m.milestoneId);
    const t = checkField(m.title, `${label}.title`, MAX_TITLE_FIELD);
    if (t) return t;
    const amt = assertAmount(m.amountUsd, `${label}.amountUsd`);
    if (amt) return amt;
    if (m.acceptanceCriteria !== undefined) {
      const ac = checkTextField(
        m.acceptanceCriteria,
        `${label}.acceptanceCriteria`,
        MAX_REASON_FIELD,
      );
      if (ac) return ac as SettlementResult<never>;
    }
    if (m.dueAtMs !== undefined) {
      if (
        typeof m.dueAtMs !== "number" ||
        !Number.isInteger(m.dueAtMs) ||
        m.dueAtMs < 0
      ) {
        return fail("BAD_INPUT", `${label}.dueAtMs must be an epoch-ms int`);
      }
    }
    if (m.releasePolicy !== undefined) {
      const rp = checkReleasePolicy(m.releasePolicy);
      if (rp) return rp;
    }
    if (m.legs !== undefined) {
      const lt = checkLegTemplate(m.legs, m.amountUsd, `${label}.legs`);
      if (lt) return lt;
    }
  }
  if (!sumsEqual(ms.map((m) => m.amountUsd), totalUsd)) {
    return fail(
      "BAD_INPUT",
      "sum(milestones.amountUsd) must equal totalUsd (D-227-3)",
    );
  }
  return null;
}
