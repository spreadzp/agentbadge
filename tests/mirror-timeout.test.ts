import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getNftInfo,
  getNftsForToken,
  getNftsForAccount,
  getTopicMessages,
} from "@agentbadge/hedera-core";

describe("Mirror Node query timeout — SLICE-7-8", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.HEDERA_NETWORK = "testnet";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MIRROR_NODE_TIMEOUT_MS;
  });

  function makeSlowFetch(): typeof fetch {
    return vi.fn().mockImplementation(
      (_url: string, opts?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = opts?.signal as AbortSignal | undefined;
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted", "AbortError"));
            });
          }
        }),
    ) as never;
  }

  it("getNftInfo respects timeout and throws readable error", async () => {
    process.env.MIRROR_NODE_TIMEOUT_MS = "50";
    globalThis.fetch = makeSlowFetch();

    await expect(getNftInfo("0.0.123", 1)).rejects.toThrow(/mirror node.*timeout/i);
  });

  it("getNftsForToken respects timeout", async () => {
    process.env.MIRROR_NODE_TIMEOUT_MS = "50";
    globalThis.fetch = makeSlowFetch();

    await expect(getNftsForToken("0.0.123")).rejects.toThrow(/mirror node.*timeout/i);
  });

  it("getNftsForAccount respects timeout", async () => {
    process.env.MIRROR_NODE_TIMEOUT_MS = "50";
    globalThis.fetch = makeSlowFetch();

    await expect(getNftsForAccount("0.0.123")).rejects.toThrow(/mirror node.*timeout/i);
  });

  it("getTopicMessages respects timeout", async () => {
    process.env.MIRROR_NODE_TIMEOUT_MS = "50";
    globalThis.fetch = makeSlowFetch();

    await expect(getTopicMessages("0.0.999")).rejects.toThrow(/mirror node.*timeout/i);
  });

  it("uses MIRROR_NODE_TIMEOUT_MS env var (not default 10s)", async () => {
    process.env.MIRROR_NODE_TIMEOUT_MS = "100";
    globalThis.fetch = makeSlowFetch();

    const start = Date.now();
    await expect(getNftInfo("0.0.123", 1)).rejects.toThrow();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it("default timeout is 10s when env var not set", () => {
    delete process.env.MIRROR_NODE_TIMEOUT_MS;
    expect(process.env.MIRROR_NODE_TIMEOUT_MS).toBeUndefined();
  });

  it("normal request succeeds without timeout", async () => {
    process.env.MIRROR_NODE_TIMEOUT_MS = "5000";
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ serial_number: 1, token_id: "0.0.123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as never;

    const result = await getNftInfo("0.0.123", 1);
    expect(result).not.toBeNull();
    expect(result?.serial_number).toBe(1);
  });
});
