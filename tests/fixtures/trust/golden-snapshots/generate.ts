/**
 * Regenerates the golden Trust Snapshot fixtures in this directory.
 *
 *   bun tests/fixtures/trust/golden-snapshots/generate.ts
 *
 * Deterministic: fixed signing key, HMAC secret and timestamps, so reruns
 * only produce a diff when the snapshot builder or challenge format changes.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildTrustSnapshot } from "../../../../src/agent-readiness/trust/snapshot-builder";
import { verifySnapshot } from "../../../../src/agent-readiness/trust/snapshot-verifier";
import { deriveChallengeToken, getChallengeEpoch } from "../../../../src/agent-readiness/trust/challenge";
import type { DomainOwnership, TrustSnapshot } from "../../../../src/agent-readiness/trust/trust-schema";
import { makeTestProfile } from "../../../unit/trust/fixtures/trust-snapshot-fixture";

const DOMAIN = "api.example.com";
const GENERATED_AT = "2026-09-06T06:10:44.975Z";
const EXPIRED_GENERATED_AT = "2026-09-06T06:10:44.979Z";
const VERIFIED_AT = "2026-09-04T21:55:00Z";
const EXPIRED_VERIFIED_AT = "2026-05-29T06:10:44.979Z";
const FIXTURE_SECRET = "golden-fixture-secret-not-used-in-production";
const SIGNING_KEY = new Uint8Array(createHash("sha256").update("agentbadge-golden-fixture-key").digest());

function ownership(verifiedAt: string): DomainOwnership {
  const token = deriveChallengeToken(DOMAIN, getChallengeEpoch(verifiedAt), FIXTURE_SECRET);
  return {
    method: "dns_txt",
    verified: true,
    verified_at: verifiedAt,
    challenge_token: token,
    proof: `TXT _agentbadge-verify.${DOMAIN} = ${token}`,
  };
}

// buildProfile() stamps `new Date()` into the profile; pin the clock so profile_hash is reproducible.
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor> | []) {
    super(...((args.length ? args : [GENERATED_AT]) as [string]));
  }
  static override now(): number {
    return RealDate.parse(GENERATED_AT);
  }
} as DateConstructor;

function build(domainOwnership: DomainOwnership, timestamp = GENERATED_AT): TrustSnapshot {
  const { profile, assertions } = makeTestProfile();
  const snapshot = buildTrustSnapshot({
    profile,
    assertions,
    domain: DOMAIN,
    profileEndpoint: `https://${DOMAIN}/.well-known/agent-profile.json`,
    domainOwnership,
    signingKey: SIGNING_KEY,
    keyId: "test-key-1",
    timestamp,
  });
  delete snapshot.on_chain;
  return snapshot;
}

function write(name: string, value: unknown): void {
  writeFileSync(join(import.meta.dirname, name), `${JSON.stringify(value, null, 2)}\n`);
}

const trust = build(ownership(VERIFIED_AT));
const expired = build(ownership(EXPIRED_VERIFIED_AT), EXPIRED_GENERATED_AT);
const revoked: TrustSnapshot = {
  ...build(ownership(VERIFIED_AT)),
  on_chain: {
    chain: "base",
    chain_id: 84532,
    contract_address: "0x1234567890abcdef",
    token_id: 42,
    attested_at: "2025-01-01T00:00:00Z",
    attested_by: "0xowner",
    tx_hash: "0xabcdef1234567890",
    revoked: true,
  },
};

const result = await verifySnapshot(trust, {
  skipOnChain: true,
  agentBadgePublicKey: trust.integrity.public_key,
});
globalThis.Date = RealDate;
if (!result.valid) throw new Error(`golden trust snapshot failed verification: ${JSON.stringify(result)}`);

write("golden-trust-snapshot.json", trust);
write("golden-expired-snapshot.json", expired);
write("golden-revoked-snapshot.json", revoked);
write("golden-verification-result.json", { ...result, reason: result.reason ?? null });
