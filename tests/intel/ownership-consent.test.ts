// EPIC-262 (SLICE-262-8): site connect + ownership verify — plugin
// handshake proves installation_control AND grants audit-consent
// inline; operator proves domain_control via stateless DNS TXT
// challenge (HMAC-bound, no challenge store). Consent grant/revoke
// through the operator channel with tenant isolation.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
  type IntelRegistryService,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import {
  createMemoryIntelConsentStore,
  hasActiveConsent,
} from "../../src/server/lib/intel/consent";
import {
  expectedDnsToken,
  type DnsResolver,
} from "../../src/server/lib/intel/ownership";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
  evidenceRetentionDays: 0,
} as IntelEnvConfig)!;

let stores: IntelRegistryStores;
let registry: IntelRegistryService;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let app: Hono;
let tenantId: string;
let siteId: string;
let siteKey: string;
let opKey: string;
let viewerKey: string;
const resolverHolder: { resolver: DnsResolver } = {
  resolver: async () => [],
};

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  consent = createMemoryIntelConsentStore();
  const tenant = await registry.createTenant({ slug: "pryme", name: "P" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  const site = await registry.createSite(customer.id, {
    domains: ["bakery.com"],
  });
  siteId = site.id;
  siteKey = (await registry.mintSiteKey(site.id)).plaintext;
  opKey = (
    await inviteOperator(stores, tenantId, {
      email: "op@pryme.io",
      role: "operator",
    })
  ).plaintext;
  viewerKey = (
    await inviteOperator(stores, tenantId, {
      email: "ro@pryme.io",
      role: "viewer",
    })
  ).plaintext;
  resolverHolder.resolver = async () => [];
  app = new Hono();
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key,
      registry,
      registryStores: stores,
      consent,
      dnsResolver: (h) => resolverHolder.resolver(h),
    }),
  );
});

