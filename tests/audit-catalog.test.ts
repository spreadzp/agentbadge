import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock mirror.service before importing routes
vi.mock("@agentgate-hedera/hedera-core", async (importOriginal) => ({
  ...await importOriginal(),
  getTopicMessages: vi.fn(),
}));

import { getTopicMessages } from "@agentgate-hedera/hedera-core";
import { getCatalog, getLlmsTxt } from "@agentgate-hedera/hedera-core";
import { registerAuditCatalogTools, getAuditTrail } from "@agentgate-hedera/mcp";
import { handleHttpToolCall, listTools } from "@agentgate-hedera/mcp";
import { auditRoutes } from "../src/server/routes/audit";
import { catalogRoutes } from "../src/server/routes/catalog";
import type { TopicMessage } from "@agentgate-hedera/hedera-core";

// ─── Catalog Module ───────────────────────────────────────────

describe("Catalog module", () => {
  it("returns exactly 4 tiers with correct prices and capabilities", () => {
    const tiers = getCatalog();
    expect(tiers).toHaveLength(4);

    const names = tiers.map((t) => t.name);
    expect(names).toEqual(["bronze", "silver", "gold", "platinum"]);

    const bronze = tiers.find((t) => t.name === "bronze")!;
    expect(bronze.price).toBe(10);
    expect(bronze.capabilities).toContain("api_call");
    expect(bronze.capabilities).toContain("payment");

    const silver = tiers.find((t) => t.name === "silver")!;
    expect(silver.price).toBe(50);
    expect(silver.capabilities).toContain("data_provide");

    const gold = tiers.find((t) => t.name === "gold")!;
    expect(gold.price).toBe(200);
    expect(gold.capabilities).toContain("verified");
    expect(gold.capabilities).toContain("marketplace");

    const platinum = tiers.find((t) => t.name === "platinum")!;
    expect(platinum.price).toBe(500);
    expect(platinum.capabilities).toContain("multi_agent");
    expect(platinum.capabilities).toContain("governance");
  });
});

// ─── llms.txt ─────────────────────────────────────────────────

describe("llms.txt generation", () => {
  it("contains the correct endpoint list and facilitator config", () => {
    const txt = getLlmsTxt();
    expect(txt).toContain("# Agent Passport on Hedera");
    expect(txt).toContain("POST /passport/request");
    expect(txt).toContain("GET /passport/:tokenId/:serial");
    expect(txt).toContain("GET /audit/:tokenId/:serial?");
    expect(txt).toContain("GET /catalog");
    expect(txt).toContain("GET /did/:did");
    expect(txt).toContain("Facilitator:");
    expect(txt).toContain("Fee payer:");
  });
});

// ─── Audit Trail ──────────────────────────────────────────────

const mockMessages: TopicMessage[] = [
  {
    consensus_timestamp: "1.0",
    message: JSON.stringify({
      type: "passport_issued",
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.123",
      serial: 1,
      timestamp: 1700000000,
      tier: "bronze",
      txHash: "0xabc",
    }),
    sequence_number: 1,
    running_hash: "",
  },
  {
    consensus_timestamp: "2.0",
    message: JSON.stringify({
      type: "tier_upgraded",
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.123",
      serial: 1,
      timestamp: 1700000001,
      oldTier: "bronze",
      newTier: "silver",
      txHash: "0xdef",
    }),
    sequence_number: 2,
    running_hash: "",
  },
  {
    consensus_timestamp: "3.0",
    message: JSON.stringify({
      type: "agent_registered",
      did: "did:hcs:0.0.123:1",
      tokenId: "0.0.123",
      serial: 1,
      timestamp: 1700000002,
      txHash: "0xghi",
    }),
    sequence_number: 3,
    running_hash: "",
  },
  {
    consensus_timestamp: "4.0",
    message: JSON.stringify({
      type: "passport_revoked",
      did: "did:hcs:0.0.456:2",
      tokenId: "0.0.456",
      serial: 2,
      timestamp: 1700000003,
      reason: "compromised",
      txHash: "0xjkl",
    }),
    sequence_number: 4,
    running_hash: "",
  },
  {
    consensus_timestamp: "5.0",
    message: JSON.stringify({
      type: "agent_deregistered",
      did: "did:hcs:0.0.456:2",
      tokenId: "0.0.456",
      serial: 2,
      timestamp: 1700000004,
      txHash: "0x mno",
    }),
    sequence_number: 5,
    running_hash: "",
  },
  // Non-audit message that should be filtered out
  {
    consensus_timestamp: "6.0",
    message: JSON.stringify({ type: "unknown_event", data: "noise" }),
    sequence_number: 6,
    running_hash: "",
  },
];

