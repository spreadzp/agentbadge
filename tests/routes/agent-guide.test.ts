import { describe, it, expect } from "vitest";
import { agentGuideRoutes } from "../../src/server/routes/agent-guide";
import { Hono } from "hono";

const app = new Hono();
app.route("/", agentGuideRoutes);

async function fetchGuide(): Promise<string> {
  const res = await app.request("/agent-guide", {
    headers: { Accept: "text/markdown" },
  });
  expect(res.status).toBe(200);
  return await res.text();
}

describe("GET /agent-guide (updated for EPIC-27)", () => {
  it("returns 200 with markdown content-type", async () => {
    const res = await app.request("/agent-guide", {
      headers: { Accept: "text/markdown" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
  });

  it("mentions Escrow section", async () => {
    const text = await fetchGuide();
    expect(text).toContain("Escrow");
  });

  it("mentions DataHub Verification section", async () => {
    const text = await fetchGuide();
    expect(text).toContain("DataHub Verification");
  });

  it("mentions HFS Storage section", async () => {
    const text = await fetchGuide();
    expect(text).toContain("HFS");
  });

  it("mentions download_dataset MCP tool", async () => {
    const text = await fetchGuide();
    expect(text).toContain("download_dataset");
  });

  it("mentions upload_result MCP tool", async () => {
    const text = await fetchGuide();
    expect(text).toContain("upload_result");
  });

  it("mentions self-correcting loop", async () => {
    const text = await fetchGuide();
    expect(text.toLowerCase()).toContain("self-correcting");
  });

  it("cross-links to /medical-guide", async () => {
    const text = await fetchGuide();
    expect(text).toContain("/medical-guide");
  });

  it("updated tool count to 38", async () => {
    const text = await fetchGuide();
    expect(text).toContain("MCP Tools (38)");
  });

  it("mentions escrow MCP tools (get_escrow_status, cancel_escrow)", async () => {
    const text = await fetchGuide();
    expect(text).toContain("get_escrow_status");
    expect(text).toContain("cancel_escrow");
  });

  it("mentions verify_result MCP tool", async () => {
    const text = await fetchGuide();
    expect(text).toContain("verify_result");
  });

  it("mentions HashScan for escrow verification", async () => {
    const text = await fetchGuide();
    expect(text).toContain("HashScan");
  });
});
