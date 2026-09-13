import { describe, it, expect } from "vitest";
import { generateChallenge, isChallengeExpired } from "../../../src/agent-readiness/trust/challenge";
import {
  createChallenge,
  getChallenge,
  deleteChallenge,
  clearChallenges,
} from "../../../src/agent-readiness/trust/challenge-store";

/**
 * SLICE-102-3: Challenge generation and store tests.
 */

describe("SLICE-102-3: generateChallenge()", () => {
  it("produces token with agentbadge-verify= prefix", () => {
    const challenge = generateChallenge("example.com");
    expect(challenge.token).toMatch(/^agentbadge-verify=[0-9a-f]{32}$/);
  });

  it("produces different tokens for different calls", () => {
    const c1 = generateChallenge("example.com");
    const c2 = generateChallenge("example.com");
    expect(c1.token).not.toBe(c2.token);
  });

  it("sets domain correctly", () => {
    const challenge = generateChallenge("api.example.com");
    expect(challenge.domain).toBe("api.example.com");
  });

  it("sets created_at and expires_at", () => {
    const challenge = generateChallenge("example.com", "2026-01-01T00:00:00Z");
    expect(challenge.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(challenge.expires_at).toBeDefined();
    // Expiry should be ~90 days after creation
    const created = new Date(challenge.created_at).getTime();
    const expires = new Date(challenge.expires_at).getTime();
    const diffDays = (expires - created) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(90, 0);
  });
});

describe("SLICE-102-3: isChallengeExpired()", () => {
  it("returns false for non-expired challenge", () => {
    const challenge = generateChallenge("example.com", "2026-01-01T00:00:00Z");
    expect(isChallengeExpired(challenge, new Date("2026-01-02T00:00:00Z"))).toBe(false);
  });

  it("returns true for expired challenge", () => {
    const challenge = generateChallenge("example.com", "2025-01-01T00:00:00Z");
    expect(isChallengeExpired(challenge, new Date("2026-09-04T00:00:00Z"))).toBe(true);
  });
});

describe("SLICE-102-3: challenge-store", () => {
  it("createChallenge stores and returns challenge", () => {
    clearChallenges();
    const challenge = createChallenge("example.com");
    expect(challenge.domain).toBe("example.com");
    expect(getChallenge("example.com")).not.toBeNull();
  });

  it("getChallenge returns null for unknown domain", () => {
    clearChallenges();
    expect(getChallenge("unknown.com")).toBeNull();
  });

  it("deleteChallenge removes challenge", () => {
    clearChallenges();
    createChallenge("example.com");
    deleteChallenge("example.com");
    expect(getChallenge("example.com")).toBeNull();
  });

  it("createChallenge overwrites existing challenge", () => {
    clearChallenges();
    const c1 = createChallenge("example.com");
    const c2 = createChallenge("example.com");
    expect(c1.token).not.toBe(c2.token);
    expect(getChallenge("example.com")?.token).toBe(c2.token);
  });
});
