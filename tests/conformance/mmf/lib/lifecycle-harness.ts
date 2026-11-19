/**
 * SLICE-255-3: lifecycle.json runner — 29 vectors of step-sequences
 * (authorize→claim→settle/void + tx_id replay) through REAL prod ops.
 *
 * Faithful-or-flagged (D-255-Q3): tx→begin (reservation left open),
 * settle→settleEntry, void→releaseEntry, claim→unmapped. tx_id replay
 * is correlation-only — every repeat reserves fresh (sp_ ids).
 */
import { vi } from "vitest";

import { createSpendEnforcer } from "../../../../src/server/lib/agent-wallet/enforcer";
import {
  settleEntry,
  releaseEntry,
} from "../../../../src/server/lib/agent-wallet/envelope";
import type { SpendEntry } from "../../../../src/server/lib/agent-wallet/ledger";
import { createMemoryAgentWalletStore } from "../../../../src/server/lib/agent-wallet/registry";
import { createMemorySpendLedger } from "../../../../src/server/lib/agent-wallet/ledger";
import type { LifecycleVector, LifecycleStep } from "./mmf-types";
import { boundsToCaps, checkIdForDeny, mmfAmountToScalar, mmfAtToMs } from "./adapter";
import { walletRecord, throwingStore } from "./harness-env";
import {
  STATE_EQ,
  authorizeTx,
  stateOf,
  lifecycleDimensions,
} from "./lifecycle-support";
import {
  RESULT_SCHEMA_VERSION,
  CORPUS_VERSION,
  type VectorResult,
} from "./result";

const PROD_PATH = "createSpendEnforcer.begin+settleEntry/releaseEntry";
const W1 = "0x00000000000000000000000000000000000000b9" as `0x${string}`;
const W_M2 = "0x00000000000000000000000000000000000000b2" as `0x${string}`;

interface StepOutcome {
  kind: string;
  tx_id?: string;
  verdict: "match" | "mismatch" | "unmapped" | "threw";
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}

