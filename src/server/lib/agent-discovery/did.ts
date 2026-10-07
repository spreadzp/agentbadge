/**
 * SLICE-178-7 (MYPROJ-2587): did:web platform DID document builder.
 *
 * Platform DID = `did:web:<host>` (did-method-web): the domain itself is
 * the trust anchor, so the identity survives any chain migration
 * (Hedera → Base → Arc → whatever). Arc identities are NOT DIDs —
 * ERC-8004 references live in `alsoKnownAs` (and `erc8004-agent.json`).
 *
 * Zero IO (D-178-7): sources + key material are injected; the impure
 * edges are collectSources / did-key.ts.
 */

import type { DiscoverySources } from "./sources";

export interface DidWebKeyRef {
  /** Public JWK (OKP/Ed25519). */
  publicJwk: { kty: "OKP"; crv: "Ed25519"; x: string; kid?: string };
  /** Verification-method fragment, e.g. "#key-1". */
  fragment: string;
}

/**
 * Build the did:web DID document. Returns undefined when no key is
 * configured — absence beats a stale/unsigned doc (epic principle).
 */
export function buildDidWebDocument(
  src: DiscoverySources,
): Record<string, unknown> | undefined {
  const key = src.didKey;
  if (!key) return undefined;

  const host = new URL(src.baseUrl).host;
  const did = `did:web:${host}`;
  const b = src.baseUrl;
  const vmId = `${did}${key.fragment}`;
  const e = src.wellKnownEnv?.erc8004 ?? {
    chainId: 5042,
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    agentId: "0",
  };

  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: did,
    verificationMethod: [
      {
        id: vmId,
        type: "JsonWebKey",
        controller: did,
        publicKeyJwk: {
          kty: key.publicJwk.kty,
          crv: key.publicJwk.crv,
          x: key.publicJwk.x,
          // kid = verification-method id so jose jwtVerify against this
          // JWK matches the VC-JWT header kid without manual injection.
          kid: vmId,
        },
      },
    ],
    authentication: [vmId],
    assertionMethod: [vmId],
    // Arc-era identity anchors: ERC-8004 registry refs (not DIDs).
    alsoKnownAs: [
      `eip155:${e.chainId}:${e.registry}`,
      `eip155:${e.chainId}:${e.registry}:${e.agentId}`,
    ],
    service: [
      {
        id: `${did}#agent-card`,
        type: "A2A",
        serviceEndpoint: `${b}/.well-known/agent-card.json`,
      },
      {
        id: `${did}#mcp`,
        type: "MCP",
        serviceEndpoint: `${b}/mcp`,
      },
      {
        id: `${did}#x402`,
        type: "x402",
        serviceEndpoint: `${b}/.well-known/x402.json`,
      },
      {
        id: `${did}#api-catalog`,
        type: "ApiCatalog",
        serviceEndpoint: `${b}/.well-known/api-catalog`,
      },
      {
        id: `${did}#jwks`,
        type: "Jwks",
        serviceEndpoint: `${b}/.well-known/jwks.json`,
      },
    ],
  };
}
