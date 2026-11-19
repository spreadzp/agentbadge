/**
 * SLICE-255-2: delegation.json runner — steps through the REAL
 * spendAsDelegate / DelegateStore (D-255-Q17).
 *
 * Step mapping:
 *  - {delegate,bounds}  → validateDelegateInput + store.put
 *      (spendCapUsd=bounds.max_amount, ownerPerTxUsd=live owner cap;
 *       MMF rejects widening children — we CLAMP, model delta)
 *  - {tx:{as}}          → spendAsDelegate(amountUsd=scalar,
 *      walletStore=owner registry, kit mock status="ready")
 *  - {revoke:"parent"}  → DelegateStore.revoke(owner, chain) — kills
 *      the delegation link (≈ parent-mandate revocation)
 *  - claim / settle / from / multi-level chains → unexecutable:
 *      no such ops in our single-level delegate model → NOT_MAPPABLE
 */
import {
  createMemoryAgentWalletStore,
  type AgentWalletStore,
} from "../../../../src/server/lib/agent-wallet/registry";
import {
  createMemoryDelegateStore,
  spendAsDelegate,
  validateDelegateInput,
  type DelegateSpendKit,
} from "../../../../src/server/lib/agent-wallet/delegate";
import type { DelegationVector, DelegationStep } from "./mmf-types";
import { boundsToCaps, checkIdForDeny, mmfAmountToScalar } from "./adapter";
import { classifyStep } from "./classify";
import {
  DELEGATE_ADDRS,
  OWNER,
  walletRecord,
} from "./harness-env";
import {
  RESULT_SCHEMA_VERSION,
  CORPUS_VERSION,
  deriveEquivalence,
  type DimensionNote,
  type VectorResult,
} from "./result";

const PROD_PATH = "spendAsDelegate+DelegateStore";
const CHAIN = "mmf";

function mockKit(
  status: "none" | "pending" | "ready",
  calls: Array<Record<string, unknown>>,
): DelegateSpendKit {
  return {
    async getDelegateStatus() {
      return status;
    },
    async spend(args) {
      calls.push({ ...args });
      return { ok: true, tx: "0xmocktx" };
    },
  };
}

interface StepOutcome {
  kind: string;
  verdict: "match" | "mismatch" | "unmapped" | "threw";
  detail: Record<string, unknown>;
}

function delegateDimensions(v: DelegationVector): Record<string, DimensionNote> {
  const d: Record<string, DimensionNote> = {
    stored_cap: {
      mapped_to: "DelegateRecord.spendCapUsd→min(owner.perTxUsd)",
      equivalence: "Exact",
      note: "non-widening implemented post-234-32 (live owner lookup)",
    },
  };
  const steps = v.steps;
  if (steps.some((s) => s.from !== undefined)) {
    d.delegation_chains = {
      mapped_to: null,
      equivalence: "None",
      note: "single-level delegate store — no chain resolution",
    };
  }
  if (steps.some((s) => s.claim !== undefined || s.settle !== undefined)) {
    d.delegate_lifecycle = {
      mapped_to: null,
      equivalence: "None",
      note: "no claim/settle ops on the delegate path",
    };
  }
  if (steps.some((s) => s.revoke !== undefined)) {
    d.revocation = {
      mapped_to: "DelegateStore.revoke / owner.suspended",
      equivalence: "Partial",
      note: "link revocation ≈ parent mandate revocation",
    };
  }
  const pb = v.parent;
  if (
    pb.allowed_payees?.length ||
    pb.currency !== undefined ||
    pb.expires_in_days !== undefined ||
    pb.velocity_limit !== undefined ||
    pb.budget_window_days !== undefined
  ) {
    d.parent_extra_bounds = {
      mapped_to: null,
      equivalence: "None",
      note: "child/parent bounds beyond spendCapUsd are not checked",
    };
  }
  return d;
}

