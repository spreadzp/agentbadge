/**
 * DID-auth signature verification (EPIC-82 SLICE-82-1). Split out of
 * did-auth.ts (SLICE-145-6, max-lines).
 *
 * defaultVerifySignature fetches the account's public keys from the Hedera
 * Mirror Node — cached at hedera:acct:{accountId} TTL 300s since
 * SLICE-145-5 so a signed mutation doesn't pay an external fetch per call.
 */

import { tryGetCache } from "../lib/cache";

export type VerifySignatureFn = (
  challenge: string,
  signature: string,
  accountId: string,
) => Promise<boolean>;

/**
 * Default signature verifier.
 *
 * Fetches the account's public key from the Hedera Mirror Node and verifies
 * the signature. Supports both ECDSA (via ethers) and ED25519 (via Hedera SDK).
 *
 * In production, this makes a Mirror Node API call to:
 *   GET {mirrorBase}/api/v1/accounts/{accountId}
 *
 * The signature is expected to be a hex-encoded Ed25519 or ECDSA signature
 * over the raw challenge bytes (NOT EIP-191 prefixed).
 */
export async function defaultVerifySignature(
  challenge: string,
  signature: string,
  accountId: string,
): Promise<boolean> {
  const mirrorBase = process.env.HEDERA_NETWORK === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

  try {
    // Mirror Node key cache — a signed mutation shouldn't pay an external
    // fetch every time. Keys rotate rarely; 5min staleness is acceptable.
    const cacheKey = `hedera:acct:${accountId}`;
    const cache = tryGetCache();
    let keys: Array<{ _type: string; key: string }> | null = null;
    if (cache) {
      keys = await cache.get<Array<{ _type: string; key: string }>>(cacheKey);
    }
    if (!keys) {
      const resp = await fetch(`${mirrorBase}/api/v1/accounts/${accountId}`);
      if (!resp.ok) return false;

      const data = await resp.json() as {
        keys?: Array<{ _type: string; key: string }>;
        key?: { _type: string; key: string };
      };

      // Mirror Node returns either a single key or an array of keys
      keys = data.keys ?? (data.key ? [data.key] : []);
      if (keys.length === 0) return false;
      if (cache) await cache.set(cacheKey, keys, { ttlSec: 300 });
    }

    const challengeBytes = new TextEncoder().encode(challenge);
    const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
    const sigBytes = Buffer.from(sigHex, "hex");

    for (const keyInfo of keys) {
      const keyType = keyInfo._type;
      const pubKeyHex = keyInfo.key;

      try {
        if (keyType === "ED25519") {
          // Use @hashgraph/sdk for ED25519 verification
          const { PublicKey } = await import("@hashgraph/sdk");
          const pubKey = PublicKey.fromString(`302a300506032b6570032100${pubKeyHex}`);
          const verified = pubKey.verify(sigBytes, challengeBytes);
          if (verified) return true;
        } else if (keyType === "ECDSA_secp256k1") {
          // Use ethers for ECDSA verification (EIP-191 personal Sign)
          const { ethers } = await import("ethers");
          // ethers expects 0x-prefixed signature and recovers address
          const sig = `0x${sigHex}`;
          const recovered = ethers.verifyMessage(
            new TextEncoder().encode(challenge),
            ethers.Signature.from(sig),
          );
          // Recover the address from the public key
          const pubKey = `0x${pubKeyHex}`;
          const expectedAddr = ethers.computeAddress(pubKey);
          if (recovered.toLowerCase() === expectedAddr.toLowerCase()) return true;
        }
      } catch {
        // Key type mismatch or verification error — try next key
        continue;
      }
    }

    return false;
  } catch {
    return false;
  }
}
