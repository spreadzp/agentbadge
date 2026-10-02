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

  if (!signerKey) return undefined;
  return {
    enabled: true,
    signerKey,
    store,
    verdictUsd,
    scanUsd,
    maxBytes,
    rateRpm,
  };
}
