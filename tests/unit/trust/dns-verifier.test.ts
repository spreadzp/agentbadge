import { describe, it, expect, vi } from "vitest";
import { verifyDnsTxt } from "../../../src/agent-readiness/trust/dns-verifier";
import { generateChallenge } from "../../../src/agent-readiness/trust/challenge";

/**
 * SLICE-102-3: DNS TXT verifier tests.
 * Mocks node:dns/promises resolveTxt.
 */

vi.mock("node:dns/promises", () => ({
  resolveTxt: vi.fn(),
}));

import { resolveTxt } from "node:dns/promises";

describe("SLICE-102-3: verifyDnsTxt()", () => {
  const challenge = generateChallenge("example.com", "2026-01-01T00:00:00Z");

  it("returns verified result when TXT record matches", async () => {
    vi.mocked(resolveTxt).mockResolvedValue([[challenge.token]]);

    const result = await verifyDnsTxt("example.com", challenge);
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
    expect(result!.method).toBe("dns_txt");
    expect(result!.proof).toContain("_agentbadge-verify.example.com");
  });

  it("returns null when no TXT record found (NXDOMAIN)", async () => {
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ENOTFOUND"));

    const result = await verifyDnsTxt("example.com", challenge);
    expect(result).toBeNull();
  });

  it("returns null when TXT record has wrong token", async () => {
    vi.mocked(resolveTxt).mockResolvedValue([["agentbadge-verify=wrongtoken"]]);

    const result = await verifyDnsTxt("example.com", challenge);
    expect(result).toBeNull();
  });

  it("returns null when TXT record is empty", async () => {
    vi.mocked(resolveTxt).mockResolvedValue([]);

    const result = await verifyDnsTxt("example.com", challenge);
    expect(result).toBeNull();
  });

  it("handles multi-fragment TXT records (joins fragments)", async () => {
    // Some DNS providers split long TXT records into fragments
    const token = challenge.token;
    const mid = Math.floor(token.length / 2);
    vi.mocked(resolveTxt).mockResolvedValue([[token.slice(0, mid), token.slice(mid)]]);

    const result = await verifyDnsTxt("example.com", challenge);
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
  });

  it("returns null on DNS timeout", async () => {
    vi.mocked(resolveTxt).mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await verifyDnsTxt("example.com", challenge);
    expect(result).toBeNull();
  });
});
