/**
 * EaaS (Evaluator-as-a-Service) env section — EPIC-154, SLICE-154-1.
 *
 * Whole feature is gated behind ARC_EAAS_ENABLED (codebase boolean
 * convention: "true" enables; absent/anything else disables). When enabled,
 * ARC_VERDICT_SIGNER_KEY is required — the EIP-712 verdict signer EOA
 * (deliberately NOT ARC_EVALUATOR_KEY, which settles escrow jobs).
 *
 * ARC_EAAS_STORE picks the VerdictStore backend: json (default) | sqlite.
 */

import type { EaasEnvConfig } from "./types";
import { booleanFlag, requiredString } from "./validators";

const KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;

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

  if (!signerKey) return undefined;
  return { enabled: true, signerKey, store };
}
