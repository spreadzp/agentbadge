/**
 * SLICE-184-5 (EPIC-184): sponsored-registration request gate.
 *
 * Order (D-184-10 + slice AC):
 *   1. not enabled → 400 (explicit refusal, not silent fallback)
 *   2. missing/malformed signature → 400
 *   3. EIP-191 intent mismatch → 400
 *   4. global daily treasury budget (sponcap:<day>) → 429
 *      sponsored_quota_exceeded
 *
 * Runs AFTER the per-IP sybil regcap in the route — budget spend is
 * only checked once cheap guards passed.
 */
import { ErrorCodes } from "../error-codes";
import { verifyRegisterIntent } from "./intent";
import type { RegisterInput } from "./register";

export interface SponsoredGateFailure {
  status: 400 | 429;
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  message: string;
}

export async function gateSponsoredRequest(args: {
  sponsoredEnabled: boolean;
  chainId: number;
  registryAddress: `0x${string}`;
  owner: `0x${string}`;
  signature?: string;
  name: string;
  allowSponsored: () => Promise<boolean>;
}): Promise<SponsoredGateFailure | null> {
  if (!args.sponsoredEnabled)
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "sponsored registration is not enabled",
    };
  const sig = args.signature;
  if (!sig || !/^0x[0-9a-fA-F]+$/.test(sig))
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "signature (EIP-191 intent) required with owner",
    };
  const ok = await verifyRegisterIntent({
    chainId: args.chainId,
    registryAddress: args.registryAddress,
    owner: args.owner,
    name: args.name,
    signature: sig as `0x${string}`,
  });
  if (!ok)
    return {
      status: 400,
      code: ErrorCodes.INVALID_INPUT,
      message: "invalid registration intent signature",
    };
  if (!(await args.allowSponsored()))
    return {
      status: 429,
      code: ErrorCodes.SPONSORED_QUOTA_EXCEEDED,
      message: "daily sponsored-mint quota exhausted",
    };
  return null;
}

export type SponsoredBody = RegisterInput & { signature?: string };
