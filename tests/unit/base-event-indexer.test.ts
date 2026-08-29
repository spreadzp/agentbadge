/**
 * Unit tests for Base event indexer singleton.
 *
 * Tests startBaseEventIndexer / getBaseEventIndexer / stopBaseEventIndexer
 * with mocked evm-core. Verifies:
 * - Skips when CHAIN_MODE != "base"
 * - Skips when BASE_OPERATOR_KEY not set
 * - Starts and creates EventIndexer when properly configured
 * - getBaseEventIndexer throws if not started
 * - stopBaseEventIndexer cleans up
 * - Idempotent start (no double-start)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockIsPolling = vi.fn(() => false);
const mockGetIndexedEvents = vi.fn(() => []);
const mockClearIndexedEvents = vi.fn();

vi.mock("@agentgate-hedera/evm-core", () => ({
  EvmChainAdapter: vi.fn().mockImplementation(() => ({})),
  EventIndexer: vi.fn().mockImplementation(() => ({
    start: mockStart,
    stop: mockStop,
    isPolling: mockIsPolling,
    getIndexedEvents: mockGetIndexedEvents,
    clearIndexedEvents: mockClearIndexedEvents,
  })),
  BASE_SEPOLIA_ADDRESSES: {
    AgentPassport: "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5",
    TaskEscrow: "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4",
    X402Token: "0x0000000000000000000000000000000000000000",
    DIDRegistry: "0xabc0000000000000000000000000000000000001",
    MockUSDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    SessionRegistry: "0xdef0000000000000000000000000000000000002",
  },
  BASE_SEPOLIA_RPC: "https://sepolia.base.org",
  BASE_SEPOLIA_CHAIN_ID: 84532,
  BASE_SEPOLIA_EXPLORER: "https://sepolia.basescan.org",
}));

import {
  startBaseEventIndexer,
  stopBaseEventIndexer,
  getBaseEventIndexer,
} from "../../src/server/lib/base-event-indexer";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  stopBaseEventIndexer();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  stopBaseEventIndexer();
});

describe("startBaseEventIndexer", () => {
  it("skips when CHAIN_MODE is not 'base'", () => {
    process.env.CHAIN_MODE = "hedera";
    process.env.BASE_OPERATOR_KEY = "0x" + "ab".repeat(32);
    startBaseEventIndexer();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("skips when BASE_OPERATOR_KEY is not set", () => {
    process.env.CHAIN_MODE = "base";
    delete process.env.BASE_OPERATOR_KEY;
    startBaseEventIndexer();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("starts EventIndexer when CHAIN_MODE=base and key is set", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_OPERATOR_KEY = "0x" + "ab".repeat(32);
    startBaseEventIndexer();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("does not start twice (idempotent)", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_OPERATOR_KEY = "0x" + "ab".repeat(32);
    startBaseEventIndexer();
    startBaseEventIndexer();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});

describe("getBaseEventIndexer", () => {
  it("throws if not started", () => {
    expect(() => getBaseEventIndexer()).toThrow("not started");
  });

  it("returns indexer instance after start", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_OPERATOR_KEY = "0x" + "ab".repeat(32);
    startBaseEventIndexer();
    const indexer = getBaseEventIndexer();
    expect(indexer).toBeDefined();
    expect(typeof indexer.getIndexedEvents).toBe("function");
  });
});

describe("stopBaseEventIndexer", () => {
  it("calls stop on indexer and cleans up", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_OPERATOR_KEY = "0x" + "ab".repeat(32);
    startBaseEventIndexer();
    stopBaseEventIndexer();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("is safe to call when not started (no-op)", () => {
    stopBaseEventIndexer();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("allows restart after stop", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_OPERATOR_KEY = "0x" + "ab".repeat(32);
    startBaseEventIndexer();
    stopBaseEventIndexer();
    startBaseEventIndexer();
    expect(mockStart).toHaveBeenCalledTimes(2);
  });
});
