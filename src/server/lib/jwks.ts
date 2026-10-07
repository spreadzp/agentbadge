import { didKeyMaterialFromEnv } from "./agent-discovery/did-key";

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
        kid: material.publicJwk.kid,
        crv: material.publicJwk.crv,
        x: material.publicJwk.x,
      },
    ],
  };
}
