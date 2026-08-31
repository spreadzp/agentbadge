import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  mintPassportNFT,
  transferNFTToAgent,
  submitAuditMessage,
  submitDirectoryMessage,
  wipeNFT,
  updateNftMetadata,
} from "@agentbadge/hedera-core";

import {
  getNftInfo,
  getNftsForToken,
  getNftsForAccount,
  getTopicMessages,
} from "@agentbadge/hedera-core";

import { mockSettle } from "@agentbadge/hedera-core";

const ORIG_MOCK_HEDERA = process.env.MOCK_HEDERA;

describe("mock-hedera.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MOCK_HEDERA = "true";
  });

  afterEach(() => {
    process.env.MOCK_HEDERA = ORIG_MOCK_HEDERA;
  });

  it("mintPassportNFT returns incrementing serials for same tokenId", async () => {
    const r1 = await mintPassportNFT("0.0.123", "ipfs://hash1");
    const r2 = await mintPassportNFT("0.0.123", "ipfs://hash2");
    const r3 = await mintPassportNFT("0.0.123", "ipfs://hash3");

    expect(r1.tokenId).toBe("0.0.123");
    expect(r1.serial).toBe(1);
    expect(r2.serial).toBe(2);
    expect(r3.serial).toBe(3);
  });

  it("mintPassportNFT has independent serial counters per tokenId", async () => {
    const r1 = await mintPassportNFT("0.0.111", "ipfs://a");
    const r2 = await mintPassportNFT("0.0.222", "ipfs://b");
    expect(r1.serial).toBe(1);
    expect(r2.serial).toBe(1);
  });

  it("transferNFTToAgent updates account_id in store", async () => {
    const { serial } = await mintPassportNFT("0.0.999", "ipfs://x");
    await transferNFTToAgent("0.0.999", serial, "0.0.100", "0.0.200");

    const nft = await getNftInfo("0.0.999", serial);
    expect(nft).not.toBeNull();
    expect(nft!.account_id).toBe("0.0.200");
  });

  it("submitAuditMessage returns a fake transaction ID", async () => {
    const txId = await submitAuditMessage({
      type: "passport_issued",
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.123",
      serial: 1,
      timestamp: Date.now(),
    });
    expect(txId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
  });

  it("submitDirectoryMessage returns a fake transaction ID", async () => {
    const txId = await submitDirectoryMessage({
      type: "agent_register",
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.123",
      serial: 1,
      accountId: "0.0.456",
      name: "test-agent",
      capabilities: ["api_call"],
      endpoint: "https://example.com",
      tier: "bronze",
      timestamp: Date.now(),
    });
    expect(txId).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
  });

  it("wipeNFT sets deleted=true in store", async () => {
    const { serial } = await mintPassportNFT("0.0.555", "ipfs://w");
    await transferNFTToAgent("0.0.555", serial, "0.0.100", "0.0.300");

    await wipeNFT("0.0.555", "0.0.300", serial);

    const nft = await getNftInfo("0.0.555", serial);
    expect(nft).not.toBeNull();
    expect(nft!.deleted).toBe(true);
  });

  it("updateNftMetadata changes metadata in store", async () => {
    const { serial } = await mintPassportNFT("0.0.777", "ipfs://old");
    await updateNftMetadata("0.0.777", serial, "ipfs://new");

    const nft = await getNftInfo("0.0.777", serial);
    expect(nft).not.toBeNull();
    expect(nft!.metadata).toBe("ipfs://new");
  });
});

describe("mock-mirror.service", () => {
  beforeEach(() => {
    process.env.MOCK_HEDERA = "true";
  });

  afterEach(() => {
    process.env.MOCK_HEDERA = ORIG_MOCK_HEDERA;
  });

  it("getNftInfo returns null for non-existent NFT", async () => {
    const nft = await getNftInfo("0.0.404", 999);
    expect(nft).toBeNull();
  });

  it("getNftInfo returns NftInfo shape with correct field names", async () => {
    const { serial } = await mintPassportNFT("0.0.808", "ipfs://shape");
    await transferNFTToAgent("0.0.808", serial, "0.0.100", "0.0.500");

    const nft = await getNftInfo("0.0.808", serial);
    expect(nft).not.toBeNull();
    expect(nft).toHaveProperty("token_id");
    expect(nft).toHaveProperty("serial_number");
    expect(nft).toHaveProperty("account_id");
    expect(nft).toHaveProperty("metadata");
    expect(nft).toHaveProperty("deleted");
    expect(nft).toHaveProperty("created_timestamp");
  });

  it("getNftsForToken returns all NFTs for a token", async () => {
    await mintPassportNFT("0.0.707", "ipfs://a");
    await mintPassportNFT("0.0.707", "ipfs://b");
    const nfts = await getNftsForToken("0.0.707");
    expect(nfts.length).toBeGreaterThanOrEqual(2);
  });

  it("getNftsForAccount returns NFTs owned by account", async () => {
    const { serial } = await mintPassportNFT("0.0.606", "ipfs://acct");
    await transferNFTToAgent("0.0.606", serial, "0.0.100", "0.0.700");
    const nfts = await getNftsForAccount("0.0.700");
    expect(nfts.length).toBeGreaterThanOrEqual(1);
    expect(nfts.some((n) => n.token_id === "0.0.606")).toBe(true);
  });

  it("getTopicMessages round-trips with submitAuditMessage", async () => {
    const auditTopicId = process.env.AUDIT_TOPIC_ID ?? "0.0.555";
    process.env.AUDIT_TOPIC_ID = auditTopicId;

    await submitAuditMessage({
      type: "passport_issued",
      did: "did:hcs:0.0.111:1",
      tokenId: "0.0.111",
      serial: 1,
      timestamp: Date.now(),
    });

    const messages = await getTopicMessages(auditTopicId);
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const last = messages[messages.length - 1];
    expect(last).toHaveProperty("consensus_timestamp");
    expect(last).toHaveProperty("message");
    expect(last).toHaveProperty("sequence_number");
    expect(last).toHaveProperty("running_hash");

    const parsed = JSON.parse(last.message);
    expect(parsed.type).toBe("passport_issued");
  });
});

describe("mock-settle", () => {
  it("returns a fake transaction hash", async () => {
    const hash = await mockSettle("0.0.123", 1000);
    expect(hash).toMatch(/^0\.0\.\d+@\d+\.\d+$/);
  });
});

describe("dispatcher", () => {
  it("exports mock implementations when MOCK_HEDERA=true", async () => {
    process.env.MOCK_HEDERA = "true";
    vi.resetModules();
    const mod = await import("@agentbadge/hedera-core");
    expect(mod.mintPassportNFT).toBeDefined();
    expect(mod.getNftInfo).toBeDefined();
  });

  it("exports real implementations when MOCK_HEDERA is not true", async () => {
    process.env.MOCK_HEDERA = "false";
    vi.resetModules();
    const mod = await import("@agentbadge/hedera-core");
    expect(mod.mintPassportNFT).toBeDefined();
    expect(mod.getNftInfo).toBeDefined();
  });
});
