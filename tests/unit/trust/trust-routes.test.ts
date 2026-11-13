import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { trustRoutes } from "../../../src/server/routes/trust";
import { deriveChallengeToken, getChallengeEpoch } from "../../../src/agent-readiness/trust/challenge";
import { resetTrustConfigCache } from "../../../src/config/env/trust";

vi.mock("node:dns/promises", () => ({
  resolveTxt: vi.fn(),
}));

vi.mock("../../../src/agent-readiness/scanner/ssrf/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

import { resolveTxt } from "node:dns/promises";
import { safeFetch } from "../../../src/agent-readiness/scanner/ssrf/safe-fetch";

const SECRET = "test-trust-challenge-secret-0123456789abcdef";

describe("SLICE-102-7: Trust endpoints", () => {
  let app: Hono;
  const savedSecret = process.env.TRUST_CHALLENGE_SECRET;

  beforeEach(() => {
    process.env.TRUST_CHALLENGE_SECRET = SECRET;
    resetTrustConfigCache();
    vi.mocked(resolveTxt).mockReset().mockRejectedValue(new Error("ENOTFOUND"));
    vi.mocked(safeFetch).mockReset().mockRejectedValue(new Error("ECONNREFUSED"));
    app = new Hono();
    app.route("/", trustRoutes);
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.TRUST_CHALLENGE_SECRET;
    else process.env.TRUST_CHALLENGE_SECRET = savedSecret;
    resetTrustConfigCache();
  });

  async function getChallengeToken(domain: string): Promise<string> {
    const res = await app.request(`/api/trust/${domain}/challenge`);
    expect(res.status).toBe(200);
    return (await res.json()).token;
  }

  function verifyOwnership(domain: string, token: string) {
    return app.request(`/api/trust/${domain}/verify-ownership`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }

  describe("GET /api/trust/:domain", () => {
    it("returns 404 for unknown domain", async () => {
      const res = await app.request("/api/trust/unknown.example.com");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("No trust snapshot");
    });

    it("returns 404 for unknown domain with markdown format", async () => {
      const res = await app.request("/api/trust/unknown.example.com?format=markdown");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/trust/:domain/challenge", () => {
    it("returns challenge token with DNS record and well-known URL", async () => {
      const res = await app.request("/api/trust/api.example.com/challenge");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTruthy();
      expect(body.dns_record).toContain("_agentbadge-verify.api.example.com");
      expect(body.dns_record).toContain(body.token);
      expect(body.well_known_url).toContain("https://api.example.com/.well-known/agentbadge-verify.txt");
      expect(body.expires_at).toBeTruthy();
    });

    it("normalizes domain (lowercase)", async () => {
      const res = await app.request("/api/trust/Example.COM/challenge");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.dns_record).toContain("example.com");
    });

    it("returns the same token on repeated calls", async () => {
      const t1 = await getChallengeToken("api.example.com");
      const t2 = await getChallengeToken("api.example.com");
      const t3 = await getChallengeToken("API.example.com");
      expect(t2).toBe(t1);
      expect(t3).toBe(t1);
    });

    it("returns the same token after a restart with the same secret", async () => {
      const before = await getChallengeToken("api.example.com");
      resetTrustConfigCache();
      vi.resetModules();
      const { trustRoutes: freshRoutes } = await import("../../../src/server/routes/trust");
      const freshApp = new Hono();
      freshApp.route("/", freshRoutes);
      const res = await freshApp.request("/api/trust/api.example.com/challenge");
      expect((await res.json()).token).toBe(before);
    });

    it("returns different tokens for different domains", async () => {
      const a = await getChallengeToken("a.example.com");
      const b = await getChallengeToken("b.example.com");
      expect(a).not.toBe(b);
    });
  });

  describe("POST /api/trust/:domain/verify-ownership", () => {
    it("returns 400 for missing token", async () => {
      const res = await app.request("/api/trust/api.example.com/verify-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 403 for invalid token", async () => {
      const res = await app.request("/api/trust/api.example.com/verify-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "invalid-token" }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("Invalid or missing challenge token");
    });

    it("returns 403 for token with failed DNS verification", async () => {
      // Create a challenge first
      const challengeRes = await app.request("/api/trust/api.example.com/challenge");
      const challenge = await challengeRes.json();

      // Verify with the correct token (will fail on DNS verification since no real DNS)
      const res = await app.request("/api/trust/api.example.com/verify-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: challenge.token }),
      });
      // 403: DNS lookup and well-known fetch are mocked to fail
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("verification failed");
    });

    it("returns 200 with a valid token published in DNS", async () => {
      const token = await getChallengeToken("api.example.com");
      vi.mocked(resolveTxt).mockResolvedValue([[token]]);

      const res = await verifyOwnership("api.example.com", token);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.verified).toBe(true);
      expect(body.method).toBe("dns_txt");
      expect(body.challenge_token).toBe(token);
      expect(vi.mocked(resolveTxt)).toHaveBeenCalledWith("_agentbadge-verify.api.example.com");
    });

    it("still verifies after further unauthenticated challenge requests", async () => {
      const token = await getChallengeToken("api.example.com");
      await getChallengeToken("api.example.com");
      await getChallengeToken("api.example.com");
      vi.mocked(resolveTxt).mockResolvedValue([[token]]);

      const res = await verifyOwnership("api.example.com", token);
      expect(res.status).toBe(200);
    });

    it("returns 200 via well-known file when DNS has no record", async () => {
      const token = await getChallengeToken("api.example.com");
      vi.mocked(safeFetch).mockResolvedValue({
        status: 200,
        headers: {},
        body: new ArrayBuffer(0),
        bodyText: `${token}\n`,
        resolvedIp: "1.2.3.4",
        fetchTime: 100,
        redirectChain: [],
      });

      const res = await verifyOwnership("api.example.com", token);
      expect(res.status).toBe(200);
      expect((await res.json()).method).toBe("well_known_file");
    });

    it("returns 403 for a tampered token without hitting DNS", async () => {
      const token = await getChallengeToken("api.example.com");
      const tampered = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
      vi.mocked(resolveTxt).mockResolvedValue([[tampered]]);

      const res = await verifyOwnership("api.example.com", tampered);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("Invalid or missing challenge token");
      expect(vi.mocked(resolveTxt)).not.toHaveBeenCalled();
    });

    it("returns 403 for a token issued for another domain", async () => {
      const token = await getChallengeToken("other.example.com");
      const res = await verifyOwnership("api.example.com", token);
      expect(res.status).toBe(403);
    });

    it("accepts a previous-epoch token", async () => {
      const previous = deriveChallengeToken("api.example.com", getChallengeEpoch() - 1, SECRET);
      expect(previous).not.toBe(await getChallengeToken("api.example.com"));
      vi.mocked(resolveTxt).mockResolvedValue([[previous]]);

      const res = await verifyOwnership("api.example.com", previous);
      expect(res.status).toBe(200);
      expect((await res.json()).challenge_token).toBe(previous);
    });

    it("rejects a token two epochs old", async () => {
      const stale = deriveChallengeToken("api.example.com", getChallengeEpoch() - 2, SECRET);
      vi.mocked(resolveTxt).mockResolvedValue([[stale]]);

      const res = await verifyOwnership("api.example.com", stale);
      expect(res.status).toBe(403);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/api/trust/api.example.com/verify-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/trust/:domain/attest", () => {
    it("returns 400 for missing fields", async () => {
      const res = await app.request("/api/trust/api.example.com/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 for invalid signature", async () => {
      const res = await app.request("/api/trust/api.example.com/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: "0x1234567890abcdef",
          signature: "short",
          tier: "bronze",
        }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Invalid signature");
    });

    it("returns 404 when no passport found", async () => {
      const res = await app.request("/api/trust/api.example.com/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: "0x1234567890abcdef",
          signature: "0xvalid-signature-with-sufficient-length",
          tier: "bronze",
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toContain("No passport found");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await app.request("/api/trust/api.example.com/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("snapshot-markdown.ts", () => {
    it("renderSnapshotMarkdown produces readable markdown", async () => {
      const { renderSnapshotMarkdown } = await import("../../../src/agent-readiness/trust/snapshot-markdown");
      const { makeValidSnapshot } = await import("./fixtures/verification-fixtures");
      const { snapshot } = makeValidSnapshot();

      const md = renderSnapshotMarkdown(snapshot);
      expect(md).toContain(`# Trust Snapshot: ${snapshot.domain}`);
      expect(md).toContain("## Profile Reference");
      expect(md).toContain("## Evidence Root");
      expect(md).toContain("## Score Summary");
      expect(md).toContain("## Domain Ownership");
      expect(md).toContain("## Integrity");
      expect(md).toContain("## On-Chain Attestation");
      expect(md).toContain("## Verification");
    });

    it("renders 'not yet attested' when on_chain is absent", async () => {
      const { renderSnapshotMarkdown } = await import("../../../src/agent-readiness/trust/snapshot-markdown");
      const { makeValidSnapshot } = await import("./fixtures/verification-fixtures");
      const { snapshot } = makeValidSnapshot();

      const md = renderSnapshotMarkdown(snapshot);
      expect(md).toContain("Not yet attested on-chain");
    });
  });
});
