/**
 * Celo x402 assets, payload parsing, replay store (SLICE-191-6).
 * Split from celo-settle.ts to stay under the 300-line file cap.
 */

import { parseAbi, type Hex } from "viem";

export const CELO_X402_NETWORK = "eip155:42220";
export const CELO_X402_SCHEME = "exact";

/** EIP-3009 TransferWithAuthorization domain per accepted asset (191-0
 *  spike verified name/version onchain). */
export const CELO_X402_ASSETS = {
  USDC: {
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    name: "USDC",
    version: "2",
    decimals: 6,
  },
  USDT: {
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    name: "Tether USD",
    version: "1",
    decimals: 6,
  },
  // USA₮ 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771 ("Tether America
  // USD"/"1") — track 2b reverse: uncomment to accept.
} as const;

export const TWITH_AUTH_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

export const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface PaymentPayload {
  x402Version?: number;
  scheme?: string;
  network?: string;
  payload?: {
    authorization?: Authorization;
    signature?: string;
  };
  authorization?: Authorization;
  signature?: string;
}

export function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    return JSON.parse(
      Buffer.from(header, "base64").toString("utf8"),
    ) as PaymentPayload;
  } catch {
    return null;
  }
}

export function extractAuth(p: PaymentPayload): {
  auth: Authorization;
  signature: Hex;
} | null {
  const auth = p.payload?.authorization ?? p.authorization;
  const sig = p.payload?.signature ?? p.signature;
  if (!auth || !sig) return null;
  return { auth, signature: sig as Hex };
}

export function assetByAddress(addr: string) {
  return Object.values(CELO_X402_ASSETS).find(
    (a) => a.address.toLowerCase() === addr.toLowerCase(),
  );
}

/** Single-use nonce claim — atomic (cache.incr like CacheTxHashStore). */
export interface NonceStore {
  claim(key: string): Promise<boolean>;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Set<string>();
  async claim(key: string): Promise<boolean> {
    const k = key.toLowerCase();
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    return true;
  }
}

// ─── Authorization checks (verify half of the settle rail) ──────

export interface TypedDataVerifier {
  verifyTypedData(args: unknown): Promise<boolean>;
}

export interface AuthRequirements {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
}

/**
 * Static + signature checks on an EIP-3009 authorization.
 * Returns payer on success; never throws on bad input.
 * Does NOT claim the nonce — callers decide when replay burns.
 */
export async function checkAuthorization(
  decoded: PaymentPayload | null,
  requirements: AuthRequirements,
  pc: TypedDataVerifier,
  chainId: number,
  nowSec: number,
): Promise<
  | { ok: true; auth: Authorization; signature: Hex; payer: string }
  | { ok: false; reason: string }
> {
  if (!decoded) return { ok: false, reason: "bad_payment_header" };
  if (decoded.scheme && decoded.scheme !== requirements.scheme) {
    return { ok: false, reason: "scheme_mismatch" };
  }
  if (decoded.network && decoded.network !== requirements.network) {
    return { ok: false, reason: "network_mismatch" };
  }
  const ex = extractAuth(decoded);
  if (!ex) return { ok: false, reason: "missing_authorization" };
  const { auth, signature } = ex;

  if (auth.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
    return { ok: false, reason: "payto_mismatch" };
  }
  try {
    if (BigInt(auth.value) < BigInt(requirements.maxAmountRequired)) {
      return { ok: false, reason: "amount_insufficient" };
    }
  } catch {
    return { ok: false, reason: "amount_invalid" };
  }
  if (Number(auth.validAfter) > nowSec) {
    return { ok: false, reason: "not_yet_valid" };
  }
  if (Number(auth.validBefore) <= nowSec) {
    return { ok: false, reason: "expired" };
  }

  // EIP-712 verify against the asset's own domain (USDC "USDC"/"2",
  // USDT "Tether USD"/"1" — see 191-0 domain spike).
  const dom = assetByAddress(requirements.asset) ?? CELO_X402_ASSETS.USDC;
  try {
    const ok = await pc.verifyTypedData({
      address: auth.from as `0x${string}`,
      domain: {
        name: dom.name,
        version: dom.version,
        chainId,
        verifyingContract: dom.address as `0x${string}`,
      },
      types: EIP712_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from,
        to: auth.to,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as `0x${string}`,
      },
      signature,
    });
    if (!ok) return { ok: false, reason: "invalid_signature" };
  } catch (err) {
    return {
      ok: false,
      reason: `signature_check_failed: ${(err as Error).message}`,
    };
  }
  return { ok: true, auth, signature, payer: auth.from.toLowerCase() };
}

/** Remote facilitator call (D-191-1 fallback, api.x402.celo.org). */
export async function remoteFacilitatorCall(
  baseUrl: string,
  path: "verify" | "settle",
  paymentHeader: string,
  requirements: AuthRequirements,
  apiKey: string | undefined,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const res = await fetcher(`${baseUrl}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({
      x402Version: 2,
      paymentHeader,
      paymentRequirements: requirements,
    }),
  });
  return (await res.json()) as Record<string, unknown>;
}
