import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PassportMetadata } from "@agentbadge/hedera-core";

const sampleMetadata: PassportMetadata = {
  name: "Agent Passport #1",
  description: "On-chain identity for AI agent Hermes",
  image: "ipfs://QmImageCid/passport-bronze.png",
  attributes: [
    { trait_type: "Tier", value: "bronze" },
    { trait_type: "DID", value: "did:hcs:0.0.123:1" },
  ],
  did: "did:hcs:0.0.123:1",
  tier: "bronze",
  capabilities: ["api_call"],
  accountId: "0.0.200",
  issuedAt: 1700000000,
  endpoint: "https://hermes.agent/api",
  version: 1,
  issuer: "AgentBadge",
};

describe("ipfs/upload", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.stubEnv("IPFS_API_KEY", "test-key");
    vi.stubEnv("IPFS_API_SECRET", "test-secret");
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input: any, init?: RequestInit) => {
        const urlStr = typeof input === "string" ? input : input.toString();
        if (urlStr.includes("pinata.cloud") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          const cid = `bafyreia${body.pinataContent.name.replace(/\s/g, "").toLowerCase()}`;
          return new Response(JSON.stringify({ IpfsHash: cid }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(sampleMetadata), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("uploadMetadata returns ipfs://{cid}", async () => {
    const { uploadMetadata } = await import("@agentbadge/passport");
    const uri = await uploadMetadata(sampleMetadata);
    expect(uri).toMatch(/^ipfs:\/\/bafyrei/);
  });

  it("retrieveMetadata fetches via IPFS gateway and parses JSON", async () => {
    const { retrieveMetadata } = await import("@agentbadge/passport");
    const cid = "bafyreiatestcid123";
    const result = await retrieveMetadata(`ipfs://${cid}`);
    expect(result.name).toBe(sampleMetadata.name);
    expect(result.did).toBe(sampleMetadata.did);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining(cid));
  });

  it("uploadMetadata throws if IPFS_API_KEY not set", async () => {
    vi.stubEnv("IPFS_API_KEY", "");
    vi.stubEnv("IPFS_API_SECRET", "");
    const { uploadMetadata } = await import("@agentbadge/passport");
    await expect(uploadMetadata(sampleMetadata)).rejects.toThrow("IPFS_API_KEY");
  });
});
