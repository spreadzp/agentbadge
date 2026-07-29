import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock passport.service before importing MCP tools
vi.mock("@agentgate-hedera/passport", async (importOriginal) => ({
  ...await importOriginal(),
  issuePassport: vi.fn(),
  getPassportInfo: vi.fn(),
  listAllPassports: vi.fn(),
  listPassportsByAddress: vi.fn(),
  upgradeTier: vi.fn(),
  revokePassport: vi.fn(),
}));

import {
  issuePassport,
  getPassportInfo,
  listAllPassports,
  upgradeTier,
  revokePassport,
} from "@agentgate-hedera/passport";
import { registerPassportTools } from "@agentgate-hedera/mcp";
import { handleHttpToolCall, listTools } from "@agentgate-hedera/mcp";

// ─── Tool Registration ────────────────────────────────────────

describe("Passport MCP tools registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPassportTools();
  });

  it("registers all 6 passport tools", () => {
    const tools = listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("request_passport");
    expect(names).toContain("verify_passport");
    expect(names).toContain("get_passport");
    expect(names).toContain("list_passports");
    expect(names).toContain("upgrade_tier");
    expect(names).toContain("revoke_passport");
  });
});

// ─── request_passport ─────────────────────────────────────────

describe("request_passport tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPassportTools();
  });

  it("delegates to issuePassport with correct params", async () => {
    vi.mocked(issuePassport).mockResolvedValue({
      tokenId: "0.0.100",
      serialNumber: 1,
      did: "did:hcs:0.0.100:1",
      tier: "bronze",
      hashScanLink: "https://hashscan.io/testnet/tx/0xabc",
    });

    const result = await handleHttpToolCall("request_passport", {
      accountId: "0.0.500",
      signature: "0xdeadbeef",
      tier: "bronze",
      name: "TestAgent",
      capabilities: ["api_call", "payment"],
      endpoint: "https://agent.example.com",
    });

    expect(result.isError).toBeFalsy();
    expect(issuePassport).toHaveBeenCalledWith(
      "0.0.500",
      "0xdeadbeef",
      "bronze",
      "TestAgent",
      ["api_call", "payment"],
      "https://agent.example.com",
      undefined,
      undefined,
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tokenId).toBe("0.0.100");
    expect(parsed.did).toBe("did:hcs:0.0.100:1");
  });

  it("returns MCP error for invalid tier", async () => {
    const result = await handleHttpToolCall("request_passport", {
      accountId: "0.0.500",
      signature: "0xdeadbeef",
      tier: "invalid_tier",
      name: "TestAgent",
      capabilities: ["api_call"],
      endpoint: "https://agent.example.com",
    });

    expect(result.isError).toBe(true);
    expect(issuePassport).not.toHaveBeenCalled();
  });
});

// ─── verify_passport ──────────────────────────────────────────

describe("verify_passport tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPassportTools();
  });

  it("delegates to getPassportInfo", async () => {
    vi.mocked(getPassportInfo).mockResolvedValue({
      active: true,
      tokenId: "0.0.100",
      serialNumber: 1,
      tier: "bronze",
      capabilities: ["api_call"],
      did: "did:hcs:0.0.100:1",
      owner: "0.0.500",
      issuedAt: 1700000000,
    });

    const result = await handleHttpToolCall("verify_passport", {
      tokenId: "0.0.100",
      serial: 1,
    });

    expect(result.isError).toBeFalsy();
    expect(getPassportInfo).toHaveBeenCalledWith("0.0.100", 1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.active).toBe(true);
    expect(parsed.did).toBe("did:hcs:0.0.100:1");
  });

  it("returns MCP error when passport not found", async () => {
    vi.mocked(getPassportInfo).mockResolvedValue(null);

    const result = await handleHttpToolCall("verify_passport", {
      tokenId: "0.0.999",
      serial: 99,
    });

    expect(result.isError).toBe(true);
  });
});

// ─── get_passport ─────────────────────────────────────────────

