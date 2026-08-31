/**
 * SLICE-82-3: Artifact tests for DID Auth documentation surfaces.
 *
 * Verifies that all agent-facing documentation mentions the DID signature
 * authentication flow: challenge endpoint, canonical string, headers, 5-min window.
 *
 * These tests FAIL until the Green Phase implements the doc changes.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { catalogRoutes } from "../src/server/routes/catalog";
import { marketGuideRoutes } from "../src/server/routes/market-guide";
import { agentGuideRoutes } from "../src/server/routes/agent-guide";
import { wellKnownRoutes } from "../src/server/routes/well-known";

// ─── Shared constants ──────────────────────────────────────────────

const AUTH_HEADERS = [
  "X-AgentBadge-Signature",
  "X-AgentBadge-Timestamp",
  "X-AgentBadge-Nonce",
  "X-AgentBadge-Did",
];

const CHALLENGE_PATH = "/auth/challenge";
const CANONICAL_PREFIX = "agentbadge-action:v1";
const WINDOW_MENTION = "300"; // 5-minute = 300 seconds

// ─── 1. llms.txt ───────────────────────────────────────────────────

describe("SLICE-82-3: llms.txt mentions DID auth", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", catalogRoutes);
  });

  it("mentions the challenge endpoint path", async () => {
    const res = await app.request("/llms.txt");
    const txt = await res.text();
    expect(txt).toContain(CHALLENGE_PATH);
  });

  it("mentions all 4 required auth headers", async () => {
    const res = await app.request("/llms.txt");
    const txt = await res.text();
    for (const header of AUTH_HEADERS) {
      expect(txt).toContain(header);
    }
  });

  it("mentions canonical string prefix", async () => {
    const res = await app.request("/llms.txt");
    const txt = await res.text();
    expect(txt).toContain(CANONICAL_PREFIX);
  });

  it("mentions 5-minute (300 seconds) timestamp window", async () => {
    const res = await app.request("/llms.txt");
    const txt = await res.text();
    expect(txt).toContain(WINDOW_MENTION);
  });

  it("mentions DID signature / control proof", async () => {
    const res = await app.request("/llms.txt");
    const txt = await res.text();
    expect(txt.toLowerCase()).toContain("did signature");
  });
});

// ─── 2. market-guide ───────────────────────────────────────────────

describe("SLICE-82-3: market-guide mentions DID auth", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", marketGuideRoutes);
  });

  it("response contains auth header names", async () => {
    const res = await app.request("/market-guide");
    const text = await res.text();
    for (const header of AUTH_HEADERS) {
      expect(text).toContain(header);
    }
  });

  it("response mentions challenge endpoint", async () => {
    const res = await app.request("/market-guide");
    const text = await res.text();
    expect(text).toContain(CHALLENGE_PATH);
  });

  it("response mentions canonical string format", async () => {
    const res = await app.request("/market-guide");
    const text = await res.text();
    expect(text).toContain(CANONICAL_PREFIX);
  });
});

// ─── 3. marketplace-guide (in agent-guide.ts) ──────────────────────

describe("SLICE-82-3: marketplace-guide mentions DID auth", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", agentGuideRoutes);
  });

  it("response contains auth header names", async () => {
    const res = await app.request("/marketplace-guide");
    const text = await res.text();
    for (const header of AUTH_HEADERS) {
      expect(text).toContain(header);
    }
  });

  it("response mentions challenge endpoint", async () => {
    const res = await app.request("/marketplace-guide");
    const text = await res.text();
    expect(text).toContain(CHALLENGE_PATH);
  });
});

// ─── 4. agents.txt ─────────────────────────────────────────────────

describe("SLICE-82-3: agents.txt mentions DID auth", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("response mentions DID signature requirement for mutations", async () => {
    const res = await app.request("/agents.txt");
    const text = await res.text();
    expect(text.toLowerCase()).toContain("did signature");
    expect(text.toLowerCase()).toContain("mutation");
  });

  it("response mentions that reads are free (no auth)", async () => {
    const res = await app.request("/agents.txt");
    const text = await res.text();
    expect(text.toLowerCase()).toContain("free");
    expect(text.toLowerCase()).toContain("read");
  });

  it("response mentions challenge endpoint", async () => {
    const res = await app.request("/agents.txt");
    const text = await res.text();
    expect(text).toContain(CHALLENGE_PATH);
  });
});

// ─── 5. agent-card.json auth block ─────────────────────────────────

describe("SLICE-82-3: agent-card.json has auth block", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("response contains auth object", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json() as Record<string, unknown>;
    expect(json.auth).toBeDefined();
  });

  it("auth block references challenge endpoint", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json() as { auth?: { challenge_endpoint?: string } };
    expect(json.auth?.challenge_endpoint).toContain(CHALLENGE_PATH);
  });

  it("auth block lists required headers", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json() as { auth?: { headers?: string[] } };
    expect(json.auth?.headers).toBeDefined();
    for (const header of AUTH_HEADERS) {
      expect(json.auth?.headers).toContain(header);
    }
  });

  it("auth block mentions canonical format", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    const json = await res.json() as { auth?: { canonical_format?: string } };
    expect(json.auth?.canonical_format).toContain(CANONICAL_PREFIX);
  });
});

// ─── 6. MCP tool descriptions mention DID auth ─────────────────────

describe("SLICE-82-3: MCP tools include DID auth info", () => {
  it("get_did_auth_info parity tool is registered and mentions DID signature", async () => {
    const { registerParityTools } = await import("../src/mcp/parity-tools");
    const { listTools: listAllTools } = await import("@agentbadge/mcp");
    registerParityTools();
    const tools = listAllTools();
    const authTool = tools.find((t) => t.name === "get_did_auth_info");
    expect(authTool).toBeDefined();
    expect(authTool!.description.toLowerCase()).toContain("did");
    expect(authTool!.description).toContain("X-AgentBadge-Signature");
  });
});
