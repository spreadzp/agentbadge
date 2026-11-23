import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { generateKeyPair, exportPKCS8 } from "jose";
import { setupMockEnv } from "../e2e/helpers";
import { wellKnownRoutes } from "../../src/server/routes/well-known";
import { createDiscoveryRoutes } from "../../src/server/routes/discovery/discovery";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";

setupMockEnv();

const TEST_SOURCES: DiscoverySources = {
  baseUrl: "https://staging.agentbadge.xyz",
  authSection: "",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
  wellKnownEnv: {
    facilitatorUrl: "https://facilitator.payai.network",
    hederaNetwork: "testnet",
    evmChainId: "5042",
    erc8004: {
      chainId: 5042,
      registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      agentId: "0",
    },
  },
};

// SLICE-259-38 (DeepSeek R3, same class as zero-sha256): the Web Bot Auth
// directory shipped "x":"agentbadge.xyz" — a hostname string, not a
// base64url Ed25519 key. Serve the real DID key material or 404.
describe("SLICE-259-38: http-message-signatures-directory real key", () => {
  const originalKey = process.env.DID_SIGNING_KEY;
  function app() {
    const a = new Hono();
    a.route("/", createDiscoveryRoutes(() => TEST_SOURCES));
    a.route("/", wellKnownRoutes);
    return a;
  }
  afterEach(() => {
    if (originalKey === undefined) delete process.env.DID_SIGNING_KEY;
    else process.env.DID_SIGNING_KEY = originalKey;
  });

  it("serves a real base64url Ed25519 public key, never a hostname", async () => {
    const { privateKey } = await generateKeyPair("Ed25519", { extractable: true });
    process.env.DID_SIGNING_KEY = await exportPKCS8(privateKey);

    const res = await app().request("/.well-known/http-message-signatures-directory");
    expect(res.status).toBe(200);
    const body = await res.json();
    const key = body.keys?.[0];
    expect(key.kty).toBe("OKP");
    expect(key.crv).toBe("Ed25519");
    // SLICE-259-39 (ds15): kid must match jwks.json + did.json — the
    // did:web verification-method id — so one key has one id everywhere.
    expect(key.kid).toMatch(/^did:web:.+#key-1$/);
    // base64url(32 bytes) — 43 chars, no dots/hostnames allowed.
    expect(key.x).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key.x).not.toBe("agentbadge.xyz");
  });

  it("no DID_SIGNING_KEY → 404 (honest absence, not a placeholder)", async () => {
    delete process.env.DID_SIGNING_KEY;
    const res = await app().request("/.well-known/http-message-signatures-directory");
    expect(res.status).toBe(404);
  });
});

// SLICE-259-39 (Grok R4): canonical agent entry point — one file that
// gets an agent from "found the manifest" to "first useful call".
describe("SLICE-259-39: agent-start.json canonical entry", () => {
  function app() {
    const a = new Hono();
    a.route("/", createDiscoveryRoutes(() => TEST_SOURCES));
    a.route("/", wellKnownRoutes);
    return a;
  }

  it("serves quickstart with free scan, agb_ registration and MCP", async () => {
    const res = await app().request("/.well-known/agent-start.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = await res.json();
    expect(body.free_scan).toContain("/api/scan?url={url}");
    expect(body.api_key_registration).toContain("/api/v1/agents/register");
    expect(body.auth_model).toContain("agb_");
    expect(body.mcp).toContain("/mcp");
    expect(body.mcp_public).toContain("/mcp/public");
    expect(Array.isArray(body.quickstart)).toBe(true);
    expect(body.quickstart.length).toBeGreaterThanOrEqual(4);
  });
});
