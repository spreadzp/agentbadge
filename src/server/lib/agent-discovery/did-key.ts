/**
 * SLICE-178-7 (MYPROJ-2587): DID signing key material.
 *
 * One Ed25519 key backs the platform identity surface:
 *   - DID document verificationMethod (`did.json`)
 *   - DID Configuration VC-JWT signature (`did-configuration.json`)
 *   - `/.well-known/jwks.json`
 *
 * `DID_SIGNING_KEY` is a SEPARATE role from money/verdict keys
 * (authority-split, EPIC-173) — compromise never touches funds.
 * Value: PKCS8, either PEM (`-----BEGIN PRIVATE KEY-----`) or raw
 * base64 DER. Rotation = new key + new kid (`agentbadge-YYYY-N`).
 *
 * Purity: `didKeyMaterialFromPkcs8` is pure; `didKeyMaterialFromEnv` is
 * the impure edge (env read + memoization) — used by collectSources,
 * the jwks route and the did-configuration route.
 */

import { ed25519 } from "@noble/curves/ed25519.js";

/** JWKS `kid` — bump on rotation (agentbadge-2026-1 → agentbadge-2027-1). */
export const DID_JWKS_KID = "agentbadge-2026-1";

/** DID document verification-method fragment (vm id = `${did}#key-1`). */
export const DID_VM_FRAGMENT = "#key-1";

/** DER prefix of an Ed25519 PKCS8 key (RFC 8410, seed appended). */
const ED25519_PKCS8_PREFIX = "302e020100300506032b657004220420";

export interface DidKeyMaterial {
  /** Public JWK (OKP/Ed25519) — safe to publish. */
  publicJwk: { kty: "OKP"; crv: "Ed25519"; x: string; kid: string };
  /** PEM-normalized PKCS8 — jose importPKCS8 requires the BEGIN/END armor. */
  pkcs8: string;
}

const bytesToBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

/**
 * Pure: PKCS8 (PEM or base64 DER) → Ed25519 public JWK.
 * The 32-byte seed is the trailing OCTET STRING of the 48-byte PKCS8;
 * the public key is derived on the curve. Returns null on garbage —
 * absence beats a broken identity surface (D-178-9).
 */
export function didKeyMaterialFromPkcs8(pkcs8: string): DidKeyMaterial | null {
  try {
    const der = pkcs8.includes("-----")
      ? pkcs8.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")
      : pkcs8.trim();
    const bytes = Buffer.from(der, "base64");
    const hex = bytes.toString("hex");
    if (!hex.startsWith(ED25519_PKCS8_PREFIX)) return null;
    const seed = bytes.subarray(bytes.length - 32);
    if (seed.length !== 32) return null;
    const pub = ed25519.getPublicKey(seed);
    // jose.importPKCS8 rejects raw base64 — always hand it PEM armor.
    const pemBody = der.replace(/(.{64})/g, "$1\n");
    const pem = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----`;
    return {
      publicJwk: {
        kty: "OKP",
        crv: "Ed25519",
        x: bytesToBase64Url(pub),
        kid: DID_JWKS_KID,
      },
      pkcs8: pem,
    };
  } catch {
    return null;
  }
}

// Memoized per env value so env swaps in tests/production rotate cleanly.
let cache: { env: string | undefined; material: DidKeyMaterial | null } | null =
  null;

/** Impure edge: read DID_SIGNING_KEY once per env value; null when unset/unparseable. */
export function didKeyMaterialFromEnv(
  env: string | undefined = process.env.DID_SIGNING_KEY,
): DidKeyMaterial | null {
  if (cache && cache.env === env) return cache.material;
  const material = env ? didKeyMaterialFromPkcs8(env) : null;
  cache = { env, material };
  return material;
}
