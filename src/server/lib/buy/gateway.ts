/* eslint-disable max-lines -- TODO(191-10): split runner/gate/pay sections */
/**
 * SLICE-191-10: buyer side of the `@celo/buy` API gateway — the agent
 * spends its own USDC float on paid data APIs (premium FX quotes, X
 * sentiment) at https://gateway.usebuy.ai.
 *
 * Flow (buy-skill rules):
 *   catalog()  — free GET /v1/catalog (prices indicative)
 *   quote()    — POST without payment → 402 challenge is the PRICE
 *                AUTHORITY; a BuyQuote must exist before pay()
 *   pay()      — spend guard (kill-switch → suspended → kind → caps →
 *                approval-hold → reserve) → `npx @celo/buy curl` →
 *                classify + settle the ledger entry
 *
 * Retry discipline (never charge twice):
 *   - retryable only when settlement provably did NOT happen
 *     (4xx refusal, 503, verify_payment_failed);
 *   - `settle_uncertain` / `provision_failed` / network interruption
 *     after payment / `retryable:false` → terminal "uncertain" —
 *     NEVER auto-retried, treat-as-float until receipt is inspected.
 *
 * Owner controls (176): spend-kind "buy-gateway" lives in the wallet's
 * allowedKinds, per-tx/daily caps in the envelope, above approvalAboveUsd
 * parks a pending intent (owner approves → permit consumed on retry).
 * Kill-switch: BUY_GATEWAY_ENABLED !== "true" → refuses without spawn.
 */

import { spawn } from "node:child_process";

import { isAddress } from "viem";

import type { AgentWalletStore } from "../agent-wallet/registry";
import type {
  SpendEntry,
  SpendLedger,
} from "../agent-wallet/ledger";
import { checkEnvelope, insertReserved } from "../agent-wallet/envelope";
import {
  emitKindDeny,
  emitSpendDeny,
  emitSuspendedDeny,
  tryApprovalHold,
  type SpendDenyCtx,
} from "../agent-wallet/deny";
import {
  DEFAULT_APPROVAL_TTL_MS,
  type ApprovalStore,
  type SpendApproval,
} from "../agent-wallet/approvals";
import {
  counterpartyGate,
  counterpartyModeFromEnv,
  counterpartyPermitRecheck,
  getCounterpartyChecker,
} from "./counterparty-gate";
import { bindDeal } from "./offer-selection";
import {
  createCounterpartyPolicy,
  normalizeAmount,
  type CounterpartyChecker,
  type CounterpartyCheckMode,
  type CounterpartyPolicy,
} from "@agentbadge/circle-payments";
import { getArcEventLogWriter } from "../fx-delta/arc-writer";

const BUY_CLI_VERSION = "0.8.1";
export const BUY_CATALOG_URL = "https://gateway.usebuy.ai/v1/catalog";

/* ------------------------------- runner ---------------------------------- */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process runner — tests substitute a mock. */
export type BuyRunner = (args: string[]) => Promise<ExecResult>;

const defaultRunner: BuyRunner = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) =>
      resolve({ code: code ?? 1, stdout, stderr }),
    );
  });

export type BuyFetcher = (
  url: string,
  init?: { method?: string; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

const defaultFetcher: BuyFetcher = async (url, init) => {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    ...(init?.body
      ? { headers: { "content-type": "application/json" }, body: init.body }
      : {}),
  });
  return { status: res.status, json: () => res.json() };
};

/* -------------------------------- types ---------------------------------- */

export interface BuyGateDeps {
  registry: AgentWalletStore;
  ledger: SpendLedger;
  approvals?: ApprovalStore;
  approvalTtlMs?: number;
}

export interface BuyQuote {
  url: string;
  method: string;
  body?: string;
  /**
   * Max amount in TOKEN units (human-readable, e.g. "0.016753"),
   * converted from the 402 challenge's `maxAmountRequired` which is
   * atomic (6 decimals on USDC/USDT/USAT). This is what `--max-amount`
   * expects and what the envelope checks.
   */
  maxAmount: string;
  /** Atomic units, verbatim from the 402 challenge. */
  maxAmountAtomic: string;
  /** Raw 402 challenge for auditing. */
  raw: unknown;
}

