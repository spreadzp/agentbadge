import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getTopicMessages,
  getNftsForToken,
  getNftsForAccount,
  getTopicMessagesPaginated,
} from "@agentgate-hedera/hedera-core";

describe("Mirror Node pagination — SLICE-7-9", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.HEDERA_NETWORK = "testnet";
    delete process.env.MOCK_HEDERA;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeMessagesResponse(count: number, nextLink: string | null) {
    const messages = Array.from({ length: count }, (_, i) => ({
      consensus_timestamp: `170000000${i}.000000001`,
      message: Buffer.from(`msg-${i}`).toString("base64"),
      sequence_number: i + 1,
      running_hash: "hash",
    }));
    return new Response(JSON.stringify({ messages, links: { next: nextLink } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function makeNftsResponse(count: number, nextLink: string | null) {
    const nfts = Array.from({ length: count }, (_, i) => ({
      serial_number: i + 1,
      token_id: "0.0.123",
      account_id: "0.0.456",
      metadata: Buffer.from(`ipfs://meta-${i}`).toString("base64"),
      created_timestamp: "1700000000.000000001",
    }));
    return new Response(JSON.stringify({ nfts, links: { next: nextLink } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("getTopicMessages respects maxResults and stops pagination early", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          makeMessagesResponse(100, "/topics/0.0.999/messages?sequence=gt:100"),
        );
      }
      return Promise.resolve(makeMessagesResponse(100, null));
    }) as never;

    const messages = await getTopicMessages("0.0.999", { maxResults: 150 });

    expect(messages).toHaveLength(150);
    expect(callCount).toBe(2); // 2 pages needed for 150 items
  });

  it("getTopicMessages without maxResults fetches all pages", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return Promise.resolve(
          makeMessagesResponse(100, "/topics/0.0.999/messages?sequence=gt:100"),
        );
      if (callCount === 2)
        return Promise.resolve(
          makeMessagesResponse(100, "/topics/0.0.999/messages?sequence=gt:200"),
        );
      return Promise.resolve(makeMessagesResponse(50, null));
    }) as never;

    const messages = await getTopicMessages("0.0.999");

    expect(messages).toHaveLength(250);
    expect(callCount).toBe(3);
  });

  it("getTopicMessagesPaginated returns single page with nextPageUrl", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        makeMessagesResponse(100, "/topics/0.0.999/messages?sequence=gt:100"),
      ) as never;

    const result = await getTopicMessagesPaginated("0.0.999");

    expect(result.messages).toHaveLength(100);
    expect(result.nextPageUrl).toContain("/topics/0.0.999/messages?sequence=gt:100");
  });

  it("getTopicMessagesPaginated returns null nextPageUrl on last page", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeMessagesResponse(50, null)) as never;

    const result = await getTopicMessagesPaginated("0.0.999");

    expect(result.messages).toHaveLength(50);
    expect(result.nextPageUrl).toBeNull();
  });

  it("getTopicMessagesPaginated accepts pageUrl for subsequent pages", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(makeMessagesResponse(100, null)) as never;

    const pageUrl =
      "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.999/messages?sequence=gt:100";
    const result = await getTopicMessagesPaginated("0.0.999", { pageUrl });

    expect(result.messages).toHaveLength(100);
    expect(globalThis.fetch).toHaveBeenCalledWith(pageUrl, expect.any(Object));
  });

  it("getNftsForToken respects maxResults", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return Promise.resolve(makeNftsResponse(100, "/tokens/0.0.123/nfts?serial=gt:100"));
      return Promise.resolve(makeNftsResponse(100, null));
    }) as never;

    const nfts = await getNftsForToken("0.0.123", { maxResults: 50 });

    expect(nfts).toHaveLength(50);
    expect(callCount).toBe(1); // Only 1 page needed
  });

  it("getNftsForAccount respects maxResults", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return Promise.resolve(makeNftsResponse(100, "/accounts/0.0.456/nfts?serial=gt:100"));
      return Promise.resolve(makeNftsResponse(100, null));
    }) as never;

    const nfts = await getNftsForAccount("0.0.456", { maxResults: 120 });

    expect(nfts).toHaveLength(120);
    expect(callCount).toBe(2);
  });

  it("default page size is 100", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve(makeMessagesResponse(0, null));
    }) as never;

    await getTopicMessages("0.0.999");

    expect(capturedUrl).toContain("limit=100");
  });

  it("pagination handles 1000+ mock messages across multiple pages", async () => {
    let callCount = 0;
    const totalPages = 12; // 12 pages of 100 = 1200 messages
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const isLast = callCount >= totalPages;
      const nextLink = isLast ? null : `/topics/0.0.999/messages?sequence=gt:${callCount * 100}`;
      return Promise.resolve(makeMessagesResponse(100, nextLink));
    }) as never;

    const messages = await getTopicMessages("0.0.999", { maxResults: 1000 });

    expect(messages).toHaveLength(1000);
    expect(callCount).toBe(10); // 10 pages for 1000 items
  });
});
