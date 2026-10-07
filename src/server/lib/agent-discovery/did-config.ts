/**
 * SLICE-178-7 (MYPROJ-2587): signed DID Configuration (DIF spec).
 *
 * `/.well-known/did-configuration.json` returns `{ linked_dids: [vcJwt] }`
 * where the VC-JWT is a DomainLinkageCredential proving control of the
 * origin. VC-JWT over Linked Data proofs — no JSON-LD machinery needed.
 *
 * Zero IO: the PKCS8 key and all claims are injected; this module only
 * signs. The impure edge (env + jose importPKCS8) lives in the route.
 */

import { importPKCS8, SignJWT } from "jose";
import { DID_VM_FRAGMENT } from "./did-key";

export interface DomainLinkageParams {
  /** PKCS8 private key — PEM or raw base64 DER (Ed25519). */
  pkcs8: string;
  /** did:web identifier, e.g. did:web:agentbadge.xyz. */
  did: string;
  /** Verified origin, e.g. https://agentbadge.xyz. */
  origin: string;
  /** Injected clock (tests); defaults to now. */
  now?: Date;
}

/**
 * Sign a DomainLinkageCredential as VC-JWT (EdDSA).
 * iss == sub == DID; credentialSubject.origin == origin; exp = now + 1y.
 */
export async function signDomainLinkageCredential(
  params: DomainLinkageParams,
): Promise<string> {
  const key = await importPKCS8(params.pkcs8, "EdDSA");
  const now = Math.floor((params.now ?? new Date()).getTime() / 1000);
  const vmId = `${params.did}${DID_VM_FRAGMENT}`;

  return new SignJWT({
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "DomainLinkageCredential"],
      credentialSubject: { id: params.did, origin: params.origin },
      issuer: params.did,
    },
  })
    .setProtectedHeader({ alg: "EdDSA", kid: vmId, typ: "JWT" })
    .setIssuer(params.did)
    .setSubject(params.did)
    .setIssuedAt(now)
    .setExpirationTime(now + 365 * 24 * 60 * 60)
    .sign(key);
}
