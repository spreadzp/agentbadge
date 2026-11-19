/**
 * SLICE-255-2: core.json runner — each vector through the REAL
 * createSpendEnforcer.begin (Hono x-wallet path, like prod).
 *
 * Mapping per D-255-Q3 faithful-or-flagged:
 *  - bounds→SpendCaps scalar projection; unmapped bounds → dimensions
 *  - mandate.revoked / registry.revoked(matching id) → wallet.suspended
 *  - registry.unavailable → walletStore.get throws (fail-closed probe)
 *  - prior_txns → settled ledger seeds (at sec→ms)
 *  - tx.at → vi.setSystemTime; sequential, restored by caller
 *  - deny check-id: raw deny → checkIdForDeny; registry-driven suspend
 *    reports REVOKED_REGISTRY (the scenario's MMF analogue).
 */
import { vi } from "vitest";

import { createSpendEnforcer } from "../../../../src/server/lib/agent-wallet/enforcer";
import type { CoreVector, MmfTx } from "./mmf-types";
import {
  boundsToCaps,
  checkIdForDeny,
  mmfAmountToScalar,
} from "./adapter";
import {
  classifyCore,
  type ActualVerdict,
} from "./classify";
import {
  freshSpendEnv,
  runTx,
  seedPriorTxns,
  throwingStore,
  W,
} from "./harness-env";
import {
  RESULT_SCHEMA_VERSION,
  CORPUS_VERSION,
  deriveEquivalence,
  type DimensionNote,
  type VectorResult,
} from "./result";

const PROD_PATH = "createSpendEnforcer.begin→complete";

function coreDimensions(v: CoreVector): Record<string, DimensionNote> {
  const d: Record<string, DimensionNote> = {};
  const b = v.mandate.bounds;
  d.amount_bounds = {
    mapped_to: "SpendCaps.perTxUsd",
    equivalence: "Exact",
  };
  if (b.total_budget !== undefined) {
    const W_TO_CAP = { 1: "SpendCaps.dailyUsd", 7: "SpendCaps.weeklyUsd", 30: "SpendCaps.monthlyUsd" } as const;
    const cap = W_TO_CAP[b.budget_window_days as keyof typeof W_TO_CAP];
    d.budget_window = {
      mapped_to: cap ?? null,
      equivalence: cap ? "Exact" : "None",
      ...(cap ? {} : { note: `budget_window_days:${b.budget_window_days} has no window` }),
    };
  }
  if (b.velocity_limit !== undefined && b.velocity_limit > 0) {
    d.velocity = {
      mapped_to: "SpendCaps.maxTxPerHour",
      equivalence: "Partial",
      note: "MMF window=86400s of issued auths (incl. voided); ours=3600s of reserved+settled",
    };
  }
  if (b.currency !== undefined || v.expect.check === "CURRENCY") {
    d.currency_validation = {
      mapped_to: null,
      equivalence: "None",
      note: "scalar projection — no currency concept (D-255-Q16)",
    };
  }
  if (b.allowed_payees?.length || v.expect.check === "PAYEE") {
    d.payee_allowlist = {
      mapped_to: null,
      equivalence: "None",
      note: "no payee dimension in envelope model",
    };
  }
  if (b.expires_in_days !== undefined || v.expect.check === "EXPIRED") {
    d.mandate_expiry = {
      mapped_to: null,
      equivalence: "None",
      note: "envelope has no expiry",
    };
  }
  if (v.mandate.revoked || v.registry?.revoked) {
    d.revocation = {
      mapped_to: "AgentWalletRecord.suspended",
      equivalence: "Partial",
      note: "wallet kill-switch ≈ mandate revocation",
    };
  }
  if (v.registry?.unavailable) {
    d.registry_unavailable = {
      mapped_to: "AgentWalletStore.get throw",
      equivalence: "Partial",
      note: "fail-closed probe — prod exception path",
    };
  }
  if (v.expect.check === "NON_POSITIVE") {
    d.amount_validation = {
      mapped_to: null,
      equivalence: "None",
      note: v.tx.amount_json
        ? "lexical amount form cannot reach our number API"
        : "no amount-validity check in enforcer",
    };
  }
  if (v.expect.rejected) {
    d.input_validation = {
      mapped_to: null,
      equivalence: "None",
      note: "pre-evaluation input rejection has no analogue",
    };
  }
  if (v.tx.tx_id !== undefined) {
    d.replay_key = {
      mapped_to: "SpendEntry.refId",
      equivalence: "None",
      note: "refId is correlation-only, not a dedup key (D-255-Q14)",
    };
  }
  return d;
}

