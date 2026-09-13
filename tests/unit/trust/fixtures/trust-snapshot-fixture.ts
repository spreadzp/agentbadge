/**
 * SLICE-102-2: Test fixtures for Trust Snapshot builder.
 */

import { generateKeyPairSync } from "node:crypto";
import { buildProfile } from "../../../../src/agent-readiness/profile/profile-builder";
import { makeFixtureScanReport, makeFixtureAssertions } from "../../profile/fixtures/scan-report-fixture";
import type { DomainOwnership } from "../../../../src/agent-readiness/trust/trust-schema";

export function makeTestSigningKey(): Uint8Array {
  const { privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "der", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });
  return new Uint8Array(privateKey.subarray(privateKey.length - 32));
}

export function makeTestDomainOwnership(): DomainOwnership {
  return {
    method: "dns_txt",
    verified: true,
    verified_at: "2026-09-04T21:55:00Z",
    challenge_token: "ab_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    proof: "TXT _agentbadge.api.example.com = ab_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  };
}

export function makeTestProfile() {
  const scanReport = makeFixtureScanReport();
  const assertions = makeFixtureAssertions();
  const profile = buildProfile({
    scanReport,
    assertions,
    reportId: "TRUST-TEST",
  });
  return { profile, assertions, scanReport };
}
