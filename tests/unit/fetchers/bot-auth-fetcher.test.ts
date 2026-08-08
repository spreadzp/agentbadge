import { describe, it, expect, vi } from "vitest";
import { fetchBotAuth } from "../../../src/agent-readiness/scanner/fetchers/bot-auth-fetcher";

describe("SLICE-48-11: bot-auth-fetcher", () => {
  it("fetches signatures directory and validates members", async () => {
    const dir = {
      members: [{ name: "bot1", publicKeyUrl: "https://example.com/keys/bot1.pem" }],
    };
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/http-message-signatures-directory"))
        return new Response(JSON.stringify(dir), { status: 200 });
      if (url.includes("/keys/bot1.pem"))
        return new Response("-----BEGIN PUBLIC KEY-----", { status: 200 });
      return new Response(null, { status: 404 });
    });
    const result = await fetchBotAuth("https://example.com", mockFetch);
    expect(result.source).toBe("bot-auth");
    expect(result.data.found).toBe(true);
    expect(result.data.members).toHaveLength(1);
    expect(result.data.publicKeysReachable).toBe(true);
  });

  it("handles 404", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const result = await fetchBotAuth("https://example.com", mockFetch);
    expect(result.data.found).toBe(false);
  });
});
