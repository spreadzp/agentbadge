import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { trustViewerRoutes } from "../../../src/server/routes/trust-viewer";
import { TrustViewer, TrustViewerNotFound, TrustViewerError } from "../../../src/views/trust-viewer";
import { makeValidSnapshot } from "./fixtures/verification-fixtures";
import {
  createAutoAttestHook,
  defaultAutoAttestConfig,
  type AutoAttestConfig,
  type AttestFunction,
} from "../../../src/agent-readiness/trust/auto-attest-hook";

describe("SLICE-102-9: Web UI Trust Viewer", () => {
  describe("TrustViewer HTML template", () => {
    it("renders verified snapshot with badge", () => {
      const { snapshot } = makeValidSnapshot();
      const html = TrustViewer(snapshot, { valid: true, checks: [], reason: undefined }).toString();
      expect(html).toContain(snapshot.domain);
      expect(html).toContain("Verified");
      expect(html).toContain("Score Summary");
      expect(html).toContain("Domain Ownership");
      expect(html).toContain("On-Chain Attestation");
      expect(html).toContain("Integrity");
    });

    it("renders not-attested message when on_chain is absent", () => {
      const { snapshot } = makeValidSnapshot();
      const html = TrustViewer(snapshot, { valid: true, checks: [], reason: undefined }).toString();
      expect(html).toContain("Not yet attested on-chain");
    });

    it("renders on-chain details when present", () => {
      const { snapshot } = makeValidSnapshot();
      snapshot.on_chain = {
        chain: "base",
        chain_id: 84532,
        contract_address: "0x1234567890abcdef",
        token_id: 42,
        tx_hash: "0xabcdef1234567890",
        attested_at: "2025-01-01T00:00:00Z",
        attested_by: "0xowner",
        revoked: false,
      };
      const html = TrustViewer(snapshot, { valid: true, checks: [], reason: undefined }).toString();
      expect(html).toContain("base");
      expect(html).toContain("0xabcdef1234567890");
      expect(html).toContain("basescan.org");
    });

    it("renders verification checks", () => {
      const { snapshot } = makeValidSnapshot();
      const result = {
        valid: true,
        checks: [
          { name: "structural", passed: true },
          { name: "hash", passed: true, detail: "sha256 matched" },
          { name: "signature", passed: false, detail: "invalid" },
        ],
        reason: undefined,
      };
      const html = TrustViewer(snapshot, result).toString();
      expect(html).toContain("structural");
      expect(html).toContain("hash");
      expect(html).toContain("signature");
      expect(html).toContain("sha256 matched");
    });

    it("renders not-found page", () => {
      const html = TrustViewerNotFound("unknown.example.com").toString();
      expect(html).toContain("unknown.example.com");
      expect(html).toContain("Not Verified");
      expect(html).toContain("Generate Challenge");
    });

    it("renders error page", () => {
      const html = TrustViewerError("api.example.com", "Something went wrong").toString();
      expect(html).toContain("api.example.com");
      expect(html).toContain("Error");
      expect(html).toContain("Something went wrong");
    });
  });

  describe("GET /trust/:domain", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.route("/", trustViewerRoutes);
    });

    it("returns 404 for unknown domain (fetch fails)", async () => {
      const res = await app.request("/trust/unknown.example.com");
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain("Not Verified");
    });
  });
});

