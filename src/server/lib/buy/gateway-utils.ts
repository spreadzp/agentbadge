// Leaf helpers for the buy gateway — runner/fetcher plumbing, atomic→
// units conversion, the money-path failure taxonomy and the onchain
// buy anchor. Extracted from gateway.ts (token-limit seam); that file
// re-exports the public surface so imports stay unchanged.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

import { normalizeNetwork } from "@agentbadge/circle-payments";
import { getArcEventLogWriter } from "../fx-delta/arc-writer";

/* ------------------------------- runner ---------------------------------- */

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process runner — tests substitute a mock. */
export type BuyRunner = (args: string[]) => Promise<ExecResult>;

export const defaultRunner: BuyRunner = (args) =>
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

/* ------------------------------- fetcher --------------------------------- */

export type BuyFetcher = (
  url: string,
  init?: { method?: string; body?: string },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * N-10 SSRF caveat: this fetcher follows ANY caller-supplied URL —
 * it is the buyer's own fetch of a seller's 402 challenge, not a
 * server-side resource proxy. Keep it that way: never reuse it for
 * user-driven outbound fetches without an allowlist.
 */
export const defaultFetcher: BuyFetcher = async (url, init) => {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    ...(init?.body
      ? { headers: { "content-type": "application/json" }, body: init.body }
      : {}),
  });
  return { status: res.status, json: () => res.json() };
};

/* ------------------------------- units ----------------------------------- */

/** Asset decimals by NORMALIZED network (M-9). eip155 stables are
 *  6-dec; BNB USD1 is 18-dec; Stellar is 7-dec. An unknown namespace
 *  returns -1 — the caller treats that as uncomparable, never a
 *  silent under-cap conversion (audit M-9). */
const ASSET_DECIMALS: Record<string, number> = {
  "eip155:56": 18, // BNB Chain — USD1 is 18-dec
  "stellar:pubnet": 7,
  "stellar:testnet": 7,
};
export function decimalsForNetwork(network: string): number {
  let n: string;
  try {
    n = normalizeNetwork(network);
  } catch {
    return -1;
  }
  if (ASSET_DECIMALS[n] !== undefined) return ASSET_DECIMALS[n];
  if (n.startsWith("eip155:")) return 6;
  return -1; // unknown namespace — refuse to guess
}

const ATOMIC_RE = /^\d{1,78}$/; // M-2/N-4: digits only, ≤ uint256 width

/** atomic → human token units, precision-safe via bigint.
 *  M-2: strict `^\d+$` — negative/hex/NaN/empty is a typed throw,
 *  never a silent `BigInt` coercion into caps or the ledger. */
export function atomicToUnits(atomic: string, decimals = 6): string {
  const t = atomic.trim();
  if (!ATOMIC_RE.test(t)) {
    throw new Error(`invalid atomic amount: ${JSON.stringify(atomic)}`);
  }
  const scale = 10n ** BigInt(decimals);
  const v = BigInt(t);
  const whole = v / scale;
  const frac = (v % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/* --------------------------- failure classify ---------------------------- */

export type BuyClass =
  | "paid" // settled — output usable
  | "refused" // pre-signature 402 challenge — safe to retry later
  | "uncertain"; // settle state unknown — NEVER retry automatically

export const TX_RE = /0x[0-9a-fA-F]{64}/;

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

/* -------------------------------- anchor --------------------------------- */

/**
 * H-5: the onchain payload may carry only `origin + pathname` — the
 * raw quote URL can embed query/credentials/secret path material that
 * would be irrevocably public on a chain. Unparseable → sha256 only.
 */
export function anchorSafeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  }
}

/** Emit the companion buy anchor; best-effort, never throws. */
export async function anchorBuy(
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
