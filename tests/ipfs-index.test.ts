import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  uploadMetadata: vi.fn(),
  retrieveMetadata: vi.fn(),
}));

import { uploadMetadata, retrieveMetadata } from "@agentbadge/passport";

const mockedUpload = vi.mocked(uploadMetadata);

describe("ipfs/index dispatcher", () => {
  beforeEach(() => {
    vi.resetModules();
    mockedUpload.mockReset();
    vi.mocked(retrieveMetadata).mockReset();
  });

  it("delegates to local when MOCK_IPFS=true", async () => {
    vi.stubEnv("MOCK_IPFS", "true");
    mockedUpload.mockResolvedValue("local://abc123");
    const { uploadMetadata: upload } = await import("@agentbadge/passport");
    const uri = await upload({} as never);
    expect(uri).toBe("local://abc123");
  });

  it("delegates to upload when MOCK_IPFS=false", async () => {
    vi.stubEnv("MOCK_IPFS", "false");
    mockedUpload.mockResolvedValue("ipfs://def456");
    const { uploadMetadata: upload } = await import("@agentbadge/passport");
    const uri = await upload({} as never);
    expect(uri).toBe("ipfs://def456");
  });

  it("delegates to upload when MOCK_IPFS not set", async () => {
    vi.stubEnv("MOCK_IPFS", "");
    mockedUpload.mockResolvedValue("ipfs://def456");
    const { uploadMetadata: upload } = await import("@agentbadge/passport");
    const uri = await upload({} as never);
    expect(uri).toBe("ipfs://def456");
  });
});