describe("SLICE-102-9: Auto-Attestation Hook", () => {
  describe("createAutoAttestHook", () => {
    it("skips when auto-attest is disabled", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: false,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      await hook({ domain: "example.com", hasVerifiedOwnership: true, hasPassport: true });

      expect(attestFn).not.toHaveBeenCalled();
    });

    it("skips when domain has no verified ownership", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      await hook({ domain: "example.com", hasVerifiedOwnership: false, hasPassport: true });

      expect(attestFn).not.toHaveBeenCalled();
    });

    it("skips when no passport exists", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      await hook({ domain: "example.com", hasVerifiedOwnership: true, hasPassport: false });

      expect(attestFn).not.toHaveBeenCalled();
    });

    it("attests when score changed > threshold", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      await hook({
        domain: "example.com",
        hasVerifiedOwnership: true,
        hasPassport: true,
        score: 80,
        lastAttestationScore: 70,
        lastAttestationAt: new Date().toISOString(),
      });

      expect(attestFn).toHaveBeenCalledWith("example.com");
    });

    it("skips when score change < threshold and attestation is recent", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      await hook({
        domain: "example.com",
        hasVerifiedOwnership: true,
        hasPassport: true,
        score: 72,
        lastAttestationScore: 70,
        lastAttestationAt: new Date().toISOString(),
      });

      expect(attestFn).not.toHaveBeenCalled();
    });

    it("attests when attestation is older than max age", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);

      await hook({
        domain: "example.com",
        hasVerifiedOwnership: true,
        hasPassport: true,
        score: 70,
        lastAttestationScore: 70,
        lastAttestationAt: oldDate.toISOString(),
      });

      expect(attestFn).toHaveBeenCalledWith("example.com");
    });

    it("attests on first run (no previous attestation)", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: true });
      const hook = createAutoAttestHook(config, attestFn);

      await hook({
        domain: "example.com",
        hasVerifiedOwnership: true,
        hasPassport: true,
        score: 75,
      });

      expect(attestFn).toHaveBeenCalledWith("example.com");
    });

    it("handles attestation failure gracefully (logs, does not throw)", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockResolvedValue({ success: false, error: "tx failed" });
      const logFn = vi.fn();
      const hook = createAutoAttestHook(config, attestFn, logFn);

      await expect(
        hook({
          domain: "example.com",
          hasVerifiedOwnership: true,
          hasPassport: true,
          score: 80,
          lastAttestationScore: 70,
          lastAttestationAt: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined();

      expect(logFn).toHaveBeenCalledWith(
        expect.stringContaining("Auto-attestation failed"),
        expect.objectContaining({ error: "tx failed" }),
      );
    });

    it("handles attestation throw gracefully (logs, does not throw)", async () => {
      const config: AutoAttestConfig = {
        trustAutoAttest: true,
        trustReAttestThreshold: 5,
        trustReAttestMaxAge: 7,
      };
      const attestFn: AttestFunction = vi.fn().mockRejectedValue(new Error("network error"));
      const logFn = vi.fn();
      const hook = createAutoAttestHook(config, attestFn, logFn);

      await expect(
        hook({
          domain: "example.com",
          hasVerifiedOwnership: true,
          hasPassport: true,
          score: 80,
        }),
      ).resolves.toBeUndefined();

      expect(logFn).toHaveBeenCalledWith(
        expect.stringContaining("Auto-attestation error"),
        expect.objectContaining({ error: "network error" }),
      );
    });
  });

  describe("defaultAutoAttestConfig", () => {
    it("returns disabled by default", () => {
      const oldVal = process.env.TRUST_AUTO_ATTEST;
      delete process.env.TRUST_AUTO_ATTEST;
      const config = defaultAutoAttestConfig();
      expect(config.trustAutoAttest).toBe(false);
      expect(config.trustReAttestThreshold).toBe(5);
      expect(config.trustReAttestMaxAge).toBe(7);
      if (oldVal) process.env.TRUST_AUTO_ATTEST = oldVal;
    });

    it("reads env vars when set", () => {
      process.env.TRUST_AUTO_ATTEST = "true";
      process.env.TRUST_REATTEST_THRESHOLD = "10";
      process.env.TRUST_REATTEST_MAX_AGE = "14";
      const config = defaultAutoAttestConfig();
      expect(config.trustAutoAttest).toBe(true);
      expect(config.trustReAttestThreshold).toBe(10);
      expect(config.trustReAttestMaxAge).toBe(14);
      delete process.env.TRUST_AUTO_ATTEST;
      delete process.env.TRUST_REATTEST_THRESHOLD;
      delete process.env.TRUST_REATTEST_MAX_AGE;
    });
  });
});
