/**
 * EaaS (Evaluator-as-a-Service) env section — EPIC-154, SLICE-154-1.
 *
 * Whole feature is gated behind ARC_EAAS_ENABLED (codebase boolean
 * convention: "true" enables; absent/anything else disables). When enabled,
 * ARC_VERDICT_SIGNER_KEY is required — the EIP-712 verdict signer EOA
 * (deliberately NOT ARC_EVALUATOR_KEY, which settles escrow jobs).
 *
 * ARC_EAAS_STORE picks the VerdictStore backend: json (default) | sqlite.
 *
 * SLICE-154-2 pricing + limits (pay-per-verdict x402):
 *   ARC_EAAS_VERDICT_USD / ARC_EAAS_SCAN_USD — atomic USDC (6 decimals),
 *     scan overrides the flat verdict price for the "readiness-scan" policy.
 *   ARC_EAAS_MAX_BYTES — deliverable.data cap (default 65536).
 *   ARC_EAAS_RATE_RPM — per-consumer AND global requests/min cap (default 60).
 *
 * SLICE-154-4 onchain anchoring:
 *   ARC_EAAS_MEMO_ANCHOR — 0 disables memo anchoring (default enabled).
 *   ARC_EAAS_ANCHOR_RETRIES — send attempts before status "failed" (default 3).
 *
 * SLICE-154-5 billing tiers (subscription + AccessPassNFT CLASS_EAAS=8):
 *   ARC_EAAS_TIER_BASIC_USD / ARC_EAAS_TIER_PRO_USD — atomic USDC prices.
 *   ARC_EAAS_TIER_QUOTAS — JSON tier→{quota,policies} map, e.g.
 *     {"basic":{"quota":100,"policies":["deliverable-present","hash-match"]},
 *      "pro":{"quota":1000,"policies":["*"]}}
 *
 * SLICE-154-6 async delivery + feeds:
 *   ARC_EAAS_WEBHOOK_SECRET — HMAC key for X-Verdict-Signature on webhook POSTs.
 *   ARC_EAAS_ASYNC_TIMEOUT_S — async verdict budget (default 120s).
 */

import type { EaasEnvConfig } from "./types";
import { booleanFlag, requiredString } from "./validators";

const KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;
const ATOMIC_USDC_RE = /^[0-9]+$/;

/** Atomic USDC (6 dec) → "$x.xx" dollar string understood by requirePayment. */
function atomicToUsd(atomic: string): string {
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `$${whole}.${frac}` : `$${whole}`;
}

function atomicPrice(
  name: string,
  fallbackAtomic: string,
  errors: string[],
): string {
  const raw = process.env[name] ?? fallbackAtomic;
  if (!ATOMIC_USDC_RE.test(raw)) {
    errors.push(`Invalid ${name}: expected atomic USDC integer, got "${raw}"`);
    return atomicToUsd(fallbackAtomic);
  }
  return atomicToUsd(raw);
}

function intVar(
  name: string,
  fallback: number,
  min: number,
  errors: string[],
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) {
    errors.push(`Invalid ${name}: expected integer >= ${min}, got "${raw}"`);
    return fallback;
  }
  return n;
}

