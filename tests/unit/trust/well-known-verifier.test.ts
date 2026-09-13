import { describe, it, expect, vi } from "vitest";
import { verifyWellKnownFile } from "../../../src/agent-readiness/trust/well-known-verifier";
import { generateChallenge } from "../../../src/agent-readiness/trust/challenge";

/**
 * SLICE-102-3: Well-known file verifier tests.
 * Mocks safeFetch.
 */

vi.mock("../../../src/agent-readiness/scanner/ssrf/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { safeFetch } from "../../../src/agent-readiness/scanner/ssrf/safe-fetch";

describe("SLICE-102-3: verifyWellKnownFile()", () => {
  const challenge = generateChallenge("example.com", "2026-01-01T00:00:00Z");

  function mockFetchResult(status: number, bodyText: string) {
    vi.mocked(safeFetch).mockResolvedValue({
      status,
      headers: {},
      body: new ArrayBuffer(0),
      bodyText,
      resolvedIp: "1.2.3.4",
      fetchTime: 100,
      redirectChain: [],
    });
  }

  it("returns verified result when file content matches token", async () => {
    mockFetchResult(200, challenge.token);

    const result = await verifyWellKnownFile("example.com", challenge);
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
    expect(result!.method).toBe("well_known_file");
    expect(result!.proof).toContain(".well-known/agentbadge-verify.txt");
  });

  it("trims whitespace from file content before matching", async () => {
    mockFetchResult(200, `\n  ${challenge.token}  \n`);

    const result = await verifyWellKnownFile("example.com", challenge);
    expect(result).not.toBeNull();
    expect(result!.verified).toBe(true);
  });

  it("returns null on 404", async () => {
    mockFetchResult(404, "Not Found");

    const result = await verifyWellKnownFile("example.com", challenge);
    expect(result).toBeNull();
  });

  it("returns null when content does not match token", async () => {
    mockFetchResult(200, "wrong-token");

    const result = await verifyWellKnownFile("example.com", challenge);
    expect(result).toBeNull();
  });

  it("returns null on fetch error (network error)", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await verifyWellKnownFile("example.com", challenge);
    expect(result).toBeNull();
  });

  it("returns null on 500 server error", async () => {
    mockFetchResult(500, "Internal Server Error");

    const result = await verifyWellKnownFile("example.com", challenge);
    expect(result).toBeNull();
  });
});