async function execStep(
  s: DelegationStep,
  ctx: {
    store: ReturnType<typeof createMemoryDelegateStore>;
    wallets: AgentWalletStore;
    ownerCaps: ReturnType<typeof boundsToCaps>;
    calls: Array<Record<string, unknown>>;
  },
): Promise<StepOutcome> {
  // delegate creation
  if (s.delegate !== undefined) {
    const addr = DELEGATE_ADDRS[s.delegate] ?? DELEGATE_ADDRS.c;
    try {
      const rec = validateDelegateInput({
        ownerWallet: OWNER,
        delegate: addr,
        chain: CHAIN,
        spendCapUsd: s.bounds?.max_amount ?? 0,
        ownerPerTxUsd: ctx.ownerCaps.caps.perTxUsd,
      });
      ctx.store.put(rec);
      return {
        kind: "delegate",
        verdict: classifyStep(s.expect, { ok: true }),
        detail: { delegate: s.delegate, spendCapUsd: rec.spendCapUsd },
      };
    } catch (e) {
      // Validation throw IS the rejection when the step expects one.
      return {
        kind: "delegate",
        verdict: s.expect === "invalid" ? "match" : "threw",
        detail: { error: e instanceof Error ? e.message : String(e) },
      };
    }
  }
  // spend as delegate
  if (s.tx !== undefined) {
    const amount = mmfAmountToScalar(s.tx);
    const out = await spendAsDelegate(ctx.store, mockKit("ready", ctx.calls), {
      ownerWallet: OWNER,
      chain: CHAIN,
      amountUsd: String(amount),
      to: {
        chain: CHAIN,
        recipientAddress: s.tx.payee ?? "unknown",
      },
      walletStore: ctx.wallets,
    });
    const rawDeny = out.ok ? undefined : out.reason;
    const checkId = rawDeny ? checkIdForDeny(rawDeny) : "WITHIN";
    return {
      kind: "tx",
      verdict: classifyStep(s.expect, { ok: out.ok, checkId }),
      detail: {
        ok: out.ok,
        reason: rawDeny,
        checkId,
        amount,
      },
    };
  }
  // parent revocation
  if (s.revoke !== undefined) {
    const did = ctx.store.revoke(OWNER, CHAIN);
    return {
      kind: "revoke",
      verdict: did ? "match" : "mismatch",
      detail: { revoked: s.revoke, storeRevoked: did },
    };
  }
  // lifecycle / chain steps — no prod path
  const unmapped = s.claim !== undefined
    ? "claim"
    : s.settle !== undefined
      ? "settle"
      : s.from !== undefined
        ? "from"
        : "unknown";
  return {
    kind: unmapped,
    verdict: "unmapped",
    detail: { step: s as Record<string, unknown> },
  };
}

export async function runDelegationVector(
  v: DelegationVector,
  corpusSha256: string,
): Promise<VectorResult> {
  const dimensions = delegateDimensions(v);
  const ownerCaps = boundsToCaps(v.parent);
  const wallets = createMemoryAgentWalletStore();
  await wallets.put(walletRecord(OWNER, ownerCaps.caps, false));
  const store = createMemoryDelegateStore();
  const calls: Array<Record<string, unknown>> = [];

  try {
    const steps: StepOutcome[] = [];
    for (const s of v.steps) {
      steps.push(
        await execStep(s, { store, wallets, ownerCaps, calls }),
      );
    }
    const hasUnmapped = steps.some((s) => s.verdict === "unmapped");
    const hasThrew = steps.some((s) => s.verdict === "threw");
    const hasMismatch = steps.some((s) => s.verdict === "mismatch");
    const result: VectorResult["result"] = hasThrew
      ? "GATE_EXCEPTION"
      : hasUnmapped
        ? "NOT_MAPPABLE"
        : hasMismatch
          ? "DIVERGENCE-MODEL"
          : "PASS";
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "delegation",
      vector_id: v.id,
      result,
      equivalence: deriveEquivalence(dimensions),
      production_path: PROD_PATH,
      expected: { steps: v.steps.map((s) => s.expect ?? null) },
      actual: { kitCalls: calls.length },
      dimensions,
      steps: steps as unknown as Array<Record<string, unknown>>,
      notes:
        result === "PASS" ? undefined : (v.desc ?? "").slice(0, 160),
    };
  } catch (e) {
    return {
      schema_version: RESULT_SCHEMA_VERSION,
      corpus_version: CORPUS_VERSION,
      corpus_sha256: corpusSha256,
      track: "delegation",
      vector_id: v.id,
      result: "HARNESS_ERROR",
      equivalence: "None",
      production_path: PROD_PATH,
      expected: { steps: v.steps.map((s) => s.expect ?? null) },
      actual: { error: e instanceof Error ? e.message : String(e) },
      dimensions,
    };
  }
}
