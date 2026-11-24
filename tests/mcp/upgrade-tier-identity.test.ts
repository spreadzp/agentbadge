/**
 * SLICE-259-4 + 259-5: verified identity for upgrade_tier (MCP + REST)
 * and the /mcp/ops operator surface.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@modelcontextprotocol/sdk/server/stdio", () => ({
  StdioServerTransport: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

const getPassportInfoMock = vi.fn();
const upgradeTierMock = vi.fn();
const didToAccountIdMock = vi.fn();
const verifySigMock = vi.fn(async () => true);

vi.mock("@agentbadge/passport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/passport")>();
  return {
    ...actual,
    getPassportInfo: (...a: unknown[]) => getPassportInfoMock(...a),
    upgradeTier: (...a: unknown[]) => upgradeTierMock(...a),
  };
});

vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
  return {
    ...actual,
    didToAccountId: (...a: unknown[]) => didToAccountIdMock(...a),
  };
});

// @agentbadge/mcp resolves hedera-core from a NESTED copy (it wants
// ^0.2.1, server pins 0.3.0 — bun nested the older one). Mock both
// module ids or the bundle's handler calls the real Mirror Node fn.
vi.mock(
  "../../node_modules/@agentbadge/mcp/node_modules/@agentbadge/hedera-core",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@agentbadge/hedera-core")
      >();
    return {
      ...actual,
      didToAccountId: (...a: unknown[]) => didToAccountIdMock(...a),
    };
  },
);

import { Hono, type Context, type Next } from "hono";
import { registerPassportTools } from "@agentbadge/mcp";
import { mcpRoutes } from "../../src/server/routes/mcp/mcp";
import { createMcpOpsRoutes } from "../../src/server/routes/mcp/mcp-ops";
import { createUpgradeRoutes } from "../../src/server/routes/upgrade";
import { didAuthEnrich } from "../../src/server/middleware/did-enrich";
import {
  configureDidAuthForTesting,
  NonceStore,
} from "../../src/server/middleware/did-auth";
import { buildChallenge } from "../../src/server/middleware/did-challenge";

const TOKEN = "0.0.777";
const SERIAL = 42;
const OWNER_ACCT = "0.0.555";
const OWNER_DID = `did:hcs:${TOKEN}:${SERIAL}`;
const OTHER_DID = "did:hcs:0.0.777:99";
const ADMIN_KEY = "test-admin-key";
const UPGRADE_ARGS = { tokenId: TOKEN, serial: SERIAL, newTier: "silver" };

const nonceStore = new NonceStore();
// Feed the fallback path: NonceStore.consume checks issued nonces via
// cache or fallback set — issue() registers them there.
async function didHeaders(did: string, method: string, path: string, body: string) {
  const nonce = await nonceStore.issue();
  const timestamp = Math.floor(Date.now() / 1000);
  // Challenge is built over these exact fields — the mock verifier accepts
  // any signature value; what matters is the middleware reconstructs the
  // same challenge (method/path/body-bound).
  const challenge = buildChallenge({ did, method, path, body, timestamp, nonce });
  void challenge;
  return {
    "Content-Type": "application/json",
    "X-AgentBadge-Did": did,
    "X-AgentBadge-Signature": "deadbeef".repeat(8),
    "X-AgentBadge-Timestamp": String(timestamp),
    "X-AgentBadge-Nonce": nonce,
  };
}

const rpc = (name: string, args: Record<string, unknown>, id = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

function makeApp(setAgent?: (c: Context) => void): Hono {
  const app = new Hono();
  if (setAgent) {
    app.use("*", async (c: Context, next: Next) => {
      setAgent(c);
      await next();
    });
  }
  // Mirror prod wiring (index.ts): /mcp + /mcp/* — the two patterns
  // overlap on "/mcp", enrich is idempotent via __didEnriched.
  app.use("/mcp", didAuthEnrich());
  app.use("/mcp/*", didAuthEnrich());
  app.route("/", mcpRoutes);
  app.route("/mcp/ops", createMcpOpsRoutes());
  app.route("/", createUpgradeRoutes());
  return app;
}

const anonApp = makeApp();
const agentApp = makeApp((c) => c.set("agentId", "eip155:1:0xabc:1"));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.ADMIN_BREAK_GLASS_ENABLED = "true";
  configureDidAuthForTesting({ verifier: verifySigMock, nonceStore });
  getPassportInfoMock.mockResolvedValue({ owner: OWNER_ACCT, active: true });
  upgradeTierMock.mockResolvedValue({ ok: true, tier: "silver" });
  didToAccountIdMock.mockImplementation(async (did: string) =>
    did === OWNER_DID ? OWNER_ACCT : "0.0.999",
  );
  verifySigMock.mockResolvedValue(true);
});

registerPassportTools();

describe("SLICE-259-4: upgrade_tier via MCP transport", () => {
  it("anon: denied at the transport gate (authenticated exposure)", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("upgrade_tier", UPGRADE_ARGS),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("agb_-keyed caller passes transport but handler denies (no DID)", async () => {
    const res = await agentApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rpc("upgrade_tier", UPGRADE_ARGS),
    });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error.message ?? data.error.data ?? "").toBeTruthy();
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("DID-signed non-owner: handler denies before on-chain op", async () => {
    const body = rpc("upgrade_tier", UPGRADE_ARGS);
    const headers = await didHeaders(OTHER_DID, "POST", "/mcp", body);
    const res = await anonApp.request("/mcp", { method: "POST", headers, body });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("DID-signed owner: reaches service with chain-resolved accountId", async () => {
    const body = rpc("upgrade_tier", UPGRADE_ARGS);
    const headers = await didHeaders(OWNER_DID, "POST", "/mcp", body);
    const res = await anonApp.request("/mcp", { method: "POST", headers, body });
    const data = await res.json();
    expect(data.error).toBeUndefined();
    expect(upgradeTierMock).toHaveBeenCalledWith(TOKEN, SERIAL, "silver", OWNER_ACCT);
  });

  it("admin key: succeeds via owner resolution, no DID needed", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
      body: rpc("upgrade_tier", UPGRADE_ARGS),
    });
    const data = await res.json();
    expect(data.error).toBeUndefined();
    expect(upgradeTierMock).toHaveBeenCalledWith(TOKEN, SERIAL, "silver", OWNER_ACCT);
  });

  it("accountId in arguments is a hard error", async () => {
    const body = rpc("upgrade_tier", { ...UPGRADE_ARGS, accountId: OWNER_ACCT });
    const headers = await didHeaders(OWNER_DID, "POST", "/mcp", body);
    const res = await anonApp.request("/mcp", { method: "POST", headers, body });
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });
});

describe("SLICE-259-4: POST /passport/:id/:serial/upgrade (REST)", () => {
  const path = `/passport/${TOKEN}/${SERIAL}/upgrade`;
  const bodyJson = JSON.stringify({ newTier: "silver" });

  it("unsigned request → 401", async () => {
    const res = await anonApp.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
    });
    expect(res.status).toBe(401);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("body.accountId is rejected (spoofable field removed)", async () => {
    const body = JSON.stringify({ newTier: "silver", accountId: OWNER_ACCT });
    const headers = await didHeaders(OWNER_DID, "POST", path, body);
    const res = await anonApp.request(path, { method: "POST", headers, body });
    expect(res.status).toBe(400);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("DID-signed owner → 200", async () => {
    const headers = await didHeaders(OWNER_DID, "POST", path, bodyJson);
    const res = await anonApp.request(path, { method: "POST", headers, body: bodyJson });
    expect(res.status).toBe(200);
    expect(upgradeTierMock).toHaveBeenCalledWith(TOKEN, SERIAL, "silver", OWNER_ACCT);
  });

  it("DID-signed non-owner → 403", async () => {
    const headers = await didHeaders(OTHER_DID, "POST", path, bodyJson);
    const res = await anonApp.request(path, { method: "POST", headers, body: bodyJson });
    expect(res.status).toBe(403);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });

  it("admin key → 200 via owner resolution", async () => {
    const res = await anonApp.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
      body: bodyJson,
    });
    expect(res.status).toBe(200);
    expect(upgradeTierMock).toHaveBeenCalledWith(TOKEN, SERIAL, "silver", OWNER_ACCT);
  });
});

describe("didAuthEnrich middleware behavior", () => {
  it("partial DID headers → 401 (no silent downgrade)", async () => {
    const res = await anonApp.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentBadge-Did": OWNER_DID,
      },
      body: rpc("upgrade_tier", UPGRADE_ARGS),
    });
    expect(res.status).toBe(401);
  });

  it("bad signature → 401", async () => {
    verifySigMock.mockResolvedValue(false);
    const body = rpc("upgrade_tier", UPGRADE_ARGS);
    const headers = await didHeaders(OWNER_DID, "POST", "/mcp", body);
    const res = await anonApp.request("/mcp", { method: "POST", headers, body });
    expect(res.status).toBe(401);
    expect(upgradeTierMock).not.toHaveBeenCalled();
  });
});

describe("SLICE-259-5: /mcp/ops operator surface", () => {
  it("GET /mcp/ops without key → 401", async () => {
    const res = await anonApp.request("/mcp/ops");
    expect(res.status).toBe(401);
  });

  it("GET /mcp/ops/tools without key → 401", async () => {
    const res = await anonApp.request("/mcp/ops/tools");
    expect(res.status).toBe(401);
  });

  it("GET /mcp/ops/tools with admin key lists only admin-exposure tools", async () => {
    const res = await anonApp.request("/mcp/ops/tools", {
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const names = data.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("revoke_passport");
    expect(names).not.toContain("verify_passport");
    expect(data.tools.every((t: { exposure: string }) => t.exposure === "admin")).toBe(true);
  });

  it("POST /mcp/ops/tools/revoke_passport reaches handler as admin ctx", async () => {
    // revoke_passport service will fail on-chain in tests — the point is
    // the call REACHES the handler (admin tier) rather than 401/403.
    const res = await anonApp.request("/mcp/ops/tools/revoke_passport", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
      body: JSON.stringify({ tokenId: TOKEN, serial: SERIAL }),
    });
    expect(res.status).toBe(200);
  });

  it("JSON-RPC tools/list on /mcp/ops returns admin tools only", async () => {
    const res = await anonApp.request("/mcp/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": ADMIN_KEY },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const data = await res.json();
    const names = data.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("revoke_passport");
    expect(names).not.toContain("verify_passport");
  });
});
