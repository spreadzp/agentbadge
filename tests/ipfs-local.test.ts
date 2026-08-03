import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PassportMetadata } from "@agentgate-hedera/hedera-core";

const TEST_STORAGE = join(tmpdir(), `ipfs-test-${Date.now()}`);

const sampleMetadata: PassportMetadata = {
  name: "Agent Passport #1",
  description: "On-chain identity for AI agent Hermes",
  image: "ipfs://QmImageCid/passport-bronze.png",
  attributes: [
    { trait_type: "Tier", value: "bronze" },
    { trait_type: "DID", value: "did:hcs:0.0.123:1" },
    { trait_type: "Agent Name", value: "Hermes" },
    { trait_type: "Capabilities", value: "api_call,payment" },
    { trait_type: "Issued At", value: "1700000000" },
    { trait_type: "Expires At", value: "0" },
  ],
  did: "did:hcs:0.0.123:1",
  tier: "bronze",
  capabilities: ["api_call", "payment"],
  accountId: "0.0.200",
  issuedAt: 1700000000,
  endpoint: "https://hermes.agent/api",
  version: 1,
  issuer: "AgentBadge",
};

describe("ipfs/local", () => {
  beforeEach(() => {
    vi.stubEnv("MOCK_IPFS", "true");
    vi.stubEnv("IPFS_STORAGE", TEST_STORAGE);
  });

  afterEach(async () => {
    if (existsSync(TEST_STORAGE)) {
      await rm(TEST_STORAGE, { recursive: true, force: true });
    }
  });

  it("uploadMetadata writes file and returns local://{hash}", async () => {
    const { uploadMetadata } = await import("@agentgate-hedera/passport");
    const uri = await uploadMetadata(sampleMetadata);
    expect(uri).toMatch(/^local:\/\/[a-f0-9]{64}$/);
    const hash = uri.replace("local://", "");
    const filePath = join(TEST_STORAGE, `${hash}.json`);
    expect(existsSync(filePath)).toBe(true);
    const content = JSON.parse(await readFile(filePath, "utf8"));
    expect(content.name).toBe(sampleMetadata.name);
    expect(content.attributes).toEqual(sampleMetadata.attributes);
  });

  it("retrieveMetadata reads back the same JSON", async () => {
    const { uploadMetadata, retrieveMetadata } = await import("@agentgate-hedera/passport");
    const uri = await uploadMetadata(sampleMetadata);
    const retrieved = await retrieveMetadata(uri);
    expect(retrieved.name).toBe(sampleMetadata.name);
    expect(retrieved.did).toBe(sampleMetadata.did);
    expect(retrieved.attributes).toHaveLength(6);
    expect(retrieved.tier).toBe("bronze");
  });

  it("uploadMetadata is deterministic — same data → same hash", async () => {
    const { uploadMetadata } = await import("@agentgate-hedera/passport");
    const uri1 = await uploadMetadata(sampleMetadata);
    const uri2 = await uploadMetadata(sampleMetadata);
    expect(uri1).toBe(uri2);
  });
});
