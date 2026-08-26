import { describe, it, expect } from "vitest";
import { checkAb119, checkAb120, checkAb121, RULE_CHECKERS } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function makeAuthProbeSnapshot(body: string): ResponseSnapshot {
  return {
    url: "https://api.example.com/auth-probe",
    status: 200,
    bodyHash: "abc123",
    bodySize: body.length,
    contentType: "application/json",
    resolvedIp: "1.2.3.4",
    fetchedAt: "2026-01-01T00:00:00Z",
    fetchTimeMs: 100,
    redirectChain: [],
    body,
    headers: {},
  };
}

function makeState(authProbeBody: string | null): SourceState {
  return {
    domain: "api.example.com",
    scannedAt: "2026-01-01T00:00:00Z",
    snapshots: authProbeBody !== null
      ? { auth_probe: makeAuthProbeSnapshot(authProbeBody) }
      : {},
  };
}

describe("AB-119: OAuth token endpoint reachable", () => {
  it("returns VERIFIED when auth probe shows token obtained", () => {
    const state = makeState(
      JSON.stringify({ status: "success", tokenObtained: true, tokenEndpoint: "https://api.example.com/oauth/token" }),
    );
    const evidence = checkAb119(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("http");
  });

  it("returns empty when no auth probe snapshot", () => {
    const state = makeState(null);
    const evidence = checkAb119(state);
    expect(evidence).toHaveLength(0);
  });

  it("returns http evidence with status 0 when token_error", () => {
    const state = makeState(
      JSON.stringify({ status: "token_error", tokenObtained: false }),
    );
    const evidence = checkAb119(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as { status: number }).status).toBe(0);
  });
});

describe("AB-120: Authenticated endpoint callable", () => {
  it("returns http evidence with status 200 when endpoint returns 200", () => {
    const state = makeState(
      JSON.stringify({ status: "success", tokenObtained: true, endpointStatus: 200 }),
    );
    const evidence = checkAb120(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as { status: number }).status).toBe(200);
  });

  it("returns http evidence with status 401 when endpoint returns 401", () => {
    const state = makeState(
      JSON.stringify({ status: "endpoint_error", endpointStatus: 401 }),
    );
    const evidence = checkAb120(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as { status: number }).status).toBe(401);
  });

  it("returns empty when no auth probe snapshot", () => {
    const state = makeState(null);
    const evidence = checkAb120(state);
    expect(evidence).toHaveLength(0);
  });
});

describe("AB-121: Token response valid format", () => {
  it("returns http evidence when token obtained successfully", () => {
    const state = makeState(
      JSON.stringify({ status: "success", tokenObtained: true }),
    );
    const evidence = checkAb121(state);
    expect(evidence).toHaveLength(1);
  });

  it("returns http evidence with status 0 when token not obtained", () => {
    const state = makeState(
      JSON.stringify({ status: "token_error", tokenObtained: false }),
    );
    const evidence = checkAb121(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as { status: number }).status).toBe(0);
  });

  it("returns empty when no auth probe snapshot", () => {
    const state = makeState(null);
    const evidence = checkAb121(state);
    expect(evidence).toHaveLength(0);
  });
});

describe("RULE_CHECKERS registry", () => {
  it("has AB-119 registered", () => {
    expect(RULE_CHECKERS["AB-119"]).toBe(checkAb119);
  });

  it("has AB-120 registered", () => {
    expect(RULE_CHECKERS["AB-120"]).toBe(checkAb120);
  });

  it("has AB-121 registered", () => {
    expect(RULE_CHECKERS["AB-121"]).toBe(checkAb121);
  });
});
