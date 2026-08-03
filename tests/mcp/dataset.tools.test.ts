import { describe, it, expect, mock, beforeEach } from "bun:test";
import { listTools, registerDatasetTools, downloadDatasetHandler, uploadResultHandler } from "@agentgate-hedera/mcp";

describe("download_dataset", () => {
  beforeEach(() => {
    mock.restore();
    process.env.OPERATOR_ID = "0.0.1001";
    process.env.OPERATOR_KEY = "302e0201000a";
  });

  it("downloads CSV from HFS with valid fileId", async () => {
    const mockCsv = "age,glucose,outcome\n45,120,0\n50,180,1\n";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(mockCsv, { status: 200, headers: { "Content-Type": "text/csv" } }),
      ),
    ) as unknown as typeof fetch;

    const result = await downloadDatasetHandler({
      fileId: "0.0.12345",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("age,glucose,outcome");
  });

  it("returns error on invalid fileId", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "File not found" }), { status: 404 }),
      ),
    ) as unknown as typeof fetch;

    const result = await downloadDatasetHandler({
      fileId: "0.0.99999",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("File not found");
  });

  it("returns error on missing fileId", async () => {
    const result = await downloadDatasetHandler({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("returns error on network failure", async () => {
    globalThis.fetch = mock(() => Promise.reject(new TypeError("Network error"))) as unknown as typeof fetch;

    const result = await downloadDatasetHandler({
      fileId: "0.0.12345",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network error");
  });

  it("returns error on missing operator credentials", async () => {
    delete process.env.OPERATOR_ID;
    delete process.env.OPERATOR_KEY;

    const result = await downloadDatasetHandler({
      fileId: "0.0.12345",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("operator credentials");
  });
});

describe("upload_result", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("uploads and returns CID + URI", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ IpfsHash: "QmTest123" }), { status: 200 }),
      ),
    ) as unknown as typeof fetch;

    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";

    const result = await uploadResultHandler({
      html: "<html><body>Report</body></html>",
      json: '{"taskId":"test-1"}',
      taskId: "test-1",
      agentDid: "did:hcs:0.0.1234:5",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.cid).toBe("QmTest123");
    expect(parsed.uri).toBe("ipfs://QmTest123");
  });

  it("returns error on missing IPFS keys", async () => {
    delete process.env.IPFS_API_KEY;
    delete process.env.IPFS_API_SECRET;

    const result = await uploadResultHandler({
      html: "<html></html>",
      json: "{}",
      taskId: "test-1",
      agentDid: "did:hcs:0.0.1234:5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("IPFS_API_KEY");
  });

  it("returns validation error on empty HTML", async () => {
    const result = await uploadResultHandler({
      html: "",
      json: "{}",
      taskId: "test-1",
      agentDid: "did:hcs:0.0.1234:5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });

  it("returns validation error on empty JSON", async () => {
    const result = await uploadResultHandler({
      html: "<html></html>",
      json: "",
      taskId: "test-1",
      agentDid: "did:hcs:0.0.1234:5",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Validation error");
  });
});

describe("tool registration", () => {
  it("both tools appear in listTools()", () => {
    registerDatasetTools();
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("download_dataset");
    expect(names).toContain("upload_result");
  });
});