export function loadEaas(errors: string[]): EaasEnvConfig | undefined {
  if (!booleanFlag("ARC_EAAS_ENABLED")) return undefined;

  const signerKey = requiredString("ARC_VERDICT_SIGNER_KEY", errors);
  if (signerKey && !KEY_RE.test(signerKey)) {
    errors.push(
      "Invalid ARC_VERDICT_SIGNER_KEY: expected 64-hex private key (optional 0x prefix)",
    );
    return undefined;
  }

  const rawStore = (process.env.ARC_EAAS_STORE ?? "json").toLowerCase();
  const store = rawStore === "sqlite" ? "sqlite" : "json";

  // SLICE-154-2: defaults — $0.01 flat verdict, $0.05 readiness-scan.
  const verdictUsd = atomicPrice("ARC_EAAS_VERDICT_USD", "10000", errors);
  const scanUsd = atomicPrice("ARC_EAAS_SCAN_USD", "50000", errors);
  const maxBytes = intVar("ARC_EAAS_MAX_BYTES", 65_536, 1, errors);
  const rateRpm = intVar("ARC_EAAS_RATE_RPM", 60, 1, errors);

  // SLICE-154-3: external job evaluation — $0.10 fee, 500k gas cap.
  const evalUsd = atomicPrice("ARC_EAAS_EVAL_USD", "100000", errors);
  const gasCap = intVar("ARC_EAAS_GAS_CAP", 500_000, 1, errors);

  // SLICE-154-4: onchain memo anchoring — on by default; explicit "0" off.
  const memoAnchor = (process.env.ARC_EAAS_MEMO_ANCHOR ?? "1") !== "0";
  const anchorRetries = intVar("ARC_EAAS_ANCHOR_RETRIES", 3, 1, errors);

  // SLICE-154-5: billing tiers — $5 basic / $25 pro monthly, quota JSON.
  const tierBasicUsd = atomicPrice("ARC_EAAS_TIER_BASIC_USD", "5000000", errors);
  const tierProUsd = atomicPrice("ARC_EAAS_TIER_PRO_USD", "25000000", errors);
  const tierQuotas = parseTierQuotas(errors);

  // SLICE-172-2: verdict hash-chain — on by default; explicit "0" off.
  // Writes .data/eaas-chain.json; no onchain calls (anchoring is 172-3).
  const chainEnabled = (process.env.ARC_CHAIN_ENABLED ?? "1") !== "0";

  // SLICE-154-6: async delivery — optional webhook HMAC secret + timeout.
  const webhookSecret = process.env.ARC_EAAS_WEBHOOK_SECRET || undefined;
  const asyncTimeoutSec = intVar("ARC_EAAS_ASYNC_TIMEOUT_S", 120, 1, errors);

  if (!signerKey) return undefined;
  return {
    enabled: true,
    signerKey,
    store,
    verdictUsd,
    scanUsd,
    maxBytes,
    rateRpm,
    evalUsd,
    gasCap,
    memoAnchor,
    anchorRetries,
    chainEnabled,
    tierBasicUsd,
    tierProUsd,
    tierQuotas,
    webhookSecret,
    asyncTimeoutSec,
  };
}

const DEFAULT_TIER_QUOTAS: Record<
  string,
  { quota: number; policies: string[] }
> = {
  basic: { quota: 100, policies: ["deliverable-present", "hash-match"] },
  pro: { quota: 1000, policies: ["*"] },
};

/** Parse ARC_EAAS_TIER_QUOTAS JSON; falls back to defaults on bad input. */
function parseTierQuotas(
  errors: string[],
): Record<string, { quota: number; policies: string[] }> {
  const raw = process.env.ARC_EAAS_TIER_QUOTAS;
  if (!raw) return DEFAULT_TIER_QUOTAS;
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      { quota?: unknown; policies?: unknown }
    >;
    const out: Record<string, { quota: number; policies: string[] }> = {};
    for (const [tier, def] of Object.entries(parsed)) {
      const quota = Number(def?.quota);
      const policies = Array.isArray(def?.policies)
        ? def.policies.filter((p): p is string => typeof p === "string")
        : null;
      if (!Number.isInteger(quota) || quota < 1 || !policies || !policies.length) {
        errors.push(
          `Invalid ARC_EAAS_TIER_QUOTAS entry "${tier}": needs integer quota >= 1 and non-empty policies[]`,
        );
        continue;
      }
      out[tier] = { quota, policies };
    }
    if (Object.keys(out).length === 0) {
      errors.push("Invalid ARC_EAAS_TIER_QUOTAS: no usable tier entries");
      return DEFAULT_TIER_QUOTAS;
    }
    return out;
  } catch {
    errors.push("Invalid ARC_EAAS_TIER_QUOTAS: not valid JSON");
    return DEFAULT_TIER_QUOTAS;
  }
}
