import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CHALLENGE_EPOCH_MS,
  deriveChallengeToken,
  generateChallenge,
  getChallengeEpoch,
  isChallengeExpired,
  verifyChallengeToken,
} from "../../../src/agent-readiness/trust/challenge";
import { loadTrust, getTrustConfig, resetTrustConfigCache } from "../../../src/config/env/trust";

/**
 * SLICE-102-3: Stateless HMAC challenge tokens.
 */

const SECRET = "test-trust-challenge-secret-0123456789abcdef";
const OTHER_SECRET = "other-trust-challenge-secret-0123456789abcdef";
const NOW = "2026-01-01T00:00:00Z";

function epochStart(offset = 0): Date {
  return new Date((getChallengeEpoch(NOW) + offset) * CHALLENGE_EPOCH_MS);
}

function tamper(token: string): string {
  const last = token.slice(-1);
  return token.slice(0, -1) + (last === "0" ? "1" : "0");
}

describe("SLICE-102-3: generateChallenge()", () => {
  it("produces token with agentbadge-verify= prefix", () => {
    const challenge = generateChallenge("example.com", NOW, SECRET);
    expect(challenge.token).toMatch(/^agentbadge-verify=[0-9a-f]{32}$/);
  });

  it("returns the same token for repeated calls (same domain + epoch)", () => {
    const c1 = generateChallenge("example.com", NOW, SECRET);
    const c2 = generateChallenge("example.com", NOW, SECRET);
    const later = new Date(epochStart(1).getTime() - 1);
    const c3 = generateChallenge("example.com", later, SECRET);
    expect(c2.token).toBe(c1.token);
    expect(c3.token).toBe(c1.token);
  });

  it("is HMAC(secret, domain + epoch)", () => {
    const challenge = generateChallenge("example.com", NOW, SECRET);
    expect(challenge.token).toBe(deriveChallengeToken("example.com", getChallengeEpoch(NOW), SECRET));
  });

  it("differs per domain, per secret and per epoch", () => {
    const base = generateChallenge("example.com", NOW, SECRET).token;
    expect(generateChallenge("other.com", NOW, SECRET).token).not.toBe(base);
    expect(generateChallenge("example.com", NOW, OTHER_SECRET).token).not.toBe(base);
    expect(generateChallenge("example.com", epochStart(1), SECRET).token).not.toBe(base);
  });

  it("sets domain correctly", () => {
    const challenge = generateChallenge("api.example.com", NOW, SECRET);
    expect(challenge.domain).toBe("api.example.com");
  });

  it("created_at is the epoch start and expires_at covers the next epoch", () => {
    const challenge = generateChallenge("example.com", NOW, SECRET);
    expect(challenge.created_at).toBe(epochStart(0).toISOString());
    expect(challenge.expires_at).toBe(epochStart(2).toISOString());
    const created = new Date(challenge.created_at).getTime();
    const expires = new Date(challenge.expires_at).getTime();
    expect((expires - created) / (24 * 60 * 60 * 1000)).toBeCloseTo(180, 0);
  });

  it("throws when the secret is empty", () => {
    expect(() => generateChallenge("example.com", NOW, "")).toThrow(/secret/);
  });
});

describe("SLICE-102-3: verifyChallengeToken()", () => {
  const token = generateChallenge("example.com", NOW, SECRET).token;

  it("accepts a valid current-epoch token", () => {
    const result = verifyChallengeToken("example.com", token, NOW, SECRET);
    expect(result).not.toBeNull();
    expect(result!.token).toBe(token);
    expect(result!.domain).toBe("example.com");
  });

  it("accepts a previous-epoch token", () => {
    const result = verifyChallengeToken("example.com", token, epochStart(1), SECRET);
    expect(result).not.toBeNull();
    expect(result!.token).toBe(token);
  });

  it("rejects a token two epochs old", () => {
    expect(verifyChallengeToken("example.com", token, epochStart(2), SECRET)).toBeNull();
  });

  it("rejects a tampered token", () => {
    expect(verifyChallengeToken("example.com", tamper(token), NOW, SECRET)).toBeNull();
  });

  it("rejects tokens of a different length", () => {
    expect(verifyChallengeToken("example.com", token + "0", NOW, SECRET)).toBeNull();
    expect(verifyChallengeToken("example.com", "", NOW, SECRET)).toBeNull();
  });

  it("rejects a token issued for another domain", () => {
    const other = generateChallenge("other.com", NOW, SECRET).token;
    expect(verifyChallengeToken("example.com", other, NOW, SECRET)).toBeNull();
  });

  it("rejects a token derived with a different secret", () => {
    expect(verifyChallengeToken("example.com", token, NOW, OTHER_SECRET)).toBeNull();
  });
});

describe("SLICE-102-3: isChallengeExpired()", () => {
  it("returns false for non-expired challenge", () => {
    const challenge = generateChallenge("example.com", NOW, SECRET);
    expect(isChallengeExpired(challenge, new Date("2026-01-02T00:00:00Z"))).toBe(false);
  });

  it("returns true for expired challenge", () => {
    const challenge = generateChallenge("example.com", "2025-01-01T00:00:00Z", SECRET);
    expect(isChallengeExpired(challenge, new Date("2026-09-04T00:00:00Z"))).toBe(true);
  });
});

describe("TRUST_CHALLENGE_SECRET config", () => {
  const saved = { secret: process.env.TRUST_CHALLENGE_SECRET, nodeEnv: process.env.NODE_ENV };

  beforeEach(() => resetTrustConfigCache());

  afterEach(() => {
    if (saved.secret === undefined) delete process.env.TRUST_CHALLENGE_SECRET;
    else process.env.TRUST_CHALLENGE_SECRET = saved.secret;
    process.env.NODE_ENV = saved.nodeEnv;
    resetTrustConfigCache();
  });

  it("uses TRUST_CHALLENGE_SECRET when set", () => {
    process.env.TRUST_CHALLENGE_SECRET = SECRET;
    expect(getTrustConfig().challengeSecret).toBe(SECRET);
    expect(generateChallenge("example.com", NOW).token).toBe(generateChallenge("example.com", NOW, SECRET).token);
  });

  it("rejects a secret shorter than 32 chars", () => {
    process.env.TRUST_CHALLENGE_SECRET = "short";
    const errors: string[] = [];
    loadTrust(errors);
    expect(errors.join()).toContain("TRUST_CHALLENGE_SECRET");
    expect(() => getTrustConfig()).toThrow(/TRUST_CHALLENGE_SECRET/);
  });

  it("requires the secret in production", () => {
    delete process.env.TRUST_CHALLENGE_SECRET;
    process.env.NODE_ENV = "production";
    expect(() => getTrustConfig()).toThrow(/TRUST_CHALLENGE_SECRET/);
  });

  it("falls back to a process-stable random secret outside production", () => {
    delete process.env.TRUST_CHALLENGE_SECRET;
    process.env.NODE_ENV = "test";
    const first = getTrustConfig().challengeSecret;
    resetTrustConfigCache();
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(getTrustConfig().challengeSecret).toBe(first);
  });
});