describe("get_passport tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPassportTools();
  });

  it("delegates to getPassportInfo (same as verify for MVP)", async () => {
    vi.mocked(getPassportInfo).mockResolvedValue({
      active: true,
      tokenId: "0.0.100",
      serialNumber: 1,
      tier: "silver",
      capabilities: ["api_call", "data_provide"],
      did: "did:hcs:0.0.100:1",
      owner: "0.0.500",
      issuedAt: 1700000000,
    });

    const result = await handleHttpToolCall("get_passport", {
      tokenId: "0.0.100",
      serial: 1,
    });

    expect(result.isError).toBeFalsy();
    expect(getPassportInfo).toHaveBeenCalledWith("0.0.100", 1);
  });
});

// ─── list_passports ───────────────────────────────────────────

describe("list_passports tool", () => {
  const originalTokenId = process.env.PASSPORT_TOKEN_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PASSPORT_TOKEN_ID = "0.0.100";
    registerPassportTools();
  });

  afterEach(() => {
    if (originalTokenId === undefined) {
      delete process.env.PASSPORT_TOKEN_ID;
    } else {
      process.env.PASSPORT_TOKEN_ID = originalTokenId;
    }
  });

  it("delegates to listAllPassports", async () => {
    vi.mocked(listAllPassports).mockResolvedValue([
      {
        active: true,
        tokenId: "0.0.100",
        serialNumber: 1,
        tier: "bronze",
        capabilities: ["api_call"],
        did: "did:hcs:0.0.100:1",
        owner: "0.0.500",
        issuedAt: 1700000000,
      },
    ]);

    const result = await handleHttpToolCall("list_passports", {});

    expect(result.isError).toBeFalsy();
    expect(listAllPassports).toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.passports).toHaveLength(1);
  });
});

// ─── upgrade_tier ─────────────────────────────────────────────

describe("upgrade_tier tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPassportTools();
  });

  it("delegates to upgradeTier with correct params", async () => {
    vi.mocked(upgradeTier).mockResolvedValue({
      active: true,
      tokenId: "0.0.100",
      serialNumber: 1,
      tier: "gold",
      capabilities: ["api_call", "data_provide"],
      did: "did:hcs:0.0.100:1",
      owner: "0.0.500",
      issuedAt: 1700000000,
    });

    const result = await handleHttpToolCall("upgrade_tier", {
      tokenId: "0.0.100",
      serial: 1,
      newTier: "gold",
      accountId: "0.0.500",
    });

    expect(result.isError).toBeFalsy();
    expect(upgradeTier).toHaveBeenCalledWith("0.0.100", 1, "gold", "0.0.500");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tier).toBe("gold");
  });

  it("returns MCP error for invalid tier", async () => {
    const result = await handleHttpToolCall("upgrade_tier", {
      tokenId: "0.0.100",
      serial: 1,
      newTier: "diamond",
      accountId: "0.0.500",
    });

    expect(result.isError).toBe(true);
    expect(upgradeTier).not.toHaveBeenCalled();
  });
});

// ─── revoke_passport ──────────────────────────────────────────

describe("revoke_passport tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerPassportTools();
  });

  it("delegates to revokePassport with correct params", async () => {
    vi.mocked(revokePassport).mockResolvedValue({ did: "did:hcs:0.0.100:1" });

    const result = await handleHttpToolCall("revoke_passport", {
      tokenId: "0.0.100",
      serial: 1,
      reason: "compromised",
    });

    expect(result.isError).toBeFalsy();
    expect(revokePassport).toHaveBeenCalledWith("0.0.100", 1, "compromised");
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.did).toBe("did:hcs:0.0.100:1");
  });

  it("returns MCP error when passport not found", async () => {
    vi.mocked(revokePassport).mockRejectedValue(new Error("Passport not found"));

    const result = await handleHttpToolCall("revoke_passport", {
      tokenId: "0.0.999",
      serial: 99,
      reason: "test",
    });

    expect(result.isError).toBe(true);
  });
});