/** atomic → human token units (6 decimals), precision-safe via bigint. */
export function atomicToUnits(atomic: string): string {
  const v = BigInt(atomic.trim());
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export type BuyClass =
  | "paid" // settled — output usable
  | "refused" // pre-signature 402 challenge — safe to retry later
  | "uncertain"; // settle state unknown — NEVER retry automatically

export interface BuyResult {
  status: BuyClass | "denied" | "approval_required" | "disabled";
  txHash?: string;
  output?: string;
  deny?: Record<string, unknown>;
  attempts: number;
}

/* ------------------------------- singleton ------------------------------- */

let _deps: BuyGateDeps | null = null;

/** Wired from agent-wallet wiring (same registry+ledger as enforcer). */
export function initBuyGate(deps: BuyGateDeps | null): void {
  _deps = deps;
}
export function getBuyGate(): BuyGateDeps | null {
  return _deps;
}

export interface BuyGatewayOptions {
  runner?: BuyRunner;
  fetcher?: BuyFetcher;
  /** Overrides deps (tests) — defaults to getBuyGate(). */
  gate?: BuyGateDeps | null;
  /**
   * SLICE-257-5: counterparty gate overrides (tests). mode defaults to
   * counterpartyModeFromEnv(), checker to the env singleton, policy to
   * the shared contract matrix.
   */
  counterparty?: {
    checker?: CounterpartyChecker;
    policy?: CounterpartyPolicy;
    mode?: CounterpartyCheckMode;
  };
  /**
   * SLICE-191-10 AC3: companion anchor — the gateway settle-tx is
   * facilitator-submitted so it can't carry our ERC-8021 tag; instead
   * every paid purchase emits OUR OWN `fxdelta-buy` topic on Arc's
   * AgentEventLog (tagged via ATTRIBUTION_CODE), linking the purchase
   * txHash. Defaults to the arc-writer singleton; injectable for tests,
   * failures are swallowed (anchoring must not fail the purchase).
   */
  anchor?: (payloadJson: string, topic: string) => Promise<string>;
}

/** Emit the companion buy anchor; best-effort, never throws. */
async function anchorBuy(
  anchor: ((p: string, t: string) => Promise<string>) | undefined,
  payload: Record<string, unknown>,
): Promise<void> {
  const w = anchor ?? getArcEventLogWriter()?.writer;
  if (!w) return;
  try {
    await w(JSON.stringify(payload), "fxdelta-buy");
  } catch {
    // anchoring is auxiliary — purchase already settled
  }
}

/* ------------------------------ catalog/quote ---------------------------- */

/** Free catalog fetch — pick a capability by platform/description. */
export async function fetchCatalog(
  opts: BuyGatewayOptions = {},
): Promise<unknown> {
  const res = await (opts.fetcher ?? defaultFetcher)(BUY_CATALOG_URL);
  if (res.status !== 200) {
    throw new Error(`buy catalog ${res.status}`);
  }
  return res.json();
}

/**
 * Free 402 quote — POST the exact body WITHOUT payment. The challenge
 * (accepts[].maxAmountRequired) is the price authority; catalog prices
 * are indicative only. Callers MUST quote before pay().
 */
export async function buyQuote(
  url: string,
  method: string,
  body: string | undefined,
  opts: BuyGatewayOptions = {},
): Promise<BuyQuote> {
  const res = await (opts.fetcher ?? defaultFetcher)(url, {
    method,
    body,
  });
  if (res.status !== 402) {
    throw new Error(
      `quote expected 402, got ${res.status} — endpoint not paid?`,
    );
  }
  const raw = (await res.json()) as {
    accepts?: { amount?: string; maxAmountRequired?: string }[];
    amount?: string;
    maxAmountRequired?: string;
  };
  // C-2 (arc-audit): derive the ceiling through the SAME normalization
  // the gate uses — `amount ?? maxAmountRequired` (V2 first), never
  // accepts[0]-anchored, never V1-field-only. The ceiling is the
  // highest offer amount; the gate's whole-challenge rule then proves
  // every signable entry shares the vetted terms.
  const entries =
    Array.isArray(raw.accepts) && raw.accepts.length > 0
      ? raw.accepts
      : [raw];
  let max: string | undefined;
  for (const e of entries) {
    const amt = e?.amount ?? e?.maxAmountRequired;
    if (typeof amt !== "string") continue;
    let norm: string;
    try {
      norm = normalizeAmount(amt);
    } catch {
      continue; // malformed entry — gate's blind-spot rule decides
    }
    if (max === undefined || BigInt(norm) > BigInt(max)) max = norm;
  }
  if (!max) {
    throw new Error("402 challenge missing usable amount/maxAmountRequired");
  }
  return {
    url,
    method,
    body,
    maxAmount: atomicToUnits(max),
    maxAmountAtomic: max,
    raw,
  };
}

/* --------------------------- failure classify ---------------------------- */

const TX_RE = /0x[0-9a-fA-F]{64}/;

/**
 * Money-path taxonomy (257-16, H-6 — x402 «Timeouts and Safe Retries»:
 * once the PAYMENT-SIGNATURE could have left the process, the settle
 * outcome is UNKNOWN and the purchase must never be auto-repaid):
 *
 *   pre-signature, structural 402 challenge → "refused"   (retryable)
 *   payment trace or any other non-zero output → "uncertain" (never)
 */
export function classifyBuyFailure(r: ExecResult): BuyClass {
  const text = `${r.stdout}\n${r.stderr}`;
  // Payment trace: tx hash, signature header echo or upstream
  // non-retryable markers — the signature may have left, money may be
  // on-chain regardless of any 4xx/503 text accompanying it.
  if (
    TX_RE.test(text) ||
    /PAYMENT-SIGNATURE|settle_uncertain|provision_failed/i.test(text) ||
    /"retryable"\s*:\s*false/.test(text)
  ) {
    return "uncertain"; // money may have moved — never retry
  }
  // "refused" ONLY on a structural pre-signature signal: the CLI printed
  // a fresh 402 payment-required challenge and no payment trace. A bare
  // 4xx/503 line after spawn is post-signature seller output (H-6).
  if (/PAYMENT-REQUIRED|"x402Version"/i.test(text)) {
    return "refused"; // nothing signed — safe to retry
  }
  // Network interruption after payment is also "unknown" upstream.
  return "uncertain";
}

/* --------------------------------- pay ----------------------------------- */

/**
 * Pay for a quoted call via `buy curl`. Enforces the owner wallet
 * envelope BEFORE spawning the CLI — a denied quote never reaches the
 * network. `retries` counts ONLY pre-settlement refusals.
 */
export async function buyPay(
  quote: BuyQuote,
  wallet: string,
  refId: string,
  opts: BuyGatewayOptions & { maxRetries?: number } = {},
): Promise<BuyResult> {
  const runner = opts.runner ?? defaultRunner;
  const deps = opts.gate === undefined ? _deps : opts.gate;
  const amountUsd = Number(quote.maxAmount);

  // Kill-switch — cheapest gate, before any registry/ledger work.
  if (process.env.BUY_GATEWAY_ENABLED !== "true") {
    return { status: "disabled", attempts: 0 };
  }
  if (!deps || !isAddress(wallet)) {
    return { status: "denied", deny: { error: "buy_gate_unwired" }, attempts: 0 };
  }
  const w = wallet.toLowerCase() as `0x${string}`;
  const ctx: SpendDenyCtx = {
    wallet: w,
    address: w,
    amountUsd,
    kind: "buy-gateway",
    refId,
    // 257-4: buy-gateway holds are amount-holds (fingerprint-free).
    approvalReason: "amount_threshold",
  };

  const rec = await deps.registry.get(w);
  if (!rec?.active) {
    return {
      status: "denied",
      deny: { error: "wallet_not_registered" },
      attempts: 0,
    };
  }
  // 176-4 kill-switch first (order mirrors enforcer.begin).
  if (rec.suspended) {
    return {
      status: "denied",
      deny: await emitSuspendedDeny(deps.ledger, ctx),
      attempts: 0,
    };
  }
  const caps = rec.envelope;
  if (
    caps.allowedKinds &&
    !caps.allowedKinds.includes("buy-gateway")
  ) {
    return {
      status: "denied",
      deny: await emitKindDeny(
        deps.ledger,
        ctx,
        caps.allowedKinds,
      ),
      attempts: 0,
    };
  }
  // 257-5: derive the deal binding ONCE — the selected accepts[] offer
  // is the terms the CLI will sign; its fingerprint keys any
  // counterparty permit AND re-verifies it on the consume path.
  const deal = bindDeal(quote, w);
  const cpMode = opts.counterparty?.mode ?? counterpartyModeFromEnv();

  // 257-14 (H-1) park-commit: a live approved permit SHORT-CIRCUITS
  // its gate, but is CONSUMED only after every gate passed — right
  // before reserve. Consuming up-front burned a permit whenever a
  // later gate parked, which livelocked a WARN+amountAbove deal
  // (each call burned one permit and parked the other kind).
  // Expired approved permits don't count — the gate runs and re-holds.
  let amountPermit: SpendApproval | undefined;
  let dealPermit: SpendApproval | undefined;
  if (deps.approvals) {
    const now = Date.now();
    const approved = (await deps.approvals.listByWallet(w, "approved")).filter(
      (a) => a.expiresAt > now,
    );
    amountPermit = approved.find(
      (a) =>
        a.amountUsd === amountUsd &&
        a.kind === "buy-gateway" &&
        a.refId === refId &&
        (a.approvalReason ?? "amount_threshold") === "amount_threshold",
    );
    // N-7: cp permits exist only for enforce — off/shadow never consume
    // (shadow still runs the gate below for the decision record).
    if (cpMode === "enforce" && deal.fingerprint) {
      dealPermit = approved.find(
        (a) => a.dealFingerprint === deal.fingerprint,
      );
    }
  }
  // Order mirrors enforcer.begin: caps check → hold → reserve.
  const verdict = await checkEnvelope(deps.ledger, caps, w, amountUsd);
  if (!verdict.allow) {
    return {
      status: "denied",
      deny: await emitSpendDeny(deps.ledger, verdict.deny, ctx),
      attempts: 0,
    };
  }
  // 257-14 (N-11): counterparty gate BEFORE the amount-hold — a
  // counterparty deny must not waste an owner approval round on an
  // amount permit the deal can never use.
  if (cpMode !== "off") {
    const cpDeps = {
      checker: opts.counterparty?.checker ?? getCounterpartyChecker(),
      policy: opts.counterparty?.policy ?? createCounterpartyPolicy(),
      ledger: deps.ledger,
      approvals: deps.approvals,
      approvalTtlMs: deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS,
      mode: cpMode,
    };
    // A live fp-permit skips the hold but NOT the check (H-3):
    // consume-time re-verifies BLOCK against a fresh assessment.
    const gate =
      dealPermit && cpMode === "enforce"
        ? await counterpartyPermitRecheck(cpDeps, ctx, deal, quote.url)
        : await counterpartyGate(cpDeps, ctx, quote, deal);
    if (gate.action !== "pass") {
      return {
        status: gate.action === "hold" ? "approval_required" : "denied",
        deny: gate.deny,
        attempts: 0,
      };
    }
  }
  // 176-8: approved amount permit bypasses the hold (consumed at
  // commit below — a live-but-unconsumed permit is what matters here).
  if (
    !amountPermit &&
    deps.approvals &&
    caps.approvalAboveUsd !== undefined &&
    amountUsd > caps.approvalAboveUsd
  ) {
    return {
      status: "approval_required",
      deny: await tryApprovalHold(
        deps.approvals,
        ctx,
        deps.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS,
      ),
      attempts: 0,
    };
  }
  // Park-commit (H-1): every gate passed — consume the permits that
  // short-circuited them. consume() re-verifies the fingerprint
  // atomically (a changed offer produces a different fp and can never
  // consume); a false means the permit was lost to expiry or a
  // concurrent consume — honest deny, no money moved yet.
  if (dealPermit) {
    const ok = await deps.approvals!.consume(dealPermit.id, deal.fingerprint);
    if (!ok) {
      return {
        status: "denied",
        deny: { error: "approval_permit_lost", approvalId: dealPermit.id },
        attempts: 0,
      };
    }
  }
  if (amountPermit) {
    const ok = await deps.approvals!.consume(amountPermit.id);
    if (!ok) {
      return {
        status: "denied",
        deny: { error: "approval_permit_lost", approvalId: amountPermit.id },
        attempts: 0,
      };
    }
  }
  const entry: SpendEntry = await insertReserved(
    deps.ledger,
    w,
    amountUsd,
    "buy-gateway",
    refId,
    rec.venueId,
  );

  // ─── paid call — envelope reserved, spawn the CLI ───────────────
  const maxRetries = opts.maxRetries ?? 1; // one retry on refusal only
  let attempts = 0;
  // Dry-run on Celo Sepolia: `-s` is a GLOBAL buy flag — must sit
  // before `curl` (everything after is forwarded to curl itself).
  const sandbox =
    process.env.BUY_SANDBOX === "1" || process.env.BUY_SANDBOX === "true";
  const args = (q: BuyQuote) =>
    [
      "--yes",
      `@celo/buy@${BUY_CLI_VERSION}`,
      ...(sandbox ? ["-s"] : []),
      "curl",
      "--max-amount",
      q.maxAmount,
      ...(q.method !== "GET" ? ["--request", q.method] : []),
      ...(q.body ? ["--data", q.body] : []),
      q.url,
    ] as string[];

  for (;;) {
    attempts++;
    let r: ExecResult;
    try {
      r = await runner(args(quote));
    } catch (e) {
      // Process-level failure (spawn error / network cut) — settlement
      // state unknown → fail-closed, entry stays flagged for review.
      await deps.ledger.transition(entry.id, "failed");
      return {
        status: "uncertain",
        output: String(e),
        attempts,
      };
    }
    if (r.code === 0) {
      const txHash = TX_RE.exec(r.stdout)?.[0];
      // M-10: the payment already settled — a ledger failure must
      // surface as a typed "uncertain" for manual reconcile, never an
      // exception a caller could interpret as safe-to-retry.
      try {
        await deps.ledger.transition(
          entry.id,
          "settled",
          txHash as `0x${string}` | undefined,
        );
      } catch (e) {
        return {
          status: "uncertain",
          txHash,
          output: `payment settled but ledger transition failed: ${String(e)}`,
          attempts,
        };
      }
      void anchorBuy(opts.anchor, {
        kind: "buy-gateway",
        refId,
        wallet: w,
        amountUsd,
        purchaseTxHash: txHash ?? null,
        url: quote.url,
        method: quote.method,
        at: Date.now(),
      });
      return {
        status: "paid",
        txHash,
        output: r.stdout.trim(),
        attempts,
      };
    }
    const cls = classifyBuyFailure(r);
    if (cls === "refused" && attempts <= maxRetries) continue;
    // refused-out-of-retries or uncertain — release reservation, the
    // spend never settled (or is flagged uncertain for manual check).
    await deps.ledger.transition(
      entry.id,
      cls === "uncertain" ? "failed" : "released",
    );
    return {
      status: cls,
      output: r.stderr.trim() || r.stdout.trim(),
      attempts,
    };
  }
}