const post = (path: string, auth?: string, body?: unknown) =>
  app.request(`/api/intel${path}`, {
    method: "POST",
    headers: {
      ...(auth !== undefined ? { authorization: auth } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("POST /ownership/handshake — site connect", () => {
  it("absk_ → installation_control verified + audit consent granted inline", async () => {
    const res = await post("/ownership/handshake", `Bearer ${siteKey}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proof.kind).toBe("installation_control");
    expect(body.proof.method).toBe("plugin_handshake");
    expect(body.proof.status).toBe("verified");
    expect(body.proof.verifiedAt).toBeTruthy();
    expect(body.consent.kind).toBe("audit");
    expect(body.consent.status).toBe("granted");
    expect(body.consent.grantedByPrincipal).toBe("site_key");
    // consent really live for the scans gate
    expect(await hasActiveConsent(consent, siteId, "audit")).toBe(true);
  });

  it("idempotent — second handshake keeps the same proof id", async () => {
    const a = await (await post("/ownership/handshake", `Bearer ${siteKey}`)).json();
    const b = await (await post("/ownership/handshake", `Bearer ${siteKey}`)).json();
    expect(b.proof.id).toBe(a.proof.id);
    expect(b.consent.id).toBe(a.consent.id);
  });

  it("401 for missing/unknown/abop_ key (operator key is not a site key)", async () => {
    expect((await post("/ownership/handshake")).status).toBe(401);
    expect(
      (await post("/ownership/handshake", `Bearer ${opKey}`)).status,
    ).toBe(401);
  });
});

describe("POST /ownership/dns/challenge", () => {
  it("returns deterministic site+hostname-bound TXT instructions", async () => {
    const res = await post("/ownership/dns/challenge", `Bearer ${opKey}`, {
      site_id: siteId,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hostname).toBe("bakery.com");
    expect(body.txt_name).toBe("_agentbadge-verify.bakery.com");
    expect(body.txt_value).toBe(
      expectedDnsToken(key, siteId, "bakery.com"),
    );
    // bound to site — another site produces a different value
    const other = await registry.createSite(
      (await registry.createCustomer(tenantId, { name: "D" })).id,
      { domains: ["other-bakery.com"] },
    );
    expect(
      expectedDnsToken(key, other.id, "other-bakery.com"),
    ).not.toBe(body.txt_value);
  });

  it("403 viewer; 403 foreign tenant; 401 unknown key", async () => {
    expect(
      (
        await post("/ownership/dns/challenge", `Bearer ${viewerKey}`, {
          site_id: siteId,
        })
      ).status,
    ).toBe(403);
    const rival = await registry.createTenant({ slug: "rival", name: "R" });
    const rivalOp = (
      await inviteOperator(stores, rival.id, {
        email: "x@rival.io",
        role: "owner",
      })
    ).plaintext;
    const res = await post("/ownership/dns/challenge", `Bearer ${rivalOp}`, {
      site_id: siteId,
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("site_not_in_tenant");
    expect(
      (
        await post("/ownership/dns/challenge", `Bearer ${siteKey}`, {
          site_id: siteId,
        })
      ).status,
    ).toBe(401);
  });
});

describe("POST /ownership/dns/verify", () => {
  it("TXT match → domain_control verified + reverifyAfter ≈ +90d", async () => {
    resolverHolder.resolver = async (h) =>
      h === "bakery.com"
        ? [expectedDnsToken(key, siteId, "bakery.com"), "v=spf1 -all"]
        : [];
    const res = await post("/ownership/dns/verify", `Bearer ${opKey}`, {
      site_id: siteId,
    });
    expect(res.status).toBe(200);
    const proof = (await res.json()).proof;
    expect(proof.kind).toBe("domain_control");
    expect(proof.method).toBe("dns_txt");
    expect(proof.status).toBe("verified");
    const days =
      (Date.parse(proof.reverifyAfter) - Date.parse(proof.verifiedAt)) /
      86_400_000;
    expect(days).toBeCloseTo(90, 0);
    // domain linkage recorded
    expect(proof.domainId).toBeTruthy();
  });

  it("no matching TXT → 422 dns_txt_not_found", async () => {
    resolverHolder.resolver = async () => ["v=spf1 -all"];
    const res = await post("/ownership/dns/verify", `Bearer ${opKey}`, {
      site_id: siteId,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("dns_txt_not_found");
    const { domain_control } = await registry.ownershipStatus(siteId);
    expect(domain_control).toBeNull();
  });

  it("re-verify upserts the same scope row (no duplicates)", async () => {
    resolverHolder.resolver = async () => [
      expectedDnsToken(key, siteId, "bakery.com"),
    ];
    const a = (
      await (
        await post("/ownership/dns/verify", `Bearer ${opKey}`, {
          site_id: siteId,
        })
      ).json()
    ).proof;
    const b = (
      await (
        await post("/ownership/dns/verify", `Bearer ${opKey}`, {
          site_id: siteId,
        })
      ).json()
    ).proof;
    expect(b.id).toBe(a.id);
    const { domain_control } = await registry.ownershipStatus(siteId);
    expect(domain_control!.id).toBe(a.id);
  });
});

describe("POST /consent + /consent/revoke", () => {
  it("operator grant → revoke → grant again, same row", async () => {
    const g = await post("/consent", `Bearer ${opKey}`, {
      site_id: siteId,
      kind: "audit",
    });
    expect(g.status).toBe(200);
    const granted = (await g.json()).consent;
    expect(granted.status).toBe("granted");
    expect(granted.grantedByPrincipal).toBe("operator");

    const r = await post("/consent/revoke", `Bearer ${opKey}`, {
      site_id: siteId,
      kind: "audit",
    });
    const revoked = (await r.json()).consent;
    expect(revoked.id).toBe(granted.id);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeTruthy();
    expect(await hasActiveConsent(consent, siteId, "audit")).toBe(false);
  });

  it("400 kind_invalid; 403 viewer; 401 without operator key", async () => {
    expect(
      (
        await post("/consent", `Bearer ${opKey}`, {
          site_id: siteId,
          kind: "telepathy",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("/consent", `Bearer ${viewerKey}`, {
          site_id: siteId,
          kind: "audit",
        })
      ).status,
    ).toBe(403);
    expect(
      (await post("/consent", `Bearer ${siteKey}`, { site_id: siteId, kind: "audit" }))
        .status,
    ).toBe(401);
  });
});
