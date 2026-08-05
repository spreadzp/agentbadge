import { generateSigningKey } from "../../../src/agent-readiness/integrity/key-manager";
import { assembleReport } from "../../../src/agent-readiness/integrity/report-serializer";
import { signReport } from "../../../src/agent-readiness/integrity/signer";
import type { SigningKey } from "../../../src/agent-readiness/integrity/key-manager";
import type { AgentReadinessReport } from "../../../src/agent-readiness/integrity/report-serializer";

export const testKey: SigningKey = generateSigningKey("test-key-001");
export const wrongKey: SigningKey = generateSigningKey("wrong-key-002");

const mockScope = {
  agent_id: "fixture-agent",
  agent_version: "1.0.0",
  endpoint_base_url: "https://api.fixture.example.com",
};

const mockAssertions = [
  { rule_id: "AB-001", status: "VERIFIED", severity: "critical" },
  { rule_id: "AB-002", status: "MISSING", severity: "important" },
  { rule_id: "AB-003", status: "VERIFIED", severity: "minor" },
];

const mockScoreResult = {
  total: { score: 72 },
  categories: {
    discovery: { score: 90 },
    documentation: { score: 60 },
    protocol: { score: 65 },
  },
  delta: { totalDelta: -3 },
};

const mockSourceState = { openapi: "3.1.0", endpoints: 12 };

export function createValidSignedReport(
  previousHash: string | null = null,
): AgentReadinessReport {
  const unsigned = assembleReport({
    scope: mockScope,
    sourceState: mockSourceState,
    assertions: mockAssertions,
    scoreResult: mockScoreResult,
    previousHash,
    keyId: testKey.keyId,
  });
  return signReport(unsigned, testKey);
}

export function createTamperedReport(): AgentReadinessReport {
  const signed = createValidSignedReport();
  return {
    ...signed,
    assertions: [
      { rule_id: "AB-001", status: "MISSING", severity: "critical" },
      ...mockAssertions.slice(1),
    ],
  };
}

export function createWrongKeyReport(): AgentReadinessReport {
  const unsigned = assembleReport({
    scope: mockScope,
    sourceState: mockSourceState,
    assertions: mockAssertions,
    scoreResult: mockScoreResult,
    previousHash: null,
    keyId: testKey.keyId,
  });
  return signReport(unsigned, testKey);
}

export const malformedJsonString = '{ "report_id": "broken", "integrity": ';

export function createChainReports(): AgentReadinessReport[] {
  const r0 = createValidSignedReport(null);
  const r1 = createValidSignedReport(r0.integrity.content_hash);
  const r2 = createValidSignedReport(r1.integrity.content_hash);
  return [r0, r1, r2];
}

export function createBrokenChainReports(): AgentReadinessReport[] {
  const chain = createChainReports();
  // Simulate post-sign tamper: change r1's content_hash so r2.previous_hash no longer matches
  const tamperedHash = "tampered-hash-0000000000000000000000000000000000000000000000000000000000000000";
  return [
    chain[0],
    { ...chain[1], integrity: { ...chain[1].integrity, content_hash: tamperedHash } },
    chain[2],
  ];
}

export { mockScope, mockAssertions, mockScoreResult, mockSourceState };
