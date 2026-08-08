import { describe, it, expect, vi } from "vitest";
import { fetchIdentity } from "../../../src/agent-readiness/scanner/fetchers/identity-fetcher";

describe("SLICE-48-10: identity-fetcher", () => {
  it("probes all 5 identity endpoints", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/webfinger")) return new Response(JSON.stringify({ subject: "acct:foo@example.com" }), { status: 200 });
      return new Response(null, { status: 404 });
    });
    const result = await fetchIdentity("https://example.com", mockFetch);
    expect(result.source).toBe("identity");
    expect(result.data.webfinger).toBe(true);
    expect(result.data.hostMeta).toBe(false);
    expect(result.data.did).toBe(false);
    expect(result.data.appleAppLinks).toBe(false);
    expect(result.data.androidAssetLinks).toBe(false);
  });

  it("detects all endpoints present", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await fetchIdentity("https://example.com", mockFetch);
    expect(result.data.webfinger).toBe(true);
    expect(result.data.hostMeta).toBe(true);
    expect(result.data.did).toBe(true);
    expect(result.data.appleAppLinks).toBe(true);
    expect(result.data.androidAssetLinks).toBe(true);
  });
});
