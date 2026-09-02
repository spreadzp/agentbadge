import { describe, it, expect } from "vitest";
import { checkAb122, checkAb123, checkAb124 } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function makeState(body: string): SourceState {
  const snap: ResponseSnapshot = {
    url: "https://api.example.com/endpoint-probe",
    status: 200,
    body,
    bodyHash: "",
    bodySize: 0,
    contentType: "application/json",
    resolvedIp: null,
    fetchedAt: "",
    fetchTimeMs: 0,
    redirectChain: [],
    headers: {},
  };
  return { snapshots: { endpoint_probe: snap } } as unknown as SourceState;
}

function makeEmptyState(): SourceState {
  return { snapshots: {} } as unknown as SourceState;
}

describe("AB-122: At least one endpoint callable", () => {
  it("returns VERIFIED when at least one endpoint returns 200", () => {
    const state = makeState(JSON.stringify({
      status: "success",
      endpoints: [
        { path: "/health", method: "GET", responseStatus: 200, matchesOpenApi: true, contentType: "application/json" },
        { path: "/status", method: "GET", responseStatus: 404, matchesOpenApi: false, contentType: null },
      ],
    }));
    const evidence = checkAb122(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("http");
    expect((evidence[0] as any).status).toBe(200);
  });

  it("returns status 0 when no endpoints return 200", () => {
    const state = makeState(JSON.stringify({
      status: "no_safe_endpoints",
      endpoints: [],
    }));
    const evidence = checkAb122(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(0);
  });

  it("returns empty when no endpoint_probe snapshot", () => {
    const evidence = checkAb122(makeEmptyState());
    expect(evidence).toHaveLength(0);
  });
});

describe("AB-123: Response matches OpenAPI schema", () => {
  it("returns status 200 when all endpoints matchOpenApi", () => {
    const state = makeState(JSON.stringify({
      status: "success",
      endpoints: [
        { path: "/health", method: "GET", responseStatus: 200, matchesOpenApi: true, contentType: "application/json" },
      ],
    }));
    const evidence = checkAb123(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(200);
  });

  it("returns status 0 when some endpoints do not match", () => {
    const state = makeState(JSON.stringify({
      status: "success",
      endpoints: [
        { path: "/health", method: "GET", responseStatus: 200, matchesOpenApi: true, contentType: "application/json" },
        { path: "/status", method: "GET", responseStatus: 500, matchesOpenApi: false, contentType: null },
      ],
    }));
    const evidence = checkAb123(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(0);
  });

  it("returns empty when no endpoint_probe snapshot", () => {
    const evidence = checkAb123(makeEmptyState());
    expect(evidence).toHaveLength(0);
  });
});

describe("AB-124: Response content-type present", () => {
  it("returns status 200 when content-type is present", () => {
    const state = makeState(JSON.stringify({
      status: "success",
      endpoints: [
        { path: "/health", method: "GET", responseStatus: 200, matchesOpenApi: true, contentType: "application/json" },
      ],
    }));
    const evidence = checkAb124(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(200);
  });

  it("returns status 0 when no content-type headers", () => {
    const state = makeState(JSON.stringify({
      status: "success",
      endpoints: [
        { path: "/health", method: "GET", responseStatus: 200, matchesOpenApi: true, contentType: null },
      ],
    }));
    const evidence = checkAb124(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(0);
  });

  it("returns empty when no endpoint_probe snapshot", () => {
    const evidence = checkAb124(makeEmptyState());
    expect(evidence).toHaveLength(0);
  });
});
