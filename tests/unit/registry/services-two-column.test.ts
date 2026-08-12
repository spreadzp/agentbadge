import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../../e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-56-2: Services page two-column layout (Agents vs Operators)", () => {
  it("services page contains 'For Agents' section", async () => {
    const res = await app.request("/agent-guide/team/services");
    const text = await res.text();
    expect(text).toContain("For Agents");
  });

  it("services page contains 'For Operators' section", async () => {
    const res = await app.request("/agent-guide/team/services");
    const text = await res.text();
    expect(text).toContain("For Operators");
  });

  it("services page has a table with two columns", async () => {
    const res = await app.request("/agent-guide/team/services");
    const text = await res.text();
    expect(text).toContain("| For Agents |");
    expect(text).toContain("| For Operators |");
  });

  it("For Agents column contains agent-facing info (problem)", async () => {
    const res = await app.request("/agent-guide/team/services");
    const text = await res.text();
    expect(text).toContain("Problem");
  });

  it("For Operators column contains operator-facing info (deliverables/engagement)", async () => {
    const res = await app.request("/agent-guide/team/services");
    const text = await res.text();
    expect(text).toContain("Deliverables");
    expect(text).toContain("Engagement");
  });

  it("services page still contains all service names", async () => {
    const res = await app.request("/agent-guide/team/services");
    const text = await res.text();
    expect(text).toContain("MCP Server Development");
    expect(text).toContain("Smart Contract Development");
  });
});
