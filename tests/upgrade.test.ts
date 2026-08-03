import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Tier, Capability } from "@agentgate-hedera/hedera-core";
import { resetMockState, mintPassportNFT, transferNFTToAgent } from "@agentgate-hedera/hedera-core";

import { upgradeRoutes } from "../src/server/routes/upgrade";
import { calculateUpgradePrice, upgradeTier, uploadMetadata } from "@agentgate-hedera/passport";
import type { PassportInfo } from "@agentgate-hedera/passport";

const mockNft = (overrides: Record<string, unknown> = {}) => ({
  token_id: "0.0.123",
  serial_number: 1,
  account_id: "0.0.456",
  deleted: false,
  metadata: "aHR0cHM6Ly9leGFtcGxlLmNvbS9tZXRhZGF0YS5qc29u",
  created_timestamp: "1700000000.123456789",
  ...overrides,
});

const mockMetadata = (overrides: Record<string, unknown> = {}) => ({
  name: "TestBot",
  description: "Agent Passport — TestBot (silver)",
  image: "ipfs://passport-silver.png",
  attributes: [],
  did: "did:hcs:0.0.123:1",
  tier: "silver" as Tier,
  capabilities: ["api_call"] as Capability[],
  accountId: "0.0.456",
  issuedAt: 1700000000,
  endpoint: "https://agent.example.com",
  version: 1,
  issuer: "AgentBadge",
  ...overrides,
});

describe("calculateUpgradePrice", () => {
  it("returns 165 HBAR for silver→gold (PRD exact example)", () => {
    expect(calculateUpgradePrice("silver", "gold")).toBe(165);
  });

  it("returns 330 HBAR for gold→platinum", () => {
    expect(calculateUpgradePrice("gold", "platinum")).toBe(330);
  });

  it("returns 44 HBAR for bronze→silver", () => {
    expect(calculateUpgradePrice("bronze", "silver")).toBe(44);
  });

  it("throws for downgrade (gold→silver)", () => {
    expect(() => calculateUpgradePrice("gold", "silver")).toThrow();
  });

  it("throws for same-tier upgrade (silver→silver)", () => {
    expect(() => calculateUpgradePrice("silver", "silver")).toThrow();
  });
});

describe("upgradeTier", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_IPFS", "true");
    vi.stubEnv("MOCK_HEDERA", "true");
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    vi.stubEnv("HEDERA_OPERATOR_ID", "0.0.100");
    vi.stubEnv("AUDIT_TOPIC_ID", "0.0.555");
    vi.clearAllMocks();
    resetMockState();
  });

  it("upgrades tier in-place: uploads new metadata, updates NFT, submits audit", async () => {
    // Seed mock: upload silver metadata to local IPFS, mint NFT with that URI
    const metadataUri = await uploadMetadata(mockMetadata({ tier: "silver" as Tier }));
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.456");

    const result = await upgradeTier("0.0.123", mintResult.serial, "gold", "0.0.456");

    expect(result.tier).toBe("gold");
    expect(result.serialNumber).toBe(mintResult.serial);
    expect(result.tokenId).toBe("0.0.123");
  });

  it("throws if passport not found", async () => {
    await expect(upgradeTier("0.0.123", 999, "gold", "0.0.456")).rejects.toThrow("not found");
  });

  it("throws if passport is revoked (deleted)", async () => {
    const metadataUri = await uploadMetadata(mockMetadata());
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.456");
    // Burn the NFT to mark it as deleted
    const { burnPassportNFT } = await import("@agentgate-hedera/hedera-core");
    await burnPassportNFT("0.0.123", mintResult.serial);

    await expect(upgradeTier("0.0.123", mintResult.serial, "gold", "0.0.456")).rejects.toThrow();
  });

  it("throws if requester does not own the passport", async () => {
    const metadataUri = await uploadMetadata(mockMetadata());
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.999");

    await expect(upgradeTier("0.0.123", mintResult.serial, "gold", "0.0.456")).rejects.toThrow("not owned");
  });

  it("throws for invalid downgrade", async () => {
    const metadataUri = await uploadMetadata(mockMetadata({ tier: "silver" as Tier }));
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.456");

    await expect(upgradeTier("0.0.123", mintResult.serial, "bronze", "0.0.456")).rejects.toThrow("downgrade");
  });
});

describe("POST /passport/:tokenId/:serial/upgrade", () => {
  let app: Hono;

  beforeEach(() => {
    vi.stubEnv("MOCK_IPFS", "true");
    vi.stubEnv("MOCK_HEDERA", "true");
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    vi.stubEnv("HEDERA_OPERATOR_ID", "0.0.100");
    vi.stubEnv("AUDIT_TOPIC_ID", "0.0.555");
    vi.clearAllMocks();
    resetMockState();
    app = new Hono();
    app.route("/", upgradeRoutes);
  });

  it("returns 400 for invalid tier transition (downgrade)", async () => {
    const metadataUri = await uploadMetadata(mockMetadata({ tier: "silver" as Tier }));
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.456");

    const res = await app.request(`/passport/0.0.123/${mintResult.serial}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newTier: "bronze", accountId: "0.0.456" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when requester does not own the passport", async () => {
    const metadataUri = await uploadMetadata(mockMetadata({ tier: "silver" as Tier }));
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.999");

    const res = await app.request(`/passport/0.0.123/${mintResult.serial}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newTier: "gold", accountId: "0.0.456" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when passport not found", async () => {
    const res = await app.request("/passport/0.0.123/999/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newTier: "gold", accountId: "0.0.456" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 on successful upgrade", async () => {
    const metadataUri = await uploadMetadata(mockMetadata({ tier: "silver" as Tier }));
    const mintResult = await mintPassportNFT("0.0.123", metadataUri);
    await transferNFTToAgent("0.0.123", mintResult.serial, "0.0.100", "0.0.456");

    const res = await app.request(`/passport/0.0.123/${mintResult.serial}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newTier: "gold", accountId: "0.0.456" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toBe("gold");
    expect(body.tokenId).toBe("0.0.123");
    expect(body.serialNumber).toBe(mintResult.serial);
  });
});
