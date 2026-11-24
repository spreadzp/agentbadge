import { createHash } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { getConfig } from "../../config/env";
import { didKeyMaterialFromEnv, DID_VM_FRAGMENT } from "./agent-discovery/did-key";
import {
  MARKETPLACE_LISTINGS,
  type MarketplaceListing,
} from "./agent-discovery/marketplace-listings";

export interface DeploymentDescriptor {
  schema_version: string;
  deployment_id: string;
  network: string;
  passport_token_id: string;
  directory_topic_id: string;
  audit_topic_id: string;
  api_version: string;
  payment_protocol: string;
  facilitator: string;
  fee_catalog_url: string;
  error_catalog_url: string;
  trust_tiers_url: string;
  /** EPIC-242: external marketplaces where paid services are listed. */
  marketplace_listings: MarketplaceListing[];
  generated_at: string;
}

export function getDeploymentDescriptor(): DeploymentDescriptor {
  const config = getConfig();
  const baseUrl = process.env.BASE_URL ?? "https://agentbadge.xyz";

  return {
    schema_version: "1.0",
    deployment_id: baseUrl.replace(/^https?:\/\//, ""),
    network: `hedera:${config.hederaNetwork}`,
    passport_token_id: config.passportTokenId,
    directory_topic_id: config.directoryTopicId,
    audit_topic_id: config.auditTopicId,
    marketplace_listings: MARKETPLACE_LISTINGS,
    api_version: process.env.npm_package_version ?? "0.13.0",
    payment_protocol: "x402",
    facilitator: config.x402FacilitatorUrl,
    fee_catalog_url: `${baseUrl}/api/meta/fees`,
    error_catalog_url: `${baseUrl}/api/meta/errors`,
    trust_tiers_url: `${baseUrl}/api/meta/trust-tiers`,
    generated_at: new Date().toISOString(),
  };
}

// ─── Detached-JWS signature (SLICE-259-41, DeepSeek R5) ──────────────────────
// did:web key exists + kid is unified — but no artifact carried a signature,
// so the trust chain had nothing to verify. This signs the descriptor itself:
// payload claim `descriptor_sha256` = sha256 of the canonical doc (sorted
// keys, without `signature`), so an agent can recompute and compare, then
// verify the JWS against did:web:{host}#key-1. Absent without DID_SIGNING_KEY.

export interface DescriptorSignature {
  alg: "EdDSA";
  kid: string;
  /** Compact JWS; decoded payload carries `descriptor_sha256`. */
  jws: string;
  /** "sha256:<hex>" of the canonical descriptor — the signed input. */
  signing_input: string;
  canonicalization: string;
}

const CANONICALIZATION_SPEC =
  "sha256 hex of JSON.stringify(descriptor minus the 'signature' field, object keys recursively sorted, arrays in order)";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort()
        .map((k) => [k, sortKeysDeep(src[k])]),
    );
  }
  return value;
}

let signedCache: {
  pkcs8: string | null;
  value: Promise<DeploymentDescriptor & { signature?: DescriptorSignature }>;
} | null = null;

export function getSignedDeploymentDescriptor(): Promise<
  DeploymentDescriptor & { signature?: DescriptorSignature }
> {
  const material = didKeyMaterialFromEnv();
  const cacheKey = material?.pkcs8 ?? null;
  if (signedCache?.pkcs8 === cacheKey) return signedCache.value;
  const value = (async () => {
    const descriptor = getDeploymentDescriptor();
    if (!material) return descriptor;
    const canonical = JSON.stringify(sortKeysDeep(descriptor));
    const digest = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
    const kid = `did:web:${descriptor.deployment_id}${DID_VM_FRAGMENT}`;
    const key = await importPKCS8(material.pkcs8, "EdDSA");
    const jws = await new SignJWT({ descriptor_sha256: digest })
      .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
      .setIssuer(`did:web:${descriptor.deployment_id}`)
      .setSubject("deployment-descriptor")
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(key);
    return {
      ...descriptor,
      signature: {
        alg: "EdDSA" as const,
        kid,
        jws,
        signing_input: digest,
        canonicalization: CANONICALIZATION_SPEC,
      },
    };
  })().catch(() => getDeploymentDescriptor());
  signedCache = { pkcs8: cacheKey, value };
  return value;
}
