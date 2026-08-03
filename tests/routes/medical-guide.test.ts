import { describe, it, expect } from "bun:test";
import { medicalGuideRoutes } from "../../src/server/routes/medical-guide";

async function fetchGuide(): Promise<string> {
  const res = await medicalGuideRoutes.request("/medical-guide", {
    headers: { Accept: "text/markdown" },
  });
  return res.text();
}

describe("GET /medical-guide (updated)", () => {
  it("returns 200", async () => {
    const res = await medicalGuideRoutes.request("/medical-guide", {
      headers: { Accept: "text/markdown" },
    });
    expect(res.status).toBe(200);
  });

  it("returns text/markdown content-type", async () => {
    const res = await medicalGuideRoutes.request("/medical-guide", {
      headers: { Accept: "text/markdown" },
    });
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  it("mentions HFS download", async () => {
    const md = await fetchGuide();
    expect(md).toContain("HFS");
    expect(md.toLowerCase()).toContain("download");
  });

  it("mentions analysis types (descriptive, correlation, risk factors)", async () => {
    const md = await fetchGuide();
    expect(md).toContain("Descriptive");
    expect(md).toContain("Correlation");
    expect(md).toContain("Risk");
  });

  it("mentions IPFS upload", async () => {
    const md = await fetchGuide();
    expect(md).toContain("IPFS");
    expect(md.toLowerCase()).toContain("upload");
  });

  it("mentions DataHub verification", async () => {
    const md = await fetchGuide();
    expect(md).toContain("DataHub");
    expect(md).toContain("verif");
  });

  it("mentions self-correcting loop", async () => {
    const md = await fetchGuide();
    expect(md.toLowerCase()).toContain("self-correcting");
  });

  it("mentions download_dataset MCP tool", async () => {
    const md = await fetchGuide();
    expect(md).toContain("download_dataset");
  });

  it("mentions upload_result MCP tool", async () => {
    const md = await fetchGuide();
    expect(md).toContain("upload_result");
  });

  it("mentions escrow", async () => {
    const md = await fetchGuide();
    expect(md.toLowerCase()).toContain("escrow");
  });

  it("mentions claim-with-key", async () => {
    const md = await fetchGuide();
    expect(md).toContain("claim-with-key");
  });

  it("mentions deliver-with-key", async () => {
    const md = await fetchGuide();
    expect(md).toContain("deliver-with-key");
  });

  it("mentions complete-with-key", async () => {
    const md = await fetchGuide();
    expect(md).toContain("complete-with-key");
  });

  it("still references old demo endpoints for backward compatibility", async () => {
    const md = await fetchGuide();
    expect(md).toContain("demo");
  });

  it("mentions HTML report generation", async () => {
    const md = await fetchGuide();
    expect(md).toContain("HTML");
  });

  it("mentions JSON report generation", async () => {
    const md = await fetchGuide();
    expect(md).toContain("JSON");
  });

  it("mentions HashScan verification", async () => {
    const md = await fetchGuide();
    expect(md).toContain("HashScan");
  });

  it("mentions CSV parsing", async () => {
    const md = await fetchGuide();
    expect(md).toContain("CSV");
  });
});
