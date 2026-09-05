import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { trustRoutes } from "../../../src/server/routes/trust";
import { clearChallenges } from "../../../src/agent-readiness/trust/challenge-store";

describe("SLICE-102-7: Trust endpoints", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", trustRoutes);
    clearChallenges();
  });

  afterEach(() => {
    clearChallenges();
  });

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
      expect(body.dns_record).toContain("_agentbadge.api.example.com");
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
      // Will be 403 because DNS verification fails (no real DNS record)
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("verification failed");
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
