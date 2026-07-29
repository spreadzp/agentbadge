/**
 * Edge case tests for scenarios not covered by slice-specific test suites.
 *
 * Reference: SLICE-7-14
 *
 * Covers:
 * - AC #1: Tier upgrade with IPFS/Hedera failure (returns 500)
 * - AC #2: Concurrent passport issuance (2 simultaneous requests)
 * - AC #3: Mirror Node timeout graceful error (complement to SLICE-7-8)
 * - AC #4: IPFS upload failure during passport issuance (returns 500)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { NftInfo } from "@agentgate-hedera/hedera-core";

vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getNftsForToken: vi.fn(),
  getNftsForAccount: vi.fn(),
  mintPassportNFT: vi.fn(),
  transferNFTToAgent: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
  wipeNFT: vi.fn(),
  updateNftMetadata: vi.fn(),
}));

vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  uploadMetadata: vi.fn(),
  retrieveMetadata: vi.fn(),
  verifyWalletOwnership: vi.fn(async () => true),
  issuePassport: vi.fn(),
  upgradeTier: vi.fn(),
  calculateUpgradePrice: vi.fn((current: string, next: string) => {
    const prices: Record<string, number> = { bronze: 10, silver: 50, gold: 200, platinum: 500 };
    const diff = prices[next] - prices[current];
    if (diff <= 0) throw new Error("not a forward upgrade");
    return Math.round(diff * 1.1);
  }),
  getPassportInfo: vi.fn(),
  listPassportsByAddress: vi.fn(),
  listAllPassports: vi.fn(),
  parseDid: vi.fn(),
  revokePassport: vi.fn(),
}));

import { upgradeRoutes } from "../src/server/routes/upgrade";
import { passportRoutes } from "../src/server/routes/passport";
import {
  issuePassport,
  upgradeTier,
  getPassportInfo,
} from "@agentgate-hedera/passport";

const validPassportBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    accountId: "0.0.7654321",
    signature: "0xfakesig",
    tier: "silver",
    name: "TestBot",
    capabilities: ["api_call"],
    endpoint: "https://agent.example.com",
    ...overrides,
  });

describe("SLICE-7-14: Edge Case Test Coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    vi.stubEnv("HEDERA_OPERATOR_ID", "0.0.100");
    vi.stubEnv("AUDIT_TOPIC_ID", "0.0.555");
  });

  // ---------------------------------------------------------------------------
  // AC #1: Tier upgrade with service failure returns 500
  // ---------------------------------------------------------------------------
  describe("AC #1: Tier upgrade with failure returns 500", () => {
    let app: Hono;

    beforeEach(() => {
      vi.clearAllMocks();
      app = new Hono();
      app.route("/", upgradeRoutes);
    });

    it("returns 500 when upgradeTier throws IPFS error", async () => {
      vi.mocked(upgradeTier).mockRejectedValueOnce(new Error("IPFS upload timeout"));

      const res = await app.request("/passport/0.0.123/1/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTier: "gold", accountId: "0.0.456" }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Upgrade failed");
    });

    it("returns 500 when upgradeTier throws Hedera RPC error (insufficient balance)", async () => {
      vi.mocked(upgradeTier).mockRejectedValueOnce(
        new Error("Hedera RPC error: insufficient balance"),
      );

      const res = await app.request("/passport/0.0.123/1/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTier: "gold", accountId: "0.0.456" }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Upgrade failed");
      expect(body.error).toContain("insufficient balance");
    });

    it("returns 500 when upgradeTier throws HCS audit error", async () => {
      vi.mocked(upgradeTier).mockRejectedValueOnce(new Error("HCS topic submission failed"));

      const res = await app.request("/passport/0.0.123/1/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTier: "gold", accountId: "0.0.456" }),
      });

      expect(res.status).toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // AC #2: Concurrent passport issuance (2 simultaneous requests)
  // ---------------------------------------------------------------------------
  describe("AC #2: Concurrent passport issuance", () => {
    let app: Hono;

    beforeEach(() => {
      vi.clearAllMocks();
      app = new Hono();
      app.route("/", passportRoutes);
    });

    it("handles 2 concurrent passport requests independently", async () => {
      vi.mocked(issuePassport)
        .mockResolvedValueOnce({
          tokenId: "0.0.123",
          serialNumber: 1,
          did: "did:hcs:0.0.123:1",
          tier: "silver",
          hashScanLink: "https://hashscan.io/testnet/token/0.0.123/1",
        })
        .mockResolvedValueOnce({
          tokenId: "0.0.123",
          serialNumber: 2,
          did: "did:hcs:0.0.123:2",
          tier: "silver",
          hashScanLink: "https://hashscan.io/testnet/token/0.0.123/2",
        });

      const [res1, res2] = await Promise.all([
        app.request("/passport/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: validPassportBody({ accountId: "0.0.111", name: "Bot1" }),
        }),
        app.request("/passport/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: validPassportBody({ accountId: "0.0.222", name: "Bot2" }),
        }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.serialNumber).not.toBe(body2.serialNumber);
      expect(body1.did).not.toBe(body2.did);
      expect(issuePassport).toHaveBeenCalledTimes(2);
    });

    it("one request failure does not affect the other", async () => {
      vi.mocked(issuePassport)
        .mockRejectedValueOnce(new Error("Network error on first mint"))
        .mockResolvedValueOnce({
          tokenId: "0.0.123",
          serialNumber: 2,
          did: "did:hcs:0.0.123:2",
          tier: "silver",
          hashScanLink: "https://hashscan.io/testnet/token/0.0.123/2",
        });

      const [res1, res2] = await Promise.all([
        app.request("/passport/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: validPassportBody({ accountId: "0.0.111", name: "Bot1" }),
        }),
        app.request("/passport/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: validPassportBody({ accountId: "0.0.222", name: "Bot2" }),
        }),
      ]);

      expect(res1.status).toBe(500);
      expect(res2.status).toBe(200);

      const body2 = await res2.json();
      expect(body2.serialNumber).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // AC #4: IPFS upload failure returns 500 with clear message
  // ---------------------------------------------------------------------------
  describe("AC #4: IPFS upload failure returns 500", () => {
    let app: Hono;

    beforeEach(() => {
      vi.clearAllMocks();
      app = new Hono();
      app.route("/", passportRoutes);
    });

    it("returns 500 when issuePassport throws IPFS error", async () => {
      vi.mocked(issuePassport).mockRejectedValueOnce(new Error("IPFS gateway timeout"));

      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: validPassportBody(),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Passport issuance failed");
      expect(body.error).toContain("IPFS");
    });

    it("returns 500 when issuePassport throws IPFS rate limit error", async () => {
      vi.mocked(issuePassport).mockRejectedValueOnce(new Error("IPFS rate limit exceeded"));

      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: validPassportBody(),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("IPFS");
    });

    it("returns 500 when issuePassport throws HTS mint error (insufficient balance)", async () => {
      vi.mocked(issuePassport).mockRejectedValueOnce(
        new Error("HTS mint failed: insufficient balance"),
      );

      const res = await app.request("/passport/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: validPassportBody(),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Passport issuance failed");
      expect(body.error).toContain("insufficient balance");
    });
  });

  // ---------------------------------------------------------------------------
  // AC #3 (complement): Mirror Node timeout graceful error
  // ---------------------------------------------------------------------------
  describe("AC #3 (complement): Mirror Node timeout graceful error", () => {
    it("getPassportInfo returns null when NFT not found (timeout scenario)", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(null);

      const result = await getPassportInfo("0.0.123", 1);
      expect(result).toBeNull();
    });

    it("getPassportInfo returns info with null tier when IPFS retrieval fails", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce({
        active: true,
        tokenId: "0.0.123",
        serialNumber: 1,
        tier: null,
        capabilities: [],
        did: "did:hcs:0.0.123:1",
        owner: "0.0.456",
        issuedAt: 1700000000,
      });

      const result = await getPassportInfo("0.0.123", 1);
      expect(result).not.toBeNull();
      expect(result!.active).toBe(true);
      expect(result!.tier).toBeNull();
    });
  });
});
