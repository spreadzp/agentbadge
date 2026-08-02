import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DataHubVerifier } from "../../src/verifiers/datahub.verifier";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

const mockTask: CachedMarketTask = {
  taskId: "task-123",
  posterDid: "did:hcs:0.0.1:1",
  title: "Test task",
  description: "Test description",
  priceHbar: 5,
  capabilities: ["api_call"],
  status: "delivered",
  txId: "0.0.2@1.1",
  consensusTimestamp: "1.1",
  createdAt: Date.now(),
};

function mockFetch(impl: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown>; text?: () => Promise<string> }>) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    return impl(url);
  });
}

describe("SLICE-24-5: DataHubVerifier", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalEnv = { ...process.env };
    process.env.DATAHUB_MCP_URL = "http://localhost:4031";
    process.env.DATAHUB_TIMEOUT_MS = "5000";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("has type 'datahub'", () => {
    const v = new DataHubVerifier();
    expect(v.type).toBe("datahub");
  });

  it("returns passed=true when assertions pass and no glossary terms missing", async () => {
    globalThis.fetch = mockFetch(async (url) => {
      if (url.includes("/assertions/run")) {
        return { ok: true, json: async () => ({ passed: true, failures: [] }) };
      }
      if (url.includes("/glossary/check")) {
        return { ok: true, json: async () => ({ missingTerms: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    }) as any;

    const v = new DataHubVerifier();
    const result = await v.verify(mockTask, "result content here");

    expect(result.passed).toBe(true);
    expect(result.report).toContain("passed");
  });

  it("returns passed=false with errors when assertions fail", async () => {
    globalThis.fetch = mockFetch(async (url) => {
      if (url.includes("/assertions/run")) {
        return { ok: true, json: async () => ({ passed: false, failures: ["assertion1 failed"] }) };
      }
      if (url.includes("/glossary/check")) {
        return { ok: true, json: async () => ({ missingTerms: [] }) };
      }
      return { ok: false, json: async () => ({}) };
    }) as any;

    const v = new DataHubVerifier();
    const result = await v.verify(mockTask, "result content");

    expect(result.passed).toBe(false);
    expect(result.errors).toContain("assertion1 failed");
  });

  it("returns passed=false with errors when glossary terms are missing", async () => {
    globalThis.fetch = mockFetch(async (url) => {
      if (url.includes("/assertions/run")) {
        return { ok: true, json: async () => ({ passed: true, failures: [] }) };
      }
      if (url.includes("/glossary/check")) {
        return { ok: true, json: async () => ({ missingTerms: ["term1", "term2"] }) };
      }
      return { ok: false, json: async () => ({}) };
    }) as any;

    const v = new DataHubVerifier();
    const result = await v.verify(mockTask, "result content");

    expect(result.passed).toBe(false);
    expect(result.errors).toContain("term1");
    expect(result.errors).toContain("term2");
  });

  it("returns passed=false with timeout message on abort", async () => {
    globalThis.fetch = vi.fn(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 0);
      return new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          const err = new DOMException("aborted", "AbortError");
          reject(err);
        });
      });
    }) as any;

    const v = new DataHubVerifier();
    const result = await v.verify(mockTask, "content");

    expect(result.passed).toBe(false);
    expect(result.report).toBe("DataHub timeout");
  });

  it("returns passed=false with not reachable when fetch throws", async () => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("ECONNREFUSED");
    }) as any;

    const v = new DataHubVerifier();
    const result = await v.verify(mockTask, "content");

    expect(result.passed).toBe(false);
    expect(result.report).toBe("DataHub not reachable");
  });

  it("aggregates errors from both assertions and glossary", async () => {
    globalThis.fetch = mockFetch(async (url) => {
      if (url.includes("/assertions/run")) {
        return { ok: true, json: async () => ({ passed: false, failures: ["fail1"] }) };
      }
      if (url.includes("/glossary/check")) {
        return { ok: true, json: async () => ({ missingTerms: ["missing1"] }) };
      }
      return { ok: false, json: async () => ({}) };
    }) as any;

    const v = new DataHubVerifier();
    const result = await v.verify(mockTask, "content");

    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(["fail1", "missing1"]);
  });
});
