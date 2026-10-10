/**
 * SLICE-178-2 (MYPROJ-2514): .well-known manifest set via agent-discovery
 * registry — A2A v1.0 agent-card, RFC 9727 api-catalog, erc8004-agent,
 * mcp/server-card, oauth-protected-resource (RFC 9728), security.txt
 * (RFC 9116, generated Expires), did.json feature-gate, agent.json 301.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  buildAgentCard,
  buildApiCatalog,
  buildErc8004Agent,
  buildMcpServerCard,
  buildOauthProtectedResource,
  buildSecurityTxt,
} from "../src/server/lib/agent-discovery";
import { createDiscoveryRoutes } from "../src/server/routes/discovery";
import type { DiscoverySources } from "../src/server/lib/agent-discovery";

const BASE = "https://staging.agentbadge.xyz";
const NOW = new Date("2026-10-06T12:00:00.000Z");

function mkSources(over: Partial<DiscoverySources> = {}): DiscoverySources {
  return {
    baseUrl: BASE,
    authSection: "## DID Signature Authentication\n\nstub",
    llmsCore: "# Agent Passport on Hedera\n\n> stub",
    articles: [],
    faqEntries: [],
    tiers: [],
    appRoutes: ["GET /api/health", "GET /.well-known/agent-card.json"],
    apiInfo: {
      title: "AgentBadge API",
      version: "1.0.0",
      description: "On-chain identity for AI agents",
    },
    mcpServer: {
      name: "agentbadge",
      version: "1.0.0",
      namespaces: [
        { name: "passport", description: "identity", tools: [{ name: "issue_passport", description: "mint" }] },
      ],
      tools: [{ name: "issue_passport", description: "mint" }],
    },
    wellKnownEnv: {
      facilitatorUrl: "https://facilitator.example.com",
      hederaNetwork: "mainnet",
      passportTokenId: "0.0.1",
      directoryTopicId: "0.0.2",
      auditTopicId: "0.0.3",
      evmChainId: "5042",
      erc8004: {
        chainId: 5042,
        registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        agentId: "7",
      },
    },
    didEnabled: false,
    now: NOW,
    ...over,
  } as DiscoverySources;
}

function mkApp(src: DiscoverySources = mkSources()): Hono {
  const app = new Hono();
  app.route("/", createDiscoveryRoutes(() => src));
  return app;
}

describe("buildAgentCard — A2A v1.0 canonical", () => {
  const card = JSON.parse(buildAgentCard(mkSources())) as Record<string, unknown>;

  it("has required A2A v1.0 fields", () => {
    expect(card.name).toBeTruthy();
    expect(card.description).toBeTruthy();
    expect(card.version).toBeTruthy();
    // v1.0: url merged into supportedInterfaces (first = preferred)
    const provider = card.provider as { organization: string; url: string };
    expect(provider.organization).toBeTruthy();
    expect(provider.url).toBe(BASE);
    const caps = card.capabilities as Record<string, unknown>;
    expect(caps.extendedAgentCard).toBe(true);
    expect(card.defaultInputModes).toEqual(["application/json"]);
    expect(card.defaultOutputModes).toEqual(["application/json"]);
    expect(card.documentationUrl).toBeTruthy();
  });

  it("supportedInterfaces is ordered and non-empty", () => {
    const ifs = card.supportedInterfaces as Array<{ url: string; protocolBinding: string; protocolVersion: string }>;
    expect(Array.isArray(ifs)).toBe(true);
    expect(ifs.length).toBeGreaterThan(0);
    expect(ifs[0].url).toBe(`${BASE}/a2a`);
    expect(ifs[0].protocolBinding).toBe("HTTP+JSON");
    expect(ifs[0].protocolVersion).toBe("1.0");
  });

  it("declares x402 securityScheme", () => {
    const schemes = card.securitySchemes as Record<string, { type: string; scheme: string }>;
    expect(schemes.x402.type).toBe("http");
    expect(schemes.x402.scheme).toBe("x402");
  });

  it("skills have REQUIRED tags (v1.0)", () => {
    const skills = card.skills as Array<{ id: string; name: string; tags: string[] }>;
    expect(skills.length).toBeGreaterThan(0);
    for (const s of skills) {
      expect(Array.isArray(s.tags)).toBe(true);
      expect(s.tags.length).toBeGreaterThan(0);
      expect(s.id).toBeTruthy();
    }
  });

  it("keeps AgentBadge auth block (x-agentbadge extension)", () => {
    const ext = card["x-agentbadge"] as { auth?: { challenge_endpoint?: string; headers?: string[] } };
    expect(ext.auth?.challenge_endpoint).toContain("/auth/challenge");
    expect(ext.auth?.headers?.length).toBeGreaterThan(0);
  });
});

describe("buildApiCatalog — RFC 9727 linkset", () => {
  it("produces linkset with anchor=item relations", () => {
    const cat = JSON.parse(buildApiCatalog(mkSources())) as { linkset: Array<Record<string, unknown>> };
    expect(Array.isArray(cat.linkset)).toBe(true);
    const self = cat.linkset.find(
      (l) => l.anchor === `${BASE}/.well-known/api-catalog`,
    ) as { item?: Array<{ href: string }> } | undefined;
    expect(self).toBeDefined();
    expect(self?.item?.length).toBeGreaterThan(0);
    for (const it of self?.item ?? []) {
      expect(it.href.startsWith(BASE)).toBe(true);
    }
    const svc = cat.linkset.find((l) => l["service-desc"]) as Record<string, unknown> | undefined;
    expect(svc).toBeDefined();
  });
});

describe("buildErc8004Agent — registration-v1", () => {
  const reg = JSON.parse(buildErc8004Agent(mkSources())) as Record<string, unknown>;

  it("has registration-v1 type and x402 support", () => {
    expect(reg.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(reg.x402Support).toBe(true);
    expect(reg.name).toBeTruthy();
  });

  it("lists web/A2A/MCP services with absolute endpoints", () => {
    const services = reg.services as Array<{ name: string; endpoint: string }>;
    const names = services.map((s) => s.name);
    expect(names).toContain("web");
    expect(names).toContain("A2A");
    expect(names).toContain("MCP");
    expect(names).toContain("DID");
    for (const s of services) {
      // did:web:… is a URI anchor, not an http URL
      if (!s.endpoint.startsWith("http")) continue;
      expect(s.endpoint.startsWith("https://")).toBe(true);
    }
  });

  it("registrations carry eip155 agentRegistry", () => {
    const regs = reg.registrations as Array<{ agentRegistry: string }>;
    expect(regs[0].agentRegistry).toBe("eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
  });
});

describe("buildMcpServerCard — AB-006 descriptor", () => {
  it("introspects tools from injected source, not hardcode", () => {
    const card = JSON.parse(buildMcpServerCard(mkSources())) as Record<string, unknown>;
    expect(card.name).toBe("agentbadge");
    expect(card.version).toBeTruthy();
    expect(card.endpoint).toBe(`${BASE}/mcp`);
    const tools = card.tools as Array<{ name: string }>;
    expect(tools.map((t) => t.name)).toContain("issue_passport");
  });
});

describe("buildOauthProtectedResource — RFC 9728", () => {
  it("resource + authorization_servers + docs", () => {
    const md = JSON.parse(buildOauthProtectedResource(mkSources())) as Record<string, unknown>;
    expect(md.resource).toBe(BASE);
    expect(md.authorization_servers).toEqual([`${BASE}/.well-known/oauth-authorization-server`]);
    expect(md.bearer_methods_supported).toContain("header");
    expect(md.resource_documentation).toContain(BASE);
  });
});

describe("buildSecurityTxt — RFC 9116", () => {
  it("Expires always in the future (injected clock)", () => {
    const txt = buildSecurityTxt(mkSources());
    expect(txt).toContain("Contact:");
    expect(txt).toContain("Canonical:");
    const m = txt.match(/^Expires: (.+)$/m);
    expect(m).not.toBeNull();
    const expires = new Date(m![1]);
    expect(expires.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("routes: content-types, redirects, gates", () => {
  let app: Hono;
  beforeEach(() => {
    app = mkApp();
  });

  it("GET /.well-known/agent-card.json → a2a+json", async () => {
    const res = await app.request("/.well-known/agent-card.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/a2a+json");
  });

  it("GET /.well-known/api-catalog → linkset+json + rfc9727 profile", async () => {
    const res = await app.request("/.well-known/api-catalog");
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/linkset+json");
    expect(ct).toContain('profile="https://www.rfc-editor.org/info/rfc9727"');
  });

  it("GET /.well-known/erc8004-agent.json → json", async () => {
    const res = await app.request("/.well-known/erc8004-agent.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /.well-known/mcp/server-card.json → json with tools", async () => {
    const res = await app.request("/.well-known/mcp/server-card.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: Array<{ name: string }> };
    expect(body.tools.length).toBeGreaterThan(0);
  });

  it("GET /.well-known/oauth-protected-resource → json", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("GET /.well-known/security.txt → text/plain, Expires future", async () => {
    const res = await app.request("/.well-known/security.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    const expires = new Date(body.match(/^Expires: (.+)$/m)![1]);
    expect(expires.getTime()).toBeGreaterThan(Date.now());
  });

  it("GET /.well-known/agent.json → 301 to agent-card.json", async () => {
    const res = await app.request("/.well-known/agent.json");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`${BASE}/.well-known/agent-card.json`);
  });

  it("did.json gated off → 404", async () => {
    const res = await app.request("/.well-known/did.json");
    expect(res.status).toBe(404);
  });

  it("did.json gated on → 200 DID document", async () => {
    // SLICE-178-7: gate requires key material (didKey) — injected here
    // the same way collectSources injects it from DID_SIGNING_KEY.
    const app2 = mkApp(
      mkSources({
        didEnabled: true,
        didKey: {
          publicJwk: {
            kty: "OKP",
            crv: "Ed25519",
            x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
            kid: "agentbadge-2026-1",
          },
          fragment: "#key-1",
        },
      }),
    );
    const res = await app2.request("/.well-known/did.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id?: string };
    // did:web id derives from the BASE_URL host, not a hardcoded domain
    expect(body.id).toBe("did:web:staging.agentbadge.xyz");
  });

  it("all URLs are absolute on the BASE_URL host", async () => {
    const res = await app.request("/.well-known/agent-registration.json");
    const body = (await res.json()) as { services: Array<{ endpoint: string }> };
    for (const s of body.services) {
      // did:web:… is a URI anchor, not an http URL — skip non-http endpoints
      if (!s.endpoint.startsWith("http")) continue;
      expect(s.endpoint.startsWith(BASE)).toBe(true);
    }
  });

  it("GET /.well-known/agent-registration.json → valid registration-v1 (EPIC-194-2)", async () => {
    const res = await app.request("/.well-known/agent-registration.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      type: string;
      name: string;
      description: string;
      image: string;
      services: Array<{ name: string; endpoint: string }>;
      x402Support: boolean;
      active: boolean;
      supportedTrust: string[];
      registrations: Array<{ agentId: string; agentRegistry: string }>;
    };
    expect(body.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(body.name).toBe("AgentBadge");
    expect(body.description.length).toBeGreaterThan(0);
    expect(body.image).toMatch(/^https:\/\/staging\.agentbadge\.xyz\//);
    const names = body.services.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["web", "A2A", "MCP", "DID"]));
    expect(body.x402Support).toBe(true);
    expect(body.active).toBe(true);
    expect(body.supportedTrust).toEqual(["reputation"]);
    expect(Array.isArray(body.registrations)).toBe(true);
    // honest absence — no claim until 194-3 registers on-chain
    // (test sources fixture has agentId "7" → entry present w/ Arc mainnet registry)
    expect(body.registrations[0].agentId).toBe("7");
    expect(body.registrations[0].agentRegistry).toBe(
      "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    );
  });
});