export async function runLifecycleVector(
  v: LifecycleVector,
  corpusSha256: string,
): Promise<VectorResult> {
  const dimensions = lifecycleDimensions(v);
  const ledger = createMemorySpendLedger();
  const registry = createMemoryAgentWalletStore();
  const caps1 = boundsToCaps(v.mandate.bounds).caps;
  const revoked1 =
    v.registry?.revoked?.includes(v.mandate.mandate_id ?? " ") ||
    v.mandate.revoked === true;
  await registry.put(walletRecord(W1, caps1, revoked1));
  if (v.mandate2) {
    const caps2 = boundsToCaps(v.mandate2.bounds).caps;
    const revoked2 =
      v.registry?.revoked?.includes(v.mandate2.mandate_id ?? " ") ||
      v.mandate2.revoked === true;
    await registry.put(walletRecord(W_M2, caps2, revoked2));
  }
  const store = v.registry?.unavailable ? throwingStore(registry) : registry;
  const enforcer = createSpendEnforcer({
    ledger,
    registry: store,
    requireRegistered: true,
  });
  /** wallet:tx_id → reserved entry handle for settle/void. */
  const handles = new Map<string, { entry: SpendEntry }>();

  const execTx = async (s: LifecycleStep): Promise<StepOutcome> => {
    const tx = s.tx!;
    const wallet = tx.as === "m2" ? W_M2 : W1;
    const amount = mmfAmountToScalar(tx);
    const exp = (s.expect ?? {}) as Record<string, unknown>;
    const out = await authorizeTx(enforcer, wallet, tx, amount);
    if (out.threw) {
      return { kind: "tx", tx_id: tx.tx_id, verdict: "threw", expected: exp, actual: { threw: out.threw } };
    }
    if (out.allowed && out.begun?.entry) {
      handles.set(`${wallet}:${tx.tx_id}`, { entry: out.begun.entry as SpendEntry });
    }
    const read = await stateOf(ledger, tx.tx_id ?? "", wallet);
    const rawDeny =
      typeof out.denyBody?.cap === "string"
        ? out.denyBody.cap
        : typeof out.denyBody?.error === "string"
          ? out.denyBody.error
          : undefined;
    let checkId = rawDeny ? checkIdForDeny(rawDeny) : out.allowed ? "WITHIN" : null;
    if (v.registry?.revoked && rawDeny === "spend_suspended") {
      checkId = "REVOKED_REGISTRY";
    }
    const statusMatch =
      exp.status === undefined
        ? true
        : exp.status === "DENIED"
          ? read.latest === "denied"
          : read.latest === STATE_EQ[String(exp.status)];
    const verdictOk =
      out.allowed === exp.allowed &&
      (exp.check === undefined || checkId === exp.check) &&
      (exp.replayed === undefined || exp.replayed === false) &&
      statusMatch;
    // Velocity-void evasion AT THIS MOMENT: expected a VELOCITY deny
    // but we allowed — and a released entry exists, i.e. the void
    // freed the windowCount slot the limiter was counting on (L05).
    const velocityEvasion =
      exp.check === "VELOCITY" &&
      out.allowed === true &&
      (await ledger.listByWallet(wallet)).some((e) => e.state === "released");
    return {
      kind: "tx",
      tx_id: tx.tx_id,
      verdict: verdictOk ? "match" : "mismatch",
      expected: exp,
      actual: {
        allowed: out.allowed,
        checkId,
        rawDeny,
        replayed: false, // always re-decided — no stored decision
        state: read.latest,
        reservationsForTxId: read.count,
        ...(velocityEvasion ? { velocityEvasion: true } : {}),
      },
    };
  };

  const execTransition = async (
    s: LifecycleStep,
    kind: "settle" | "void",
  ): Promise<StepOutcome> => {
    const txId = (s.settle ?? s.void) as string;
    const exp = (s.expect ?? {}) as Record<string, unknown>;
    const at = mmfAtToMs(s.at);
    if (at !== undefined) vi.setSystemTime(at);
    const handle = handles.get(`${W1}:${txId}`) ?? handles.get(`${W_M2}:${txId}`);
    const fn = kind === "settle" ? settleEntry : releaseEntry;
    let moved: boolean | "missing" = "missing";
    if (handle) moved = await fn(ledger, handle.entry.id);
    const read = await stateOf(ledger, txId, W1);
    const read2 = v.mandate2 ? await stateOf(ledger, txId, W_M2) : undefined;
    const latest = read.latest ?? read2?.latest;
    const statusOk =
      exp.status === undefined ? true : latest === STATE_EQ[String(exp.status)];
    const errorOk = exp.error === true ? moved !== true : moved !== "missing";
    return {
      kind,
      tx_id: txId,
      verdict: errorOk && statusOk ? "match" : "mismatch",
      expected: exp,
      actual: {
        moved,
        state: latest,
        cancellation: s.cancellation,
        checkId: null, // SETTLE:*/VOID:* ids have no prod emitter
      },
    };
  };

  vi.useFakeTimers();
  try {
    const steps: StepOutcome[] = [];
    for (const s of v.steps) {
      if (s.tx) steps.push(await execTx(s));
      else if (s.claim) {
        steps.push({
          kind: "claim",
          tx_id: s.claim.tx_id,
          verdict: "unmapped",
          expected: (s.expect ?? {}) as Record<string, unknown>,
          actual: { note: "no claim op in prod spend path" },
        });
      } else if (s.settle !== undefined) {
        steps.push(await execTransition(s, "settle"));
      } else if (s.void !== undefined) {
        steps.push(await execTransition(s, "void"));
      } else {
        steps.push({ kind: "unknown", verdict: "unmapped", expected: {}, actual: {} });
      }
    }

    // Replay matrix — every tx_id reuse classified (D-255-Q6).
    const seen = new Map<string, { amount: unknown; payee?: string }>();
    const replayMatrix: Array<Record<string, unknown>> = [];
    for (const s of v.steps) {
      if (!s.tx) continue;
      const key = s.tx.tx_id ?? "";
      const amount = mmfAmountToScalar(s.tx);
      const prior = seen.get(key);
      if (prior) {
        const rows = (await ledger.listByWallet(W1)).filter(
          (e) => e.refId === key,
        );
        replayMatrix.push({
          tx_id: key,
          case:
            prior.amount === amount && prior.payee === s.tx.payee
              ? "same_params"
              : prior.amount !== amount
                ? "diff_amount"
                : "diff_payee",
          expectedCheck: (s.expect as Record<string, unknown>)?.check ?? null,
          expectedReplayed: (s.expect as Record<string, unknown>)?.replayed ?? null,
          actual: {
            replayed: false,
            reservationsForTxId: rows.length,
          },
        });
      }
      seen.set(key, { amount, payee: s.tx.payee });
    }

    const velocityEvasion = steps.some(
      (s) => s.actual.velocityEvasion === true,
    );
    const result: VectorResult["result"] = steps.some((s) => s.verdict === "threw")
      ? "GATE_EXCEPTION"
      : velocityEvasion
        ? "DIVERGENCE-BUG"
        : steps.some((s) => s.verdict === "mismatch")
          ? "DIVERGENCE-MODEL"
          : steps.some((s) => s.verdict === "unmapped")
            ? "NOT_MAPPABLE"
            : "PASS";

    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "lifecycle",
      vector_id: v.id,
      result,
      equivalence: "Partial",
      production_path: PROD_PATH,
      expected: {
        steps: v.steps.map((s) => s.expect ?? null),
        events: v.events,
      },
      actual: {
        steps: steps.map((s) => ({
          kind: s.kind,
          tx_id: s.tx_id,
          verdict: s.verdict,
          actual: s.actual,
        })),
        replayMatrix,
      },
      dimensions,
      steps: steps as unknown as Array<Record<string, unknown>>,
      notes: result === "PASS" ? undefined : (v.desc ?? "").slice(0, 160),
    };
  } catch (e) {
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "lifecycle",
      vector_id: v.id,
      result: "HARNESS_ERROR",
      equivalence: "None",
      production_path: PROD_PATH,
      expected: { steps: v.steps.map((s) => s.expect ?? null), events: v.events },
      actual: { error: e instanceof Error ? e.message : String(e) },
      dimensions,
    };
  } finally {
    vi.useRealTimers();
  }
}
