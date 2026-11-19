/**
 * SLICE-255-2: shared harness env — fresh stores + Hono ctx per vector.
 * Sequential runs under vi.useFakeTimers; callers restore in finally.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { vi } from "vitest";

import {
  createMemoryAgentWalletStore,
  type AgentWalletRecord,
  type AgentWalletStore,
  type SpendCaps,
} from "../../../../src/server/lib/agent-wallet/registry";
import {
  createMemorySpendLedger,
  newSpendId,
  type SpendEntry,
  type SpendLedger,
} from "../../../../src/server/lib/agent-wallet/ledger";
import { createSpendEnforcer } from "../../../../src/server/lib/agent-wallet/enforcer";
import { initSpendAlerts } from "../../../../src/server/lib/agent-wallet/audit";
import type { MmfTx } from "./mmf-types";
import { mmfAtToMs } from "./adapter";

export const W = "0x00000000000000000000000000000000000000b9" as `0x${string}`;
export const OWNER = "0x00000000000000000000000000000000000000aa" as `0x${string}`;
/** Deterministic delegate addresses for steps' symbolic ids (c/c1/c2/g). */
export const DELEGATE_ADDRS: Record<string, `0x${string}`> = {
  c: "0x00000000000000000000000000000000000000c1",
  c1: "0x00000000000000000000000000000000000000c2",
  c2: "0x00000000000000000000000000000000000000c3",
  g: "0x0000000000000000000000000000000000000067",
};

export function walletRecord(
  address: `0x${string}`,
  envelope: SpendCaps,
  suspended = false,
): AgentWalletRecord {
  return {
    address,
    label: "mmf",
    kind: "eoa",
    envelope,
    registeredBy: address,
    createdAt: 0,
    active: true,
    ...(suspended ? { suspended: true } : {}),
  };
}

/** registry.get() rejects — models MMF registry.unavailable (Q5:
 *  "cannot be consulted" ≠ revoked; prod path must fail closed). */
export function throwingStore(inner: AgentWalletStore): AgentWalletStore {
  return {
    ...inner,
    async get() {
      throw new Error("registry unavailable");
    },
  };
}

export function seedPriorTxns(
  ledger: SpendLedger,
  wallet: `0x${string}`,
  prior: Array<{ at: number; amount: number }> | undefined,
): Promise<void> {
  return (async () => {
    for (const p of prior ?? []) {
      const entry: SpendEntry = {
        id: newSpendId(),
        wallet,
        amountUsd: p.amount,
        kind: "x402",
        refId: "prior",
        state: "settled",
        at: mmfAtToMs(p.at) ?? 0,
      };
      await ledger.insert(entry);
    }
  })();
}

export interface TxOutcome {
  /** EnforceBegin on allow (reservation made + settled via complete). */
  allowed?: boolean;
  denyBody?: Record<string, unknown>;
  threw?: string;
}

/**
 * Run one tx through the REAL enforcer over a real Hono request
 * (x-wallet header — same resolution as prod). On allow we run
 * complete(ok=true) — the full begin→complete prod path — so the
 * authorization settles like a finished payment.
 */
export async function runTx(
  enforcer: ReturnType<typeof createSpendEnforcer>,
  tx: MmfTx,
  amount: unknown,
): Promise<TxOutcome> {
  const app = new Hono();
  const refId = tx.tx_id ?? "tx";
  app.post("/enforce", async (c: Context) => {
    const begun = await enforcer.begin(
      c,
      amount as number,
      "x402",
      refId,
    );
    if (begun instanceof Response) return begun;
    await enforcer.complete(begun, true, amount as number, "x402", refId);
    return c.json({ allowed: true });
  });
  const at = mmfAtToMs(tx.at);
  if (at !== undefined) vi.setSystemTime(at);
  try {
    const res = await app.request("/enforce", {
      method: "POST",
      headers: { "x-wallet": W },
    });
    if (res.status === 200) return { allowed: true };
    // 5xx = prod threw inside the gate (e.g. registry.get rejected) —
    // record the exception as such, not as a parseable deny body.
    if (res.status >= 500) {
      return { threw: `http ${res.status}: gate threw — fail-closed (500, no structured deny)` };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return { allowed: false, denyBody: body };
  } catch (e) {
    return { threw: e instanceof Error ? e.message : String(e) };
  }
}

export function freshSpendEnv(caps: SpendCaps, suspended: boolean) {
  const ledger = createMemorySpendLedger();
  const registry = createMemoryAgentWalletStore();
  initSpendAlerts(null);
  return {
    ledger,
    registry,
    save: () => registry.put(walletRecord(W, caps, suspended)),
  };
}
