/**
 * SLICE-255-3: lifecycle runner support — begin-only authorize,
 * ledger readback, dimension notes. Kept split from the runner
 * (300-line guard).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { vi } from "vitest";

import { createSpendEnforcer } from "../../../../src/server/lib/agent-wallet/enforcer";
import type { SpendLedger } from "../../../../src/server/lib/agent-wallet/ledger";
import type { LifecycleVector, MmfTx } from "./mmf-types";
import { mmfAtToMs, boundsToCaps } from "./adapter";
import type { DimensionNote } from "./result";

/** MMF status → our SpendState (null = no equivalent). */
export const STATE_EQ: Record<string, string | null> = {
  AUTHORIZED: "reserved",
  CLAIMED: null,
  SETTLED: "settled",
  VOIDED: "released",
  DENIED: "denied",
};

/** begin-only — reservation stays OPEN for later settle/void. */
export async function authorizeTx(
  enforcer: ReturnType<typeof createSpendEnforcer>,
  wallet: `0x${string}`,
  tx: MmfTx,
  amount: unknown,
): Promise<{
  allowed?: boolean;
  denyBody?: Record<string, unknown>;
  threw?: string;
  begun?: { entry?: { id: string } };
}> {
  const app = new Hono();
  const refId = tx.tx_id ?? "tx";
  let held: { entry?: { id: string } } | undefined;
  app.post("/enforce", async (c: Context) => {
    const begun = await enforcer.begin(c, amount as number, "x402", refId);
    if (begun instanceof Response) return begun;
    held = begun;
    return c.json({ allowed: true });
  });
  const at = mmfAtToMs(tx.at);
  if (at !== undefined) vi.setSystemTime(at);
  try {
    const res = await app.request("/enforce", {
      method: "POST",
      headers: { "x-wallet": wallet },
    });
    if (res.status === 200) return { allowed: true, begun: held };
    if (res.status >= 500) {
      return { threw: `http ${res.status}: gate threw — fail-closed` };
    }
    return { allowed: false, denyBody: await res.json() };
  } catch (e) {
    return { threw: e instanceof Error ? e.message : String(e) };
  }
}

/** Readback helper: all ledger rows for one tx_id on one wallet. */
export async function stateOf(
  ledger: SpendLedger,
  txId: string,
  wallet: `0x${string}`,
): Promise<{ count: number; states: string[]; latest?: string }> {
  const rows = (await ledger.listByWallet(wallet)).filter(
    (e) => e.refId === txId,
  );
  // listByWallet sorts by `at` desc but keeps insertion order on ties —
  // so "latest" is the LAST row of the max-at group, not rows[0].
  const maxAt = rows[0]?.at;
  const latestRow = rows.filter((r) => r.at === maxAt).at(-1) ?? rows[0];
  return {
    count: rows.length,
    states: rows.map((r) => r.state),
    latest: latestRow?.state,
  };
}

export function lifecycleDimensions(
  v: LifecycleVector,
): Record<string, DimensionNote> {
  const d: Record<string, DimensionNote> = {
    lifecycle_states: {
      mapped_to: "SpendEntry.state reserved→settled/released/denied",
      equivalence: "Partial",
      note: "no CLAIMED state; VOIDED≈released; transitions via settleEntry/releaseEntry",
    },
    tx_id_dedup: {
      mapped_to: null,
      equivalence: "None",
      note: "refId correlation-only — every repeat creates a fresh sp_ reservation",
    },
    claim_op: {
      mapped_to: null,
      equivalence: "None",
      note: "no claim/dispatch-slot concept on the spend path",
    },
    evidence_events: {
      mapped_to: null,
      equivalence: "None",
      note: "no DECISION/REPLAY/CLAIM/SETTLE/VOID event stream — ledger rows only",
    },
  };
  if (v.mandate2) {
    d.cross_mandate = {
      mapped_to: "second AgentWalletRecord (mB wallet)",
      equivalence: "Partial",
      note: "mandate isolation ≈ per-wallet scoping; tx_id is per-wallet here, global in MMF",
    };
  }
  if (v.registry?.revoked || v.registry?.unavailable) {
    d.registry = {
      mapped_to: "suspended / store.get throw",
      equivalence: "Partial",
    };
  }
  // surface bounds that never reached SpendCaps (e.g. total_budget
  // without a window, currency, allowed_payees, expires_in_days)
  const { unmapped } = boundsToCaps(v.mandate.bounds);
  for (const u of unmapped) {
    const key = u.split(":")[0];
    d[`bounds_${key}`] = {
      mapped_to: null,
      equivalence: "None",
      note: `mandate.bounds.${u} has no prod mechanism`,
    };
  }
  const checks = new Set(
    v.steps.map((s) => (s.expect as { check?: string })?.check).filter(Boolean),
  );
  if ([...checks].some((c) => String(c).includes(":"))) {
    d.op_scoped_checks = {
      mapped_to: null,
      equivalence: "None",
      note: "CLAIM:*/SETTLE:*/VOID:* check-ids have no prod op to emit them",
    };
  }
  return d;
}
