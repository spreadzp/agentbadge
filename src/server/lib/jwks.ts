import { didKeyMaterialFromEnv, DID_VM_FRAGMENT } from "./agent-discovery/did-key";
import { BASE_URL } from "./page-meta";

export interface JwkKey {
  kty: string;
  use: string;
  alg: string;
  kid: string;
  crv: string;
  x: string;
}

export interface Jwks {
  keys: JwkKey[];
}

/**
 * SLICE-178-7: real Ed25519 public key from DID_SIGNING_KEY — the same
 * key material that backs the did:web document's verificationMethod.
 * No key configured → empty set (honest absence beats a stub).
 */
export function getJwks(): Jwks {
  const material = didKeyMaterialFromEnv();
  if (!material) return { keys: [] };
  return {
    keys: [
      {
        kty: material.publicJwk.kty,
        use: "sig",
        alg: "EdDSA",
        // kid must equal the did:web verification-method id — that's the
        // kid the DID Configuration VC-JWT header carries, and jose's
        // createLocalJWKSet selects keys by exact kid match.
        kid: `did:web:${new URL(BASE_URL).host}${DID_VM_FRAGMENT}`,
        crv: material.publicJwk.crv,
        x: material.publicJwk.x,
      },
    ],
  };
}
