import { describe, it, expect } from "vitest";

process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../../src/server/index");
const { WORKFLOW_PROBES } = await import(
  "../../src/server/lib/agent-discovery/agent-workflows"
);

// SLICE-259-18: /.well-known/agent-workflows.json contract — schema
// completeness, autonomy classes, and contract↔routing CI (every
// advertised endpoint must be mounted — probes never hit a bare 404).

const app = createApp();
const res = await app.request("/.well-known/agent-workflows.json");
const doc = (await res.json()) as {
  schema_version: string;
  base_url: string;
  workflows: Array<{
    id: string;
    autonomy: string;
    approval?: { required_for?: string; resume_after_approval?: string };
    errors: unknown[];
    [k: string]: unknown;
  }>;
  links: Record<string, string>;
};

const REQUIRED = [
  "id",
  "name",
  "description",
  "discovery",
  "preconditions",
  "input",
  "execution",
  "inspection",
  "verification",
  "autonomy",
  "next_actions",
  "errors",
];

describe("agent-workflows.json contract", () => {
  it("serves v1 with ≥5 workflows", () => {
    expect(res.status).toBe(200);
    expect(doc.schema_version).toBe("1");
    expect(doc.workflows.length).toBeGreaterThanOrEqual(5);
    expect(new Set(doc.workflows.map((w) => w.id)).size).toBe(doc.workflows.length);
  });

  it("every workflow carries all required fields", () => {
    for (const w of doc.workflows) {
      for (const f of REQUIRED) expect(w, `${w.id}.${f}`).toHaveProperty(f);
      expect(w.errors.length).toBeGreaterThan(0);
      for (const e of w.errors) {
        expect(e).toMatchObject({ code: expect.any(String), http: expect.any(Number), retryable: expect.any(Boolean) });
      }
    }
  });

  it("autonomy classes: ≥3 autonomous + requires_human with approval block", () => {
    const autonomy = new Set(doc.workflows.map((w) => w.autonomy));
    expect([...autonomy].sort()).toEqual(
      expect.arrayContaining(["autonomous", "requires_human"]),
    );
    const autonomous = doc.workflows.filter((w) => w.autonomy === "autonomous");
    expect(autonomous.length).toBeGreaterThanOrEqual(3);
    for (const w of doc.workflows) {
      if (w.autonomy === "requires_human") {
        expect(w.approval?.required_for).toBeTruthy();
        expect(w.approval?.resume_after_approval).toBeTruthy();
      } else {
        expect(w.approval).toBeUndefined();
      }
    }
  });

  it("contract ↔ routing: every probed endpoint is mounted", async () => {
    for (const w of doc.workflows) {
      const probe = WORKFLOW_PROBES[w.id];
      expect(probe, `probe for ${w.id}`).toBeDefined();
      const r = await app.request(probe.path, {
        method: probe.method,
        headers: probe.method === "POST" ? { "content-type": "application/json" } : {},
        body: probe.method === "POST" ? "{}" : undefined,
      });
      if (probe.envGated && r.status === 404) continue; // payments runtime off in test env
      expect(
        probe.expectedStatuses,
        `${w.id} ${probe.method} ${probe.path} → ${r.status}`,
      ).toContain(r.status);
    }
  });

  it("anonymous-executable workflows really respond (not 404)", async () => {
    // knowledge-search
    expect(
      (await app.request("/api/v1/agent/knowledge/search?q=x402")).status,
    ).toBe(200);
    // passport-verify: invalid serial → handler 400 proves routing
    expect(
      (await app.request("/passport/__probe__/notanumber")).status,
    ).toBe(400);
    // agent-register mounted (400/503 — never unrouted 404)
    const reg = await app.request("/api/v1/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(reg.status).not.toBe(404);
  });

  it("links surfaces: agent-card + llms.txt advertise the contract", async () => {
    const card = (await (await app.request("/.well-known/agent-card.json")).json()) as {
      "x-agentbadge"?: { endpoints?: Record<string, string> };
    };
    expect(card["x-agentbadge"]?.endpoints?.agent_workflows).toBe(
      `${doc.base_url}/.well-known/agent-workflows.json`,
    );
    const llms = await (await app.request("/llms.txt")).text();
    expect(llms).toContain("/.well-known/agent-workflows.json");
  });
});