/** Hazardous scalar detection (for BUG-vs-MODEL classification):
 *  non-finite, ≤0, or non-numeric — things a reserve must not hold. */
function isUnsafeScalar(amount: unknown): boolean {
  if (typeof amount === "number") {
    return !Number.isFinite(amount) || amount <= 0;
  }
  return typeof amount !== "number"; // string/other wire types
}

function verdictFromOutcome(
  out: { allowed?: boolean; denyBody?: Record<string, unknown>; threw?: string },
  registryDriven: boolean,
  amount: unknown,
): ActualVerdict {
  if (out.threw) return { threw: out.threw, unsafeAmount: isUnsafeScalar(amount) };
  if (out.allowed) return { allowed: true, unsafeAmount: isUnsafeScalar(amount) };
  const body = out.denyBody ?? {};
  const rawDeny =
    typeof body.cap === "string"
      ? body.cap
      : typeof body.error === "string"
        ? body.error
        : "unknown";
  // Registry-driven suspension's MMF analogue is REVOKED_REGISTRY,
  // not plain REVOKED — the scenario decides, not the deny string.
  let checkId = checkIdForDeny(rawDeny);
  if (registryDriven && rawDeny === "spend_suspended") {
    checkId = "REVOKED_REGISTRY";
  }
  return {
    allowed: false,
    rawDeny,
    checkId,
    unsafeAmount: isUnsafeScalar(amount),
  };
}

async function runPhase(
  enforcer: ReturnType<typeof createSpendEnforcer>,
  tx: MmfTx,
  registryDriven: boolean,
): Promise<{ verdict: ActualVerdict; amount: unknown }> {
  const amount = mmfAmountToScalar(tx);
  const out = await runTx(enforcer, tx, amount);
  return { verdict: verdictFromOutcome(out, registryDriven, amount), amount };
}

export async function runCoreVector(
  v: CoreVector,
  corpusSha256: string,
): Promise<VectorResult> {
  const dimensions = coreDimensions(v);
  const { caps, unmapped } = boundsToCaps(v.mandate.bounds);
  for (const u of unmapped) {
    const key = u.split(":")[0];
    if (!dimensions[key]) {
      dimensions[key] = { mapped_to: null, equivalence: "None" };
    }
  }
  const registryDriven =
    v.registry?.revoked?.includes(v.mandate.mandate_id ?? "") ?? false;
  const suspended = v.mandate.revoked === true || registryDriven;

  const env = freshSpendEnv(caps, suspended);
  await env.save();
  const store = v.registry?.unavailable
    ? throwingStore(env.registry)
    : env.registry;
  await seedPriorTxns(env.ledger, W, v.prior_txns);
  const enforcer = createSpendEnforcer({
    ledger: env.ledger,
    registry: store,
    requireRegistered: true,
  });

  vi.useFakeTimers();
  try {
    const p1 = await runPhase(enforcer, v.tx, registryDriven);
    const result1 = classifyCore(p1.verdict, v.expect);
    let p2: Awaited<ReturnType<typeof runPhase>> | undefined;
    let result2: string | undefined;
    if (v.then_tx && v.then_expect) {
      p2 = await runPhase(enforcer, v.then_tx, registryDriven);
      result2 = classifyCore(p2.verdict, v.then_expect);
    }
    // Combined verdict: PASS only if every phase matches.
    const results = [result1, result2].filter(Boolean) as string[];
    const result = results.every((r) => r === "PASS")
      ? "PASS"
      : (results.find((r) => r !== "PASS") ?? "HARNESS_ERROR");
    const equivalence = deriveEquivalence(dimensions);
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "spend",
      vector_id: v.id,
      result: result as VectorResult["result"],
      equivalence,
      production_path: PROD_PATH,
      expected: { ...v.expect, ...(v.then_expect ? { then: v.then_expect } : {}) },
      actual: {
        ...p1.verdict,
        amount: p1.amount as number,
        ...(p2 ? { then: { ...p2.verdict, amount: p2.amount as number } } : {}),
      },
      dimensions,
      notes:
        result === "PASS" ? undefined : (v.desc ?? v.description ?? "").slice(0, 160),
    };
  } catch (e) {
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "spend",
      vector_id: v.id,
      result: "HARNESS_ERROR",
      equivalence: "None",
      production_path: PROD_PATH,
      expected: v.expect as Record<string, unknown>,
      actual: { error: e instanceof Error ? e.message : String(e) },
      dimensions,
    };
  } finally {
    vi.useRealTimers();
  }
}
