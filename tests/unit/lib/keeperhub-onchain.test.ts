import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReadContract, mockCreatePublicClient } = vi.hoisted(() => {
  const mockReadContract = vi.fn();
  const mockCreatePublicClient = vi.fn(() => ({
    readContract: mockReadContract,
  }));
  return { mockReadContract, mockCreatePublicClient };
});

vi.mock("viem", () => ({
  createPublicClient: mockCreatePublicClient,
  http: vi.fn(() => ({})),
}));

vi.mock("viem/chains", () => ({
  baseSepolia: { id: 84532, name: "Base Sepolia" },
}));

vi.mock("../../../src/config/env.js", () => ({
  getConfig: vi.fn(() => ({
    base: {
      rpcUrl: "https://sepolia.base.org",
      chainId: 84532,
      trustRegistry: "0xreg123",
      trustBadge: "0xbadge123",
    },
  })),
}));

import { readLatestScoreFor, readRecentRecords, resetKeeperHubPublicClient } from "../../../src/server/lib/keeperhub-onchain";

describe("SLICE-126-11: keeperhub-onchain reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetKeeperHubPublicClient();
  });

  it("readLatestScoreFor happy → parses bigint tuple into numbers", async () => {
    mockReadContract.mockResolvedValue([85n, 1700000000n, true]);
    const result = await readLatestScoreFor("0xreg123", "https://example.com");
    expect(result).toEqual({ score: 85, recordedAt: 1700000000, valid: true });
  });

  it("readLatestScoreFor readContract throws → null (no throw)", async () => {
    mockReadContract.mockRejectedValue(new Error("RPC error"));
    const result = await readLatestScoreFor("0xreg123", "https://example.com");
    expect(result).toBeNull();
  });

  it("readRecentRecords: total 5, count 3 → ids 5,4,3 newest first", async () => {
    // First call: getRecordCount → 5
    // Then 3 calls: getRecord(5), getRecord(4), getRecord(3)
    mockReadContract
      .mockResolvedValueOnce(5n)
      .mockResolvedValueOnce(["https://e.com", 90n, "1.0", 140n, 1700000005n, false])
      .mockResolvedValueOnce(["https://d.com", 80n, "1.0", 130n, 1700000004n, false])
      .mockResolvedValueOnce(["https://c.com", 70n, "1.0", 120n, 1700000003n, false]);

    const result = await readRecentRecords("0xreg123", 3);
    expect(result).toHaveLength(3);
    expect(result![0].id).toBe(5);
    expect(result![1].id).toBe(4);
    expect(result![2].id).toBe(3);
    expect(result![0].siteUrl).toBe("https://e.com");
    expect(result![0].score).toBe(90);
  });

  it("readRecentRecords: zero records → []", async () => {
    mockReadContract.mockResolvedValueOnce(0n);
    const result = await readRecentRecords("0xreg123", 10);
    expect(result).toEqual([]);
  });

  it("readRecentRecords: readContract throws → null", async () => {
    mockReadContract.mockRejectedValueOnce(new Error("RPC down"));
    const result = await readRecentRecords("0xreg123", 5);
    expect(result).toBeNull();
  });

  it("client cached between calls (createPublicClient called once)", async () => {
    mockReadContract.mockResolvedValue([50n, 1700000000n, true]);
    await readLatestScoreFor("0xreg123", "https://a.com");
    await readLatestScoreFor("0xreg123", "https://b.com");
    expect(mockCreatePublicClient).toHaveBeenCalledTimes(1);
  });

  it("resetKeeperHubPublicClient → next call creates new client", async () => {
    mockReadContract.mockResolvedValue([50n, 1700000000n, true]);
    await readLatestScoreFor("0xreg123", "https://a.com");
    resetKeeperHubPublicClient();
    await readLatestScoreFor("0xreg123", "https://b.com");
    expect(mockCreatePublicClient).toHaveBeenCalledTimes(2);
  });
});
