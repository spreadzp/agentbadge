/**
 * SLICE-255-5 / D-255-Q24: evidence matrix — what each deny branch
 * actually leaves behind. 7 branches × 6 fields, all through the
 * REAL enforcer (Hono x-wallet path) — never simulated.
 *
 * Branches: suspended / kind / cap / velocity / not-registered /
 * registry-throw / corrupted-JSON ledger. Plus the slice's extra:
 * fail-closed when the deny-evidence write itself fails.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMemoryAgentWalletStore,
  type AgentWalletStore,
  type SpendCaps,
} from "../../../../src/server/lib/agent-wallet/registry";
import {
  createJsonSpendLedger,
  createMemorySpendLedger,
  type SpendEntry,
  type SpendLedger,
} from "../../../../src/server/lib/agent-wallet/ledger";
import { createSpendEnforcer } from "../../../../src/server/lib/agent-wallet/enforcer";
import {
  createMemorySpendAlertStore,
  initSpendAlerts,
} from "../../../../src/server/lib/agent-wallet/audit";
import { throwingStore, walletRecord, W } from "./harness-env";

export interface MatrixRow {
  branch: string;
  http: number | null;
  /** Durable ledger trace left by the denied call (state:reason). */
  durable: string | null;
  /** Alert type emitted, null = silent. */
  alert: string | null;
  /** A cap-consuming reservation was made. */
  reservation: boolean;
  /** Wire code in the deny body (`error`/`cap`). */
  reason: string | null;
  /** Same-refId second call — what changes. */
  replay: string;
}

interface ProbeOutcome {
  status: number;
  body: Record<string, unknown> | null;
}

