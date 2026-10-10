/**
 * SLICE-184-5 (EPIC-184): sponsored-registration intent proof.
 *
 * The IdentityRegistry has no meta-tx/registerFor — only register(uri)
 * → msg.sender. The treasury relayer therefore submits register() +
 * transferFrom(ops → user) and pays gas for both (D-184-10). The user
 * proves consent off-chain by signing an EIP-191 `personal_sign`
 * message over a canonical intent — no USDC, no on-chain action.
 */
import { getAddress, verifyMessage } from "viem";

/**
 * Canonical EIP-191 message the user's wallet must sign to prove
 * consent to own the minted ERC-8004 NFT. Newline-joined to keep
 * fields unambiguous; wallet is checksummed before building.
 */
export function buildRegisterIntent(
  chainId: number,
  registryAddress: `0x${string}`,
  owner: `0x${string}`,
  name: string,
): string {
  return [
    "agentbadge:register:v1",
    `eip155:${chainId}`,
    registryAddress.toLowerCase(),
    getAddress(owner).toLowerCase(),
    name,
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
  signature: `0x${string}`;
}): Promise<boolean> {
  try {
    const message = buildRegisterIntent(
      args.chainId,
      args.registryAddress,
      args.owner,
      args.name,
    );
    return await verifyMessage({
      address: args.owner,
      message,
      signature: args.signature,
    });
  } catch {
    return false;
  }
}
