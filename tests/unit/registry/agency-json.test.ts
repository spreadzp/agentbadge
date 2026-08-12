import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../../e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-56-7: /agency.json (Source of Truth)", () => {
  it("returns 200 with application/json", async () => {
    const res = await app.request("/agency.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("has schema_version field", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(body.schema_version).toBeTruthy();
    expect(typeof body.schema_version).toBe("string");
  });

  it("has registry_version field", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(body.registry_version).toBeTruthy();
  });

  it("has name and description", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(body.name).toBe("AgentBadge");
    expect(body.description).toBeTruthy();
  });

  it("has services array from Capability Registry", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services.length).toBeGreaterThan(0);
    const svc = body.services[0];
    expect(svc.id).toBeTruthy();
    expect(svc.name).toBeTruthy();
    expect(svc.problem).toBeTruthy();
    expect(svc.deliverables).toBeTruthy();
  });

  it("has capabilities array with status and evidence", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThan(0);
    const cap = body.capabilities[0];
    expect(cap.id).toBeTruthy();
    expect(cap.name).toBeTruthy();
    expect(cap.status).toBeTruthy();
    expect(Array.isArray(cap.evidence)).toBe(true);
  });

  it("has people array from registry", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(Array.isArray(body.people)).toBe(true);
    expect(body.people.length).toBeGreaterThan(0);
    const person = body.people[0];
    expect(person.id).toBeTruthy();
    expect(person.name).toBeTruthy();
    expect(person.roles).toBeTruthy();
  });

  it("has endpoints object with discovery links", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    expect(body.endpoints).toBeTruthy();
    expect(body.endpoints.agent_guide).toBeTruthy();
    expect(body.endpoints.openapi).toBeTruthy();
    expect(body.endpoints.agent_card).toBeTruthy();
  });

  it("at least one capability has VERIFIED status with evidence links (AC-7.2)", async () => {
    const res = await app.request("/agency.json");
    const body = await res.json();
    const verified = body.capabilities.filter(
      (c: { status: string; evidence: unknown[] }) =>
        c.status === "VERIFIED" && c.evidence.length > 0,
    );
    expect(verified.length).toBeGreaterThan(0);
  });
});