async function fireOnce(
  enforcer: ReturnType<typeof createSpendEnforcer>,
  amountUsd: number,
  refId = "probe",
): Promise<ProbeOutcome> {
  const app = new Hono();
  app.post("/enforce", async (c: Context) => {
    const begun = await enforcer.begin(c, amountUsd, "x402", refId);
    if (begun instanceof Response) return begun;
    await enforcer.complete(begun, true, amountUsd, "x402", refId);
    return c.json({ allowed: true });
  });
  const res = await app.request("/enforce", {
    method: "POST",
    headers: { "x-wallet": W },
  });
  if (res.status >= 500) return { status: res.status, body: null };
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

interface ProbeEnv {
  enforcer: ReturnType<typeof createSpendEnforcer>;
  ledger: SpendLedger;
  alertStore: ReturnType<typeof createMemorySpendAlertStore>;
}

function mkEnv(opts: {
  caps?: SpendCaps;
  suspended?: boolean;
  registerWallet?: boolean;
  requireRegistered?: boolean;
  registry?: AgentWalletStore;
  ledger?: SpendLedger;
}): ProbeEnv {
  const ledger = opts.ledger ?? createMemorySpendLedger();
  const registry = opts.registry ?? createMemoryAgentWalletStore();
  if (opts.registerWallet !== false) {
    void registry.put(
      walletRecord(W, opts.caps ?? {}, opts.suspended ?? false),
    );
  }
  const alertStore = createMemorySpendAlertStore();
  initSpendAlerts({ store: alertStore });
  const enforcer = createSpendEnforcer({
    ledger,
    registry,
    requireRegistered: opts.requireRegistered ?? false,
  });
  return { enforcer, ledger, alertStore };
}

async function summarize(
  env: ProbeEnv,
  branch: string,
  first: ProbeOutcome,
  second: ProbeOutcome,
): Promise<MatrixRow> {
  const all = await env.ledger.listByWallet(W);
  const denied = all.filter((e) => e.state === "denied");
  const reserved = all.some(
    (e) => e.state === "reserved" || e.state === "settled",
  );
  const lastAlert = env.alertStore.list().at(-1);
  const secondDenied = (await env.ledger.listByWallet(W)).filter(
    (e) => e.state === "denied",
  );
  const replay =
    second.status === first.status
      ? `same-refId → ${second.status}, ${secondDenied.length} denied entr${secondDenied.length === 1 ? "y" : "ies"} total`
      : `same-refId → ${second.status} (was ${first.status})`;
  return {
    branch,
    http: first.status,
    durable:
      denied.length > 0
        ? `denied:${denied.at(-1)?.denialReason ?? "?"}`
        : null,
    alert: lastAlert?.type ?? null,
    reservation: reserved,
    reason:
      first.body === null
        ? null
        : String(first.body.error ?? first.body.cap ?? "—"),
    replay,
  };
}

/** Run one branch twice with the same refId → matrix row. */
async function probeBranch(
  branch: string,
  env: ProbeEnv,
  amountUsd = 20,
): Promise<MatrixRow> {
  const first = await fireOnce(env.enforcer, amountUsd);
  const second = await fireOnce(env.enforcer, amountUsd);
  return summarize(env, branch, first, second);
}

export async function runEvidenceMatrix(): Promise<MatrixRow[]> {
  const rows: MatrixRow[] = [];
  try {
    // 1. suspended — first branch, before caps.
    rows.push(
      await probeBranch(
        "suspended",
        mkEnv({ caps: { dailyUsd: 1000 }, suspended: true }),
      ),
    );
    // 2. kind — allowedKinds set, "x402" ∉ list.
    rows.push(
      await probeBranch(
        "kind",
        mkEnv({ caps: { allowedKinds: ["eaas"] } }),
      ),
    );
    // 3. cap — perTxUsd 10 < amount 20 (no ledger scan needed).
    rows.push(
      await probeBranch("cap", mkEnv({ caps: { perTxUsd: 10 } })),
    );
    // 4. velocity — maxTxPerHour 1: first allow, second denied.
    {
      const env = mkEnv({ caps: { maxTxPerHour: 1 } });
      const allow = await fireOnce(env.enforcer, 10); // consumes the slot
      const denied = await fireOnce(env.enforcer, 10);
      const third = await fireOnce(env.enforcer, 10);
      const row = await summarize(env, "velocity", denied, third);
      row.replay = `pre-filled by 1st allow (${allow.status}); same-refId 3rd call → ${third.status}`;
      rows.push(row);
    }
    // 5. not-registered — requireRegistered, wallet absent.
    rows.push(
      await probeBranch(
        "not-registered",
        mkEnv({ registerWallet: false, requireRegistered: true }),
      ),
    );
    // 6. registry-throw — get() rejects.
    {
      const env = mkEnv({});
      env.enforcer = createSpendEnforcer({
        ledger: env.ledger,
        registry: throwingStore(
          createMemoryAgentWalletStore(),
        ),
        requireRegistered: false,
      });
      rows.push(await probeBranch("registry-throw", env));
    }
    // 7. corrupted-JSON ledger — garbage file → readJson{} → ALLOW.
    {
      const dir = mkdtempSync(join(tmpdir(), "mmf-evi-"));
      try {
        const file = join(dir, "ledger.json");
        writeFileSync(file, "THIS IS NOT JSON {{{");
        const env = mkEnv({ ledger: createJsonSpendLedger(file) });
        const first = await fireOnce(env.enforcer, 20);
        const after = readFileSync(file, "utf8");
        const clobbered = !after.includes("THIS IS NOT JSON");
        const row = await summarize(env, "corrupted-json", first, {
          status: first.status,
          body: null,
        });
        row.replay = `corrupt file silently replaced (clobbered=${clobbered})`;
        rows.push(row);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    initSpendAlerts(null);
  }
  return rows;
}

/** Slice extra: deny-evidence write throws → request must fail closed,
 *  no reservation, no alert. */
export async function runEvidenceFailClosed(): Promise<{
  http: number | null;
  reservation: boolean;
  alertEmitted: boolean;
}> {
  const alerts = createMemorySpendAlertStore();
  initSpendAlerts({ store: alerts });
  try {
    const exploding: SpendLedger = {
      name: "memory",
      async insert() {
        throw new Error("disk full — evidence write failed");
      },
      async transition() {
        return false;
      },
      async listByWallet() {
        return [] as SpendEntry[];
      },
    };
    const registry = createMemoryAgentWalletStore();
    await registry.put(walletRecord(W, { perTxUsd: 10 }));
    const enforcer = createSpendEnforcer({
      ledger: exploding,
      registry,
      requireRegistered: false,
    });
    const app = new Hono();
    app.post("/enforce", async (c: Context) => {
      const begun = await enforcer.begin(c, 20, "x402", "fc");
      if (begun instanceof Response) return begun;
      return c.json({ allowed: true });
    });
    const res = await app.request("/enforce", {
      method: "POST",
      headers: { "x-wallet": W },
    });
    return {
      http: res.status,
      reservation: false,
      alertEmitted: alerts.list().length > 0,
    };
  } finally {
    initSpendAlerts(null);
  }
}
