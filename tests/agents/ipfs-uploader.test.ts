import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { uploadReportBundle, uploadToPinata, buildReportBundle } from "../../src/agents/ipfs-uploader";

// Mock global fetch
const originalFetch = globalThis.fetch;

function mockFetchResponse(ok: boolean, status: number, body: unknown) {
  globalThis.fetch = mock(async () => {
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  }) as unknown as typeof fetch;
}

function mockFetchSequence(responses: { ok: boolean; status: number; body: unknown }[]) {
  let callIndex = 0;
  globalThis.fetch = mock(async () => {
    const resp = responses[callIndex] ?? responses[responses.length - 1];
    callIndex++;
    return {
      ok: resp.ok,
      status: resp.status,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.IPFS_API_KEY = "test-api-key";
  process.env.IPFS_API_SECRET = "test-api-secret";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.IPFS_API_KEY;
  delete process.env.IPFS_API_SECRET;
});

// ─── buildReportBundle ─────────────────────────────────────────────

describe("buildReportBundle", () => {
  it("creates valid JSON bundle with html, json, and metadata", () => {
    const bundle = buildReportBundle({
      html: "<!DOCTYPE html><html>report</html>",
      json: '{"taskId":"task-123"}',
      metadata: {
        taskId: "task-123",
        agentDid: "did:hcs:0.0.1234:5",
        agentTier: "gold",
        analysisType: "descriptive",
        datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima,PROD)",
        generatedAt: "2026-08-03T12:00:00Z",
      },
    });
    expect(bundle).toContain('"html"');
    expect(bundle).toContain('"json"');
    expect(bundle).toContain('"metadata"');
    expect(bundle).toContain("task-123");
    expect(bundle).toContain("did:hcs:0.0.1234:5");
    const parsed = JSON.parse(bundle);
    expect(parsed.html).toBe("<!DOCTYPE html><html>report</html>");
    expect(parsed.metadata.taskId).toBe("task-123");
  });
});

// ─── uploadToPinata ────────────────────────────────────────────────

describe("uploadToPinata", () => {
  it("uploads JSON content and returns ipfs:// URI", async () => {
    mockFetchResponse(true, 200, { IpfsHash: "QmTestHash123" });
    const cid = await uploadToPinata({ test: "content" });
    expect(cid).toBe("ipfs://QmTestHash123");
  });

  it("throws on missing API keys", async () => {
    delete process.env.IPFS_API_KEY;
    expect(uploadToPinata({ test: "content" })).rejects.toThrow("IPFS_API_KEY");
  });

  it("throws on missing API secret", async () => {
    delete process.env.IPFS_API_SECRET;
    expect(uploadToPinata({ test: "content" })).rejects.toThrow("IPFS_API_SECRET");
  });

  it("throws with status code on Pinata API error", async () => {
    mockFetchResponse(false, 401, { error: "Unauthorized" });
    expect(uploadToPinata({ test: "content" })).rejects.toThrow("401");
  });

  it("retries on network error and succeeds on 2nd attempt", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      if (callCount === 1) throw new TypeError("network error");
      return {
        ok: true,
        status: 200,
        json: async () => ({ IpfsHash: "QmRetryHash" }),
        text: async () => "{}",
      } as Response;
    }) as unknown as typeof fetch;

    const cid = await uploadToPinata({ test: "content" }, { maxRetries: 3 });
    expect(cid).toBe("ipfs://QmRetryHash");
    expect(callCount).toBe(2);
  });

  it("fails after max retries", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("persistent network error");
    }) as unknown as typeof fetch;

    expect(uploadToPinata({ test: "content" }, { maxRetries: 2 })).rejects.toThrow("network error");
  });
});

// ─── uploadReportBundle ────────────────────────────────────────────

describe("uploadReportBundle", () => {
  it("uploads bundle and returns ipfs:// URI", async () => {
    mockFetchResponse(true, 200, { IpfsHash: "QmBundleHash" });

    const html = "<!DOCTYPE html><html><body>report</body></html>";
    const json = '{"taskId":"task-abc","summary":"test"}';
    const metadata = {
      taskId: "task-abc",
      agentDid: "did:hcs:0.0.1234:5",
      agentTier: "gold",
      analysisType: "descriptive",
      datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima,PROD)",
      generatedAt: "2026-08-03T12:00:00Z",
    };

    const uri = await uploadReportBundle(html, json, metadata);
    expect(uri).toBe("ipfs://QmBundleHash");
  });

  it("throws on missing API keys", async () => {
    delete process.env.IPFS_API_KEY;
    delete process.env.IPFS_API_SECRET;

    expect(
      uploadReportBundle("<html></html>", "{}", {
        taskId: "t1",
        agentDid: "did:hcs:0.0.1:1",
        agentTier: "gold",
        analysisType: "descriptive",
        datasetUrn: "urn:li:dataset:x",
        generatedAt: "2026-08-03T12:00:00Z",
      }),
    ).rejects.toThrow("IPFS_API_KEY");
  });
});
