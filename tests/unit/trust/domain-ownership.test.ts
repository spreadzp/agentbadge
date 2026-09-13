import { describe, it, expect, vi } from "vitest";
import { verifyDomainOwnership } from "../../../src/agent-readiness/trust/domain-ownership";
import { generateChallenge } from "../../../src/agent-readiness/trust/challenge";

/**
 * SLICE-102-3: Domain ownership orchestrator tests.
 * Mocks both DNS and well-known verifiers.
 */

vi.mock("../../../src/agent-readiness/trust/dns-verifier", () => ({
  verifyDnsTxt: vi.fn(),
}));

vi.mock("../../../src/agent-readiness/trust/well-known-verifier", () => ({
  verifyWellKnownFile: vi.fn(),
}));

import { verifyDnsTxt } from "../../../src/agent-readiness/trust/dns-verifier";
import { verifyWellKnownFile } from "../../../src/agent-readiness/trust/well-known-verifier";

describe("SLICE-102-3: verifyDomainOwnership()", () => {
  const challenge = generateChallenge("example.com", "2026-01-01T00:00:00Z");

  it("returns DNS proof when DNS TXT succeeds", async () => {
    vi.mocked(verifyDnsTxt).mockResolvedValue({
      verified: true,
      method: "dns_txt",
      verified_at: "2026-09-04T22:00:00Z",
      proof: "TXT match",
    });
    vi.mocked(verifyWellKnownFile).mockResolvedValue(null);

    const result = await verifyDomainOwnership("example.com", challenge);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("dns_txt");
    expect(result!.verified).toBe(true);
    expect(result!.challenge_token).toBe(challenge.token);
  });

  it("returns well-known proof when DNS fails but well-known succeeds", async () => {
    vi.mocked(verifyDnsTxt).mockResolvedValue(null);
    vi.mocked(verifyWellKnownFile).mockResolvedValue({
      verified: true,
      method: "well_known_file",
      verified_at: "2026-09-04T22:00:00Z",
      proof: "File match",
    });

    const result = await verifyDomainOwnership("example.com", challenge);
    expect(result).not.toBeNull();
    expect(result!.method).toBe("well_known_file");
    expect(result!.verified).toBe(true);
  });

  it("returns null when both DNS and well-known fail", async () => {
    vi.mocked(verifyDnsTxt).mockResolvedValue(null);
    vi.mocked(verifyWellKnownFile).mockResolvedValue(null);

    const result = await verifyDomainOwnership("example.com", challenge);
    expect(result).toBeNull();
  });

  it("tries DNS first and returns DNS proof when DNS succeeds", async () => {
    vi.mocked(verifyDnsTxt).mockResolvedValue({
      verified: true,
      method: "dns_txt",
      verified_at: "2026-09-04T22:00:00Z",
      proof: "TXT match",
    });
    vi.mocked(verifyWellKnownFile).mockResolvedValue(null);

    const result = await verifyDomainOwnership("example.com", challenge);
    expect(verifyDnsTxt).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.method).toBe("dns_txt");
  });

  it("includes challenge_token in proof", async () => {
    vi.mocked(verifyDnsTxt).mockResolvedValue({
      verified: true,
      method: "dns_txt",
      verified_at: "2026-09-04T22:00:00Z",
      proof: "TXT match",
    });

    const result = await verifyDomainOwnership("example.com", challenge);
    expect(result!.challenge_token).toBe(challenge.token);
  });
});
