import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
}));

import {
  issuePassport,
  upgradeTier,
  revokePassport,
} from "@agentbadge/passport";
import { getNftInfo } from "@agentbadge/hedera-core";

const mockedGetNftInfo = vi.mocked(getNftInfo);

describe("operational logging — SLICE-7-7", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("MOCK_IPFS", "true");
    vi.stubEnv("MOCK_HEDERA", "true");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.HEDERA_OPERATOR_ID = "0.0.2";
    process.env.HEDERA_NETWORK = "testnet";
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("issuePassport logs agent name, tier, tokenId, serial", async () => {
    await issuePassport(
      "0.0.1001",
      "0xsignature",
      "gold",
      "TestBot",
      ["api_call"] as never,
      "https://agent.test",
    );

    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    const passportLog = calls.find((c) => c.includes("passport_issued"));
    expect(passportLog).toBeDefined();

    const parsed = JSON.parse(passportLog!);
    expect(parsed.context.name).toBe("TestBot");
    expect(parsed.context.tier).toBe("gold");
    expect(parsed.context.tokenId).toBe("0.0.1234567");
    expect(parsed.context.serial).toBe(1);
  });

  it("upgradeTier logs DID, old tier, new tier", async () => {
    mockedGetNftInfo.mockResolvedValue({
      token_id: "0.0.1234567",
      serial_number: 1,
      account_id: "0.0.1001",
      deleted: false,
      metadata: "ipfs://test",
      created_timestamp: "1700000000.000000000",
    } as never);

    await upgradeTier("0.0.1234567", 1, "gold", "0.0.1001");

    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    const upgradeLog = calls.find((c) => c.includes("tier_upgraded"));
    expect(upgradeLog).toBeDefined();

    const parsed = JSON.parse(upgradeLog!);
    expect(parsed.context.did).toBe("did:hcs:0.0.1234567:1");
    expect(parsed.context.oldTier).toBe("bronze");
    expect(parsed.context.newTier).toBe("gold");
  });

  it("revokePassport logs tokenId, serial, reason", async () => {
    mockedGetNftInfo.mockResolvedValue({
      token_id: "0.0.1234567",
      serial_number: 1,
      account_id: "0.0.1001",
      deleted: false,
      metadata: "ipfs://test",
      created_timestamp: "1700000000.000000000",
    } as never);

    await revokePassport("0.0.1234567", 1, "fraudulent activity");

    const calls = warnSpy.mock.calls.map((c) => c[0] as string);
    const revokeLog = calls.find((c) => c.includes("passport_revoked"));
    expect(revokeLog).toBeDefined();

    const parsed = JSON.parse(revokeLog!);
    expect(parsed.context.tokenId).toBe("0.0.1234567");
    expect(parsed.context.serial).toBe(1);
    expect(parsed.context.reason).toBe("fraudulent activity");
  });
});
