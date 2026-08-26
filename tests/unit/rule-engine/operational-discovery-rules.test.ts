import { describe, it, expect } from "vitest";
import { checkAb125, checkAb126, checkAb127 } from "../../../src/agent-readiness/rule-engine/rule-checkers";
import type { SourceState } from "../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

function makeState(body: string): SourceState {
  const snap: ResponseSnapshot = {
    url: "https://example.com/operational-discovery",
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
  return { snapshots: { operational_discovery: snap } } as unknown as SourceState;
}

function makeEmptyState(): SourceState {
  return { snapshots: {} } as unknown as SourceState;
}

describe("AB-125: LocalBusiness schema.org present", () => {
  it("returns status 200 when LocalBusiness found", () => {
    const state = makeState(JSON.stringify({
      status: "found",
      business: { name: "Joe's Pizza" },
      businessType: "LocalBusiness",
      validation: { missingRequired: [], missingRecommended: [] },
    }));
    const evidence = checkAb125(state);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("http");
    expect((evidence[0] as any).status).toBe(200);
  });

  it("returns status 0 when not found", () => {
    const state = makeState(JSON.stringify({
      status: "not_found",
      validation: { missingRequired: [], missingRecommended: [] },
    }));
    const evidence = checkAb125(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(0);
  });

  it("returns empty when no operational_discovery snapshot", () => {
    const evidence = checkAb125(makeEmptyState());
    expect(evidence).toHaveLength(0);
  });
});

describe("AB-126: Opening hours machine-readable", () => {
  it("returns status 200 when openingHours present", () => {
    const state = makeState(JSON.stringify({
      status: "found",
      business: { name: "Test", openingHours: "Mo-Sa 09:00-22:00" },
      validation: { missingRequired: [], missingRecommended: [] },
    }));
    const evidence = checkAb126(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(200);
  });

  it("returns status 0 when openingHours absent", () => {
    const state = makeState(JSON.stringify({
      status: "found",
      business: { name: "Test" },
      validation: { missingRequired: [], missingRecommended: ["openingHours"] },
    }));
    const evidence = checkAb126(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(0);
  });

  it("returns empty when no operational_discovery snapshot", () => {
    const evidence = checkAb126(makeEmptyState());
    expect(evidence).toHaveLength(0);
  });
});

describe("AB-127: Area served defined", () => {
  it("returns status 200 when areaServed present", () => {
    const state = makeState(JSON.stringify({
      status: "found",
      business: { name: "Test", areaServed: "San Francisco Bay Area" },
      validation: { missingRequired: [], missingRecommended: [] },
    }));
    const evidence = checkAb127(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(200);
  });

  it("returns status 0 when areaServed absent", () => {
    const state = makeState(JSON.stringify({
      status: "found",
      business: { name: "Test" },
      validation: { missingRequired: [], missingRecommended: ["areaServed"] },
    }));
    const evidence = checkAb127(state);
    expect(evidence).toHaveLength(1);
    expect((evidence[0] as any).status).toBe(0);
  });

  it("returns empty when no operational_discovery snapshot", () => {
    const evidence = checkAb127(makeEmptyState());
    expect(evidence).toHaveLength(0);
  });
});
