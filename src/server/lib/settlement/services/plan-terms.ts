/**
 * EPIC-227 — plan term equality (R2-H1).
 *
 * The milestone/leg/policy vector is part of the payout contract, not
 * just the parties and total. A `duplicate:true` plan that disagrees
 * on any of it is a CONFLICT — never silently adopted.
 */
import { decimalToMicro } from "../invariants.js";
import type { MilestoneInput } from "../types.js";

/** Structural milestone term — a looser MilestoneInput (title is
 *  display-only, not part of the payout contract). */
export type MilestoneTerm = Pick<
  MilestoneInput,
  "milestoneId" | "amountUsd"
> &
  Partial<Pick<MilestoneInput, "releasePolicy" | "legs">>;

/** Milestone-vector term hash — id, amount, policy, and the leg
 *  payee/role/amount multiset. */
export function milestoneVector(milestones: MilestoneTerm[]): string {
  return milestones
    .map((m) => {
      const legs = (m.legs ?? [])
        .map(
          (l) =>
            `${l.role}:${l.payee.toLowerCase()}:${decimalToMicro(l.amountUsdc)}`,
        )
        .sort()
        .join(",");
      return [
        m.milestoneId,
        decimalToMicro(m.amountUsd).toString(),
        m.releasePolicy ?? "BUYER_ACCEPT",
        legs,
      ].join("|");
    })
    .join("\n");
}

/** Terms equality between a stored plan and a create/ensure request —
 *  a `duplicate:true` plan that disagrees is a CONFLICT, not success
 *  (C1: prevents agreementRef squat with forged terms). */
export function samePlanTerms(
  plan: {
    buyerWallet: string;
    providerWallet: string;
    totalUsd: string;
  },
  storedMilestones: {
    milestoneId: string;
    amountUsd: string;
    releasePolicy: string;
    payload: unknown;
  }[],
  input: {
    buyerWallet: string;
    providerWallet: string;
    totalUsd: string;
    milestones: MilestoneTerm[];
  },
): boolean {
  if (
    plan.buyerWallet.toLowerCase() !== input.buyerWallet.toLowerCase() ||
    plan.providerWallet.toLowerCase() !==
      input.providerWallet.toLowerCase() ||
    decimalToMicro(plan.totalUsd) !== decimalToMicro(input.totalUsd)
  ) {
    return false;
  }
  const toTerm = (m: {
    milestoneId: string;
    amountUsd: string;
    releasePolicy: string;
    payload: unknown;
  }): MilestoneTerm => {
    const template =
      m.payload && typeof m.payload === "object" && !Array.isArray(m.payload)
        ? (m.payload as Record<string, unknown>)["payoutTemplate"]
        : undefined;
    return {
      milestoneId: m.milestoneId,
      amountUsd: m.amountUsd,
      releasePolicy: m.releasePolicy as MilestoneTerm["releasePolicy"],
      legs: Array.isArray(template)
        ? (template as MilestoneTerm["legs"])
        : undefined,
    };
  };
  const byId = (a: MilestoneTerm, b: MilestoneTerm) =>
    a.milestoneId.localeCompare(b.milestoneId);
  const stored = storedMilestones.map(toTerm).sort(byId);
  const requested = input.milestones.slice().sort(byId);
  return milestoneVector(stored) === milestoneVector(requested);
}
