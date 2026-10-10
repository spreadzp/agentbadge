/**
 * SLICE-184-5 (EPIC-184): sponsored-registration intent proof.
 * SLICE-184-8 (Arc Studio review C-1): v2 intent adds `expiresAt` — the
 * signature is valid for at most INTENT_TTL_SEC after issue, and the
 * store marks each signature hash consumed on first use (replay-proof).
 *
 * The IdentityRegistry has no meta-tx/registerFor — only register(uri)
 * → msg.sender. The treasury relayer therefore submits register() +
 * transferFrom(ops → user) and pays gas for both (D-184-10). The user
 * proves consent off-chain by signing an EIP-191 `personal_sign`
 * message over a canonical intent — no USDC, no on-chain action.
 */
import { verifyMessage } from "viem";

/** Fresh signatures only — anything older/wider is a replay surface. */
export const INTENT_TTL_SEC = 600;
export const INTENT_VERSION = "agentbadge:register:v2";

/**
 * Canonical EIP-191 message the user's wallet must sign to prove
 * consent to own the minted ERC-8004 NFT. Newline-joined to keep
 * fields unambiguous. `expiresAt` is epoch seconds supplied by the
 * caller (wallet UX shows the deadline); the server enforces
 * 0 < expiresAt - now <= INTENT_TTL_SEC.
 */
export function buildRegisterIntent(args: {
  chainId: number;
  registryAddress: `0x${string}`;
  owner: `0x${string}`;
  name: string;
  expiresAt: number;
}): string {
  return [
    INTENT_VERSION,
    `eip155:${args.chainId}`,
    args.registryAddress.toLowerCase(),
    args.owner.toLowerCase(),
    args.name,
    String(args.expiresAt),
  ].join("\n");
}

/**
 * Verify the EIP-191 signature of `buildRegisterIntent` against the
 * claimed `owner`. Returns false on any malformed input — callers map
 * that to invalid_input, never to a silent bypass.
 */
export async function verifyRegisterIntent(args: {
  chainId: number;
  registryAddress: `0x${string}`;
  owner: `0x${string}`;
  name: string;
  expiresAt: number;
  signature: `0x${string}`;
  /** Defaults to Date.now() — injectable for tests. */
  nowMs?: number;
}): Promise<boolean> {
  try {
    const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000);
    if (
      !Number.isInteger(args.expiresAt) ||
      args.expiresAt <= nowSec ||
      args.expiresAt > nowSec + INTENT_TTL_SEC
    ) {
      return false;
    }
    const message = buildRegisterIntent(args);
    return await verifyMessage({
      address: args.owner,
      message,
      signature: args.signature,
    });
  } catch {
    return false;
  }
}