describe("getAuditTrail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all 5 audit event types, filtering out unknown types", async () => {
    vi.mocked(getTopicMessages).mockResolvedValue(mockMessages);
    const events = await getAuditTrail();
    expect(events).toHaveLength(5);
    const types = events.map((e) => e.type);
    expect(types).toContain("passport_issued");
    expect(types).toContain("tier_upgraded");
    expect(types).toContain("passport_revoked");
    expect(types).toContain("agent_registered");
    expect(types).toContain("agent_deregistered");
    expect(types).not.toContain("unknown_event");
  });

  it("filters by tokenId and serial when provided", async () => {
    vi.mocked(getTopicMessages).mockResolvedValue(mockMessages);
    const events = await getAuditTrail("0.0.123", 1);
    expect(events).toHaveLength(3); // passport_issued + tier_upgraded + agent_registered
    for (const e of events) {
      expect(e.tokenId).toBe("0.0.123");
      expect(e.serial).toBe(1);
    }
  });

  it("filters by tokenId only when serial not provided", async () => {
    vi.mocked(getTopicMessages).mockResolvedValue(mockMessages);
    const events = await getAuditTrail("0.0.456");
    expect(events).toHaveLength(2); // passport_revoked + agent_deregistered
    for (const e of events) {
      expect(e.tokenId).toBe("0.0.456");
    }
  });
});

// ─── REST Routes ──────────────────────────────────────────────

describe("REST routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTopicMessages).mockResolvedValue(mockMessages);

    app = new Hono();
    app.route("/", auditRoutes);
    app.route("/", catalogRoutes);
  });

  it("GET /catalog returns 4 tiers as JSON", async () => {
    const res = await app.request("/catalog");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tiers).toHaveLength(4);
    expect(body.tiers[0].name).toBe("bronze");
    expect(body.tiers[3].name).toBe("platinum");
  });

  it("GET /llms.txt returns text content", async () => {
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("# Agent Passport on Hedera");
    expect(text).toContain("POST /passport/request");
  });

  it("GET /audit returns all audit events", async () => {
    const res = await app.request("/audit");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(5);
  });

  it("GET /audit/:tokenId/:serial filters by passport", async () => {
    const res = await app.request("/audit/0.0.123/1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(3);
    for (const e of body.events) {
      expect(e.tokenId).toBe("0.0.123");
      expect(e.serial).toBe(1);
    }
  });

  it("GET /audit/:tokenId filters by token only", async () => {
    const res = await app.request("/audit/0.0.456");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(2);
  });
});

// ─── MCP Tools ────────────────────────────────────────────────

describe("MCP tools — audit + catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTopicMessages).mockResolvedValue(mockMessages);
    registerAuditCatalogTools();
  });

  it("get_tier_requirements tool is registered", () => {
    const tools = listTools();
    expect(tools.some((t) => t.name === "get_tier_requirements")).toBe(true);
  });

  it("get_audit_trail tool is registered", () => {
    const tools = listTools();
    expect(tools.some((t) => t.name === "get_audit_trail")).toBe(true);
  });

  it("get_tier_requirements returns catalog data", async () => {
    const result = await handleHttpToolCall("get_tier_requirements", {});
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tiers).toHaveLength(4);
    expect(parsed.tiers[0].name).toBe("bronze");
  });

  it("get_audit_trail returns events", async () => {
    const result = await handleHttpToolCall("get_audit_trail", {});
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.events).toHaveLength(5);
  });

  it("get_audit_trail with tokenId/serial filters results", async () => {
    const result = await handleHttpToolCall("get_audit_trail", {
      tokenId: "0.0.123",
      serial: 1,
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.events).toHaveLength(3);
  });
});
