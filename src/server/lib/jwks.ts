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

export function getJwks(): Jwks {
  return {
    keys: [
      {
        kty: "OKP",
        use: "sig",
        alg: "EdDSA",
        kid: "agentbadge-2026",
        crv: "Ed25519",
        x: "agentbadge.xyz",
      },
    ],
  };
}
