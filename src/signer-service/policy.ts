/**
 * EPIC-173 (SLICE-173-2): signer-service policy layer.
 *
 * The service holds the money key — a blind signer would be a wallet
 * drainer for anything that reaches the socket. Policy denies by
 * default (fail closed, D-173-4):
 *   SIGNER_ALLOW_TO        — csv destination allowlist (case-insensitive);
 *                            unset/empty → every sendTransaction denied;
 *                            literal "*" allows any destination (dev only)
 *   SIGNER_MAX_VALUE_WEI   — native value ceiling, default 0
 *   SIGNER_MAX_GAS         — estimated-gas ceiling, default 500000
 */

import { isAddress, type Hex } from "viem";

export type AllowTo = Set<`0x${string}`> | "any";

export interface SignerPolicy {
  allowTo: AllowTo;
  maxValueWei: bigint;
  maxGas: bigint;
}

export class PolicyDeniedError extends Error {
  constructor(readonly reason: string) {
    super(`policy denied: ${reason}`);
    this.name = "PolicyDeniedError";
  }
}

/** Parse SIGNER_ALLOW_TO — empty → deny-all set, "*" → "any". */
export function parseAllowTo(csv: string | undefined): AllowTo {
  const raw = (csv ?? "").trim();
  if (raw === "*") return "any";
  const out = new Set<`0x${string}`>();
  for (const part of raw.split(",")) {
    const addr = part.trim();
    if (!addr) continue;
    if (isAddress(addr)) out.add(addr.toLowerCase() as `0x${string}`);
  }
  return out;
}

export function loadPolicy(env: NodeJS.ProcessEnv = process.env): SignerPolicy {
  return {
    allowTo: parseAllowTo(env.SIGNER_ALLOW_TO),
    maxValueWei: BigInt(env.SIGNER_MAX_VALUE_WEI ?? "0"),
    maxGas: BigInt(env.SIGNER_MAX_GAS ?? "500000"),
  };
}

/** Throws PolicyDeniedError when a tx is outside the policy. */
export function checkSendPolicy(
  policy: SignerPolicy,
  tx: { to: `0x${string}`; data: Hex; value?: bigint },
  estimatedGas?: bigint,
): void {
  if (tx.value !== undefined && tx.value > policy.maxValueWei) {
    throw new PolicyDeniedError(
      `value ${tx.value} exceeds SIGNER_MAX_VALUE_WEI ${policy.maxValueWei}`,
    );
  }
  if (policy.allowTo !== "any" && !policy.allowTo.has(tx.to.toLowerCase() as `0x${string}`)) {
    throw new PolicyDeniedError(
      `destination ${tx.to} not in SIGNER_ALLOW_TO`,
    );
  }
  if (!isAddress(tx.to)) {
    throw new PolicyDeniedError(`malformed destination ${tx.to}`);
  }
  if (estimatedGas !== undefined && estimatedGas > policy.maxGas) {
    throw new PolicyDeniedError(
      `estimated gas ${estimatedGas} exceeds SIGNER_MAX_GAS ${policy.maxGas}`,
    );
  }
}
