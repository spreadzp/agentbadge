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

/** Nit: localeCompare ties NFC/NFD ids (making order significant) —
 *  sort by code point instead so the vector is canonical. */
// Total, deterministic order (UTF-16 code units — canonical on both
// sides of the compare, which is what the term hash needs; "code
// point" is a name, not a Unicode claim).
export const byCodePoint = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Milestone-vector term hash — id, amount, policy, and the leg
 *  payee/role/amount multiset. JSON-encoded rows: an id containing
 *  `|` or `\n` can never collide into a neighbouring field. */
export function milestoneVector(milestones: MilestoneTerm[]): string {
  return milestones
    .map((m) => {
      const legs = (m.legs ?? [])
        .map((l) =>
          JSON.stringify([
            l.role,
            l.payee.toLowerCase(),
            decimalToMicro(l.amountUsdc).toString(),
          ]),
        )
        .sort(byCodePoint)
        .join(",");
      return JSON.stringify([
        m.milestoneId,
        decimalToMicro(m.amountUsd).toString(),
        m.releasePolicy ?? "BUYER_ACCEPT",
        legs,
      ]);
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
    byCodePoint(a.milestoneId, b.milestoneId);
  const stored = storedMilestones.map(toTerm).sort(byId);
  const requested = input.milestones.slice().sort(byId);
  return milestoneVector(stored) === milestoneVector(requested);
}
