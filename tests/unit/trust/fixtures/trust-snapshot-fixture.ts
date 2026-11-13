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
    challenge_token: "agentbadge-verify=cd70481c386f9492ec023f4a75476393",
    proof: "TXT _agentbadge-verify.api.example.com = agentbadge-verify=cd70481c386f9492ec023f4a75476393",
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
