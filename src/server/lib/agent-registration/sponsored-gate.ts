/**
 * SLICE-184-5 (EPIC-184): sponsored path gate — the EIP-191 intent is
 * only checked once cheap guards passed.
 * SLICE-184-8 (Arc Studio review): C-1 — v2 intent carries expiresAt
 * and every signature is single-use (store.consumeSignature, atomic
 * under the store mutex). M-1 — an EOA personal_sign is exactly 65
 * bytes; anything else is rejected before any crypto work.
 */
import { createHash } from "node:crypto";
import { ErrorCodes } from "../error-codes";
import { verifyRegisterIntent } from "./intent";
import type { RegisterInput } from "./register";

export interface SponsoredGateFailure {
  status: 400 | 429;
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  message: string;
}

/** EIP-191 personal_sign = 65 bytes → 132 hex chars + "0x". */
const SIG_LENGTH = 132;

/** sha256 hex of the signature — the consumed-signature store key. */
export function signatureHash(sig: string): string {
  return createHash("sha256").update(sig, "ascii").digest("hex");
}

export async function gateSponsoredRequest(args: {
  sponsoredEnabled: boolean;
  chainId: number;
  registryAddress: `0x${string}`;
  owner: `0x${string}`;
  signature?: string;
  /** Epoch seconds the user bound into the v2 intent (≤ now + 600s). */
  expiresAt?: number;
  name: string;
  allowSponsored: () => Promise<boolean>;
  /** Compensates allowSponsored when a later gate step fails. */
  releaseSponsored?: () => Promise<void>;
  /** Atomic single-use marker — false means the signature was replayed. */
  consumeSignature: (sigHash: string) => Promise<boolean>;
}): Promise<SponsoredGateFailure | null> {
  if (!args.sponsoredEnabled)
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "sponsored registration is not enabled",
    };
  const sig = args.signature;
  if (!sig || !/^0x[0-9a-fA-F]+$/.test(sig) || sig.length !== SIG_LENGTH)
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "signature (EIP-191 intent, 65-byte personal_sign) required with owner",
    };
  if (!Number.isInteger(args.expiresAt))
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "expiresAt (epoch seconds) required in the signed intent",
    };
  const ok = await verifyRegisterIntent({
    chainId: args.chainId,
    registryAddress: args.registryAddress,
    owner: args.owner,
    name: args.name,
    expiresAt: args.expiresAt!,
    signature: sig as `0x${string}`,
  });
  if (!ok)
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "invalid or expired registration intent signature",
    };
  if (!(await args.allowSponsored()))
    return {
      status: 429,
      code: ErrorCodes.SPONSORED_QUOTA_EXCEEDED,
      message: "daily sponsored-mint quota exhausted",
    };
  // Budget reserved — consume the signature atomically; a replay is
  // rejected and the reservation released (signature stays unconsumed
  // for the legitimate owner until budget frees).
  if (!(await args.consumeSignature(signatureHash(sig)))) {
    await args.releaseSponsored?.().catch(() => {});
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "registration intent signature already used",
    };
  }
  return null;
}

export type SponsoredBody = RegisterInput & {
  signature?: string;
  expiresAt?: number;
};
