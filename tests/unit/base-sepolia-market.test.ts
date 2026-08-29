/**
 * Unit tests for Base Sepolia market route functions.
 *
 * Tests checkPassportType and checkSessionCap with mocked evm-core.
 * Verifies correct behavior for:
 * - Hedera DIDs (skip — return null)
 * - Base DIDs without BASE_OPERATOR_KEY (skip — return null)
 * - Base DIDs with operator key but no session (skip — return null)
 * - Base DIDs with invalid DID format
 * - Passport not found / deleted / type mismatch
 * - Session budget exceeded / valid
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockGetPassportInfo = vi.fn();
const mockCheckSessionValid = vi.fn();

vi.mock("@agentgate-hedera/evm-core", () => ({
  isBaseDid: (did: string) => did.startsWith("did:eip155:84532:"),
  parseBaseDid: (did: string) => {
    if (!did.startsWith("did:eip155:84532:passport:")) return null;
    const parts = did.split(":");
    return { nftAddress: parts[4], tokenId: Number(parts[5]), chainId: 84532 };
  },
  EvmChainAdapter: vi.fn().mockImplementation(() => ({
    getPassportInfo: mockGetPassportInfo,
  })),
  SessionRegistry: vi.fn().mockImplementation(() => ({
    checkSessionValid: mockCheckSessionValid,
  })),
  BASE_SEPOLIA_RPC: "https://sepolia.base.org",
  BASE_SEPOLIA_CHAIN_ID: 84532,
  BASE_SEPOLIA_EXPLORER: "https://sepolia.basescan.org",
  BASE_SEPOLIA_ADDRESSES: {
    AgentPassport: "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5",
    TaskEscrow: "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4",
    X402Token: "0x0000000000000000000000000000000000000000",
    DIDRegistry: "0xabc0000000000000000000000000000000000001",
    MockUSDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    SessionRegistry: "0xdef0000000000000000000000000000000000002",
  },
}));

import { checkPassportType, checkSessionCap } from "../../src/server/routes/market";

const HEDERA_DID = "did:hedera:testnet:passport:0.0.123456";
const BASE_DID = "did:eip155:84532:passport:0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5:42";
const BASE_DID_INVALID = "did:eip155:84532:invalid:0xabc:1";
const FAKE_KEY = "0x" + "ab".repeat(32);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("checkPassportType", () => {
  it("returns null for Hedera DIDs (skip check)", async () => {
    const result = await checkPassportType(HEDERA_DID, "CREATOR");
    expect(result).toBeNull();
  });

  it("returns null when BASE_OPERATOR_KEY is not set", async () => {
    delete process.env.BASE_OPERATOR_KEY;
    const result = await checkPassportType(BASE_DID, "CREATOR");
    expect(result).toBeNull();
  });

  it("returns null for invalid Base DID format", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    const result = await checkPassportType(BASE_DID_INVALID, "CREATOR");
    expect(result).toBeNull();
  });

  it("returns 403 when passport not found on Base Sepolia", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    mockGetPassportInfo.mockResolvedValue(null);
    const result = await checkPassportType(BASE_DID, "CREATOR");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.error.code).toBe("PASSPORT_NOT_FOUND");
  });

  it("returns 403 when passport is deleted (revoked)", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    mockGetPassportInfo.mockResolvedValue({
      token_id: "42", serial_number: 42, account_id: "0xabc",
      metadata: "ipfs://test", deleted: true, created_timestamp: "0",
      passportType: "CREATOR", capabilities: [],
    });
    const result = await checkPassportType(BASE_DID, "CREATOR");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.error.code).toBe("PASSPORT_REVOKED");
  });

  it("returns null when passport type matches required type", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    mockGetPassportInfo.mockResolvedValue({
      token_id: "42", serial_number: 42, account_id: "0xabc",
      metadata: "ipfs://test", deleted: false, created_timestamp: "0",
      passportType: "CREATOR", capabilities: [],
    });
    const result = await checkPassportType(BASE_DID, "CREATOR");
    expect(result).toBeNull();
  });

  it("returns 403 when passport type does not match", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    mockGetPassportInfo.mockResolvedValue({
      token_id: "42", serial_number: 42, account_id: "0xabc",
      metadata: "ipfs://test", deleted: false, created_timestamp: "0",
      passportType: "EXECUTOR", capabilities: [],
    });
    const result = await checkPassportType(BASE_DID, "CREATOR");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
    const body = await result!.json();
    expect(body.error.code).toBe("PASSPORT_TYPE_MISMATCH");
  });
});

describe("checkSessionCap", () => {
  it("returns null for Hedera DIDs (skip check)", async () => {
    const result = await checkSessionCap(HEDERA_DID, 10, 1);
    expect(result).toBeNull();
  });

  it("returns null when BASE_OPERATOR_KEY is not set", async () => {
    delete process.env.BASE_OPERATOR_KEY;
    const result = await checkSessionCap(BASE_DID, 10, 1);
    expect(result).toBeNull();
  });

  it("returns null when sessionId is 0 (no session)", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    const result = await checkSessionCap(BASE_DID, 10, 0);
    expect(result).toBeNull();
  });

  it("returns 402 when session budget check fails", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    mockCheckSessionValid.mockResolvedValue({ ok: false, reason: "Session budget exceeded" });
    const result = await checkSessionCap(BASE_DID, 100, 42);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(402);
    const body = await result!.json();
    expect(body.error.code).toBe("SESSION_BUDGET_EXCEEDED");
  });

  it("returns null when session check passes", async () => {
    process.env.BASE_OPERATOR_KEY = FAKE_KEY;
    mockCheckSessionValid.mockResolvedValue({
      ok: true,
      session: { agent: "0xabc", cap: BigInt(1e9), spent: BigInt(0), expiry: BigInt(9999999), status: "ACTIVE" },
    });
    const result = await checkSessionCap(BASE_DID, 10, 42);
    expect(result).toBeNull();
  });
});
