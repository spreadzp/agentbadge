/**
 * SLICE-102-6: Test fixtures for snapshot verification.
 */

import { createPrivateKey, createPublicKey } from "node:crypto";
import { buildTrustSnapshot } from "../../../../src/agent-readiness/trust/snapshot-builder";
import { makeTestSigningKey, makeTestDomainOwnership, makeTestProfile } from "./trust-snapshot-fixture";
import type { TrustSnapshot } from "../../../../src/agent-readiness/trust/trust-schema";

export function makeValidSnapshot(): { snapshot: TrustSnapshot; publicKey: string; privateKey: Uint8Array } {
  const signingKey = makeTestSigningKey();

  // Reconstruct the private key from raw 32 bytes (same as signer.ts)
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const derKey = Buffer.concat([pkcs8Prefix, Buffer.from(signingKey)]);
  const privateKeyObj = createPrivateKey({ key: derKey, format: "der", type: "pkcs8" });

  // Derive public key from the same private key
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyRaw = new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32));
  const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

  const { profile, assertions } = makeTestProfile();
  const domainOwnership = makeTestDomainOwnership();

  const snapshot = buildTrustSnapshot({
    profile,
    assertions,
    domain: "api.example.com",
    domainOwnership,
    signingKey,
    keyId: "test-key-1",
    timestamp: new Date().toISOString(),
    profileEndpoint: "https://api.example.com/.well-known/agent-profile.json",
  });

  return { snapshot, publicKey: publicKeyBase64, privateKey: signingKey };
}

export function makeTamperedHashSnapshot(snapshot: TrustSnapshot): TrustSnapshot {
  return {
    ...snapshot,
    integrity: {
      ...snapshot.integrity,
      snapshot_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  };
}

export function makeInvalidSignatureSnapshot(snapshot: TrustSnapshot): TrustSnapshot {
  return {
    ...snapshot,
    integrity: {
      ...snapshot.integrity,
      signature: Buffer.from("invalid-signature").toString("base64"),
    },
  };
}

export function makeStaleSnapshot(): { snapshot: TrustSnapshot; publicKey: string } {
  const signingKey = makeTestSigningKey();
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const derKey = Buffer.concat([pkcs8Prefix, Buffer.from(signingKey)]);
  const privateKeyObj = createPrivateKey({ key: derKey, format: "der", type: "pkcs8" });
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyRaw = new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32));
  const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

  const stale = new Date();
  stale.setDate(stale.getDate() - 60);

  const { profile, assertions } = makeTestProfile();
  const domainOwnership = makeTestDomainOwnership();

  const snapshot = buildTrustSnapshot({
    profile,
    assertions,
    domain: "api.example.com",
    domainOwnership,
    signingKey,
    keyId: "test-key-1",
    timestamp: stale.toISOString(),
    profileEndpoint: "https://api.example.com/.well-known/agent-profile.json",
  });

  return { snapshot, publicKey: publicKeyBase64 };
}

export function makeExpiredOwnershipSnapshot(): { snapshot: TrustSnapshot; publicKey: string } {
  const signingKey = makeTestSigningKey();
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const derKey = Buffer.concat([pkcs8Prefix, Buffer.from(signingKey)]);
  const privateKeyObj = createPrivateKey({ key: derKey, format: "der", type: "pkcs8" });
  const publicKeyObj = createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ type: "spki", format: "der" }) as Buffer;
  const publicKeyRaw = new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32));
  const publicKeyBase64 = Buffer.from(publicKeyRaw).toString("base64");

  const { profile, assertions } = makeTestProfile();

  const expired = new Date();
  expired.setDate(expired.getDate() - 100);
  const domainOwnership = makeTestDomainOwnership();
  domainOwnership.verified_at = expired.toISOString();

  const snapshot = buildTrustSnapshot({
    profile,
    assertions,
    domain: "api.example.com",
    domainOwnership,
    signingKey,
    keyId: "test-key-1",
    timestamp: new Date().toISOString(),
    profileEndpoint: "https://api.example.com/.well-known/agent-profile.json",
  });

  return { snapshot, publicKey: publicKeyBase64 };
}
