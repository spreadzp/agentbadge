import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { NftInfo } from "@agentbadge/hedera-core";

// Mock services before importing tools
vi.mock("@agentbadge/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getNftInfo: vi.fn(),
  getTopicMessages: vi.fn(),
  submitAuditMessage: vi.fn(),
  submitDirectoryMessage: vi.fn(),
}));

import {
  getNftInfo,
  submitAuditMessage,
  submitDirectoryMessage,
} from "@agentbadge/hedera-core";
import { upsert, getAll, get, clear, type DirectoryEntry } from "@agentbadge/passport";
import {
  registerDirectoryTools,
  registerAgent,
  findAgents,
} from "@agentbadge/mcp";
import { handleHttpToolCall, listTools } from "@agentbadge/mcp";

const mockedGetNftInfo = vi.mocked(getNftInfo);
const mockedSubmitAudit = vi.mocked(submitAuditMessage);
const mockedSubmitDir = vi.mocked(submitDirectoryMessage);

function makeEntry(did: string, overrides: Partial<DirectoryEntry> = {}): DirectoryEntry {
  return {
    did,
    tokenId: "0.0.1234567",
    serial: 1,
    accountId: "0.0.7654321",
    name: "TestBot",
    capabilities: ["api_call", "data_provide"],
    endpoint: "https://agent.test",
    tier: "bronze",
    timestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function makeNftInfo(overrides: Partial<NftInfo> = {}): NftInfo {
  return {
    token_id: "0.0.1234567",
    serial_number: 1,
    account_id: "0.0.7654321",
    metadata: "",
    deleted: false,
    created_timestamp: "1700000000.000000001",
    ...overrides,
  };
}

const validRegisterInput = {
  did: "did:hcs:0.0.1234567:1",
  tokenId: "0.0.1234567",
  serial: 1,
  accountId: "0.0.7654321",
  name: "TradingBot",
  capabilities: ["api_call", "payment"],
  endpoint: "https://agent-a.fly.dev",
  tier: "silver",
};

describe("Directory MCP Tools — register_agent", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
    registerDirectoryTools();
  });

  afterEach(() => {
    clear();
  });

  it("registers successfully with valid input and active passport", async () => {
    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo());
    mockedSubmitDir.mockResolvedValueOnce("tx-123");
    mockedSubmitAudit.mockResolvedValueOnce("tx-456");

    const result = await registerAgent(validRegisterInput);

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.registered).toBe(true);

    expect(mockedGetNftInfo).toHaveBeenCalledWith("0.0.1234567", 1);
    expect(mockedSubmitDir).toHaveBeenCalledOnce();
    expect(mockedSubmitAudit).toHaveBeenCalledOnce();

    // Cache should be updated
    expect(get("did:hcs:0.0.1234567:1")).toBeDefined();
  });

  it("returns MCP error when passport not found", async () => {
    mockedGetNftInfo.mockResolvedValueOnce(null);

    const result = await registerAgent(validRegisterInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/passport not found/i);
    expect(mockedSubmitDir).not.toHaveBeenCalled();
  });

  it("returns MCP error when passport is revoked (deleted)", async () => {
    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo({ deleted: true }));

    const result = await registerAgent(validRegisterInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/revoked/i);
    expect(mockedSubmitDir).not.toHaveBeenCalled();
  });

  it("returns MCP error when passport ownership mismatch", async () => {
    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo({ account_id: "0.0.9999999" }));

    const result = await registerAgent(validRegisterInput);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/ownership/i);
    expect(mockedSubmitDir).not.toHaveBeenCalled();
  });

  it("returns MCP error when required fields are missing", async () => {
    const result = await registerAgent({ ...validRegisterInput, did: "" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/did/i);
  });

  it("is registered as an MCP tool with correct name", () => {
    const tools = listTools();
    expect(tools.some((t) => t.name === "register_agent")).toBe(true);
  });

  it("is callable via handleHttpToolCall", async () => {
    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo());
    mockedSubmitDir.mockResolvedValueOnce("tx-123");
    mockedSubmitAudit.mockResolvedValueOnce("tx-456");

    const result = await handleHttpToolCall("register_agent", validRegisterInput);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.registered).toBe(true);
  });
});

describe("Directory MCP Tools — find_agents", () => {
  beforeEach(() => {
    clear();
    vi.clearAllMocks();
    registerDirectoryTools();
  });

  afterEach(() => {
    clear();
  });

  it("returns all agents with active status when no capability filter", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));
    upsert(makeEntry("did:hcs:0.0.123:2", { serial: 2 }));

    mockedGetNftInfo
      .mockResolvedValueOnce(makeNftInfo({ serial_number: 1 }))
      .mockResolvedValueOnce(makeNftInfo({ serial_number: 2 }));

    const result = await findAgents({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agents).toHaveLength(2);
    expect(parsed.agents[0]).toHaveProperty("active", true);
    expect(parsed.agents[1]).toHaveProperty("active", true);
  });

  it("filters by capability", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { capabilities: ["api_call"] }));
    upsert(makeEntry("did:hcs:0.0.123:2", { capabilities: ["data_provide"] }));

    mockedGetNftInfo.mockResolvedValue(makeNftInfo());

    const result = await findAgents({ capability: "api_call" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].capabilities).toContain("api_call");
  });

  it("includes revoked agent with active: false", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));

    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo({ deleted: true }));

    const result = await findAgents({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]).toHaveProperty("active", false);
  });

  it("returns empty array when no agents match filter", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1", { capabilities: ["api_call"] }));

    const result = await findAgents({ capability: "orchestration" });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agents).toEqual([]);
  });

  it("returns empty array when cache is empty", async () => {
    const result = await findAgents({});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agents).toEqual([]);
  });

  it("is registered as an MCP tool with correct name", () => {
    const tools = listTools();
    expect(tools.some((t) => t.name === "find_agents")).toBe(true);
  });

  it("is callable via handleHttpToolCall", async () => {
    upsert(makeEntry("did:hcs:0.0.123:1"));
    mockedGetNftInfo.mockResolvedValueOnce(makeNftInfo());

    const result = await handleHttpToolCall("find_agents", {});

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.agents).toHaveLength(1);
  });
});
