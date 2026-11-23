// EPIC-262 (SLICE-262-2): registry domain ops — shared by memory and
// Postgres adapters (identical behavior, identical tests).

import { generateReportId } from "../../../../agent-readiness/integrity/ulid";
import type { IntelRegistryStores } from "./store";
import {
  generateSiteKeyPlaintext,
  hashSiteKey,
  isSiteKeyPlaintext,
  siteKeyPrefix,
} from "./site-key";
import {
  OWNERSHIP_METHODS,
  SITE_ENVIRONMENTS,
  type IntelCustomer,
  type IntelDomain,
  type IntelOwnershipProof,
  type IntelSite,
  type IntelSiteKey,
  type IntelTenant,
  type OwnershipKind,
  type OwnershipMethod,
  type SiteEnvironment,
} from "./types";

const uid = (prefix: string) => `${prefix}_${generateReportId()}`;
const normalizeHostname = (h: string) => h.trim().toLowerCase().replace(/\.$/, "");

export interface SiteKeyAuthContext {
  site_id: string;
  site_key_id: string;
}

export interface OwnershipProofInput {
  method: OwnershipMethod;
  verifiedAt?: Date;
  reverifyAfter?: Date;
  domainId?: string;
}

const iso = (d?: Date) => d?.toISOString() ?? null;

export interface IntelRegistryService {
  createTenant(input: { slug: string; name: string }): Promise<IntelTenant>;
  createCustomer(
    tenantId: string,
    input: { name: string },
  ): Promise<IntelCustomer>;
  createSite(
    customerId: string,
    input: { environment?: SiteEnvironment; domains?: string[] },
  ): Promise<IntelSite>;
  addDomain(siteId: string, hostname: string): Promise<IntelDomain>;

  mintSiteKey(
    siteId: string,
  ): Promise<{ plaintext: string; record: IntelSiteKey }>;
  rotateSiteKey(
    keyId: string,
  ): Promise<{ plaintext: string; record: IntelSiteKey }>;
  revokeSiteKey(keyId: string, reason: string): Promise<IntelSiteKey>;
  authenticateSiteKey(plaintext: string): Promise<SiteKeyAuthContext | null>;

  recordOwnershipProof(
    siteId: string,
    kind: OwnershipKind,
    input: OwnershipProofInput,
  ): Promise<IntelOwnershipProof>;
  ownershipStatus(siteId: string): Promise<{
    installation_control: IntelOwnershipProof | null;
    domain_control: IntelOwnershipProof | null;
  }>;
  needsReverification(now: Date): Promise<IntelOwnershipProof[]>;
}

export function createIntelRegistryService(
  stores: IntelRegistryStores,
): IntelRegistryService {
  const now = () => new Date().toISOString();

  async function requireSite(siteId: string): Promise<IntelSite> {
    const site = await stores.sites.byId(siteId);
    if (!site) throw new Error(`site not found: ${siteId}`);
    return site;
  }

  async function insertDomain(
    siteId: string,
    hostname: string,
    isPrimary: boolean,
  ): Promise<IntelDomain> {
    const normalized = normalizeHostname(hostname);
    if (!normalized) throw new Error("hostname must be non-empty");
    const existing = await stores.domains.byHostname(normalized);
    if (existing) {
      throw new Error(
        `hostname already claimed: "${normalized}" (site ${existing.siteId})`,
      );
    }
    return stores.domains.insert({
      id: uid("dom"),
      siteId,
      hostname: normalized,
      isPrimary,
      status: "active",
      createdAt: now(),
    });
  }

  async function mint(siteId: string, rotatedFromId: string | null) {
    const plaintext = generateSiteKeyPlaintext();
    const record = await stores.siteKeys.insert({
      id: uid("key"),
      siteId,
      keyHash: hashSiteKey(plaintext),
      keyPrefix: siteKeyPrefix(plaintext),
      status: "active",
      rotatedFromId,
      createdAt: now(),
      revokedAt: null,
    });
    return { plaintext, record };
  }

  return {
    async createTenant({ slug, name }) {
      if (await stores.tenants.bySlug(slug)) {
        throw new Error(`tenant slug taken: "${slug}"`);
      }
      const t = now();
      return stores.tenants.insert({
        id: uid("tnt"),
        slug,
        name,
        status: "active",
        createdAt: t,
        updatedAt: t,
      });
    },

    async createCustomer(tenantId, { name }) {
      if (!(await stores.tenants.byId(tenantId))) {
        throw new Error(`tenant not found: ${tenantId}`);
      }
      const t = now();
      return stores.customers.insert({
        id: uid("cus"),
        tenantId,
        name,
        status: "active",
        createdAt: t,
        updatedAt: t,
      });
    },

    async createSite(customerId, { environment = "production", domains = [] }) {
      if (!SITE_ENVIRONMENTS.includes(environment)) {
        throw new Error(`unknown environment: ${environment}`);
      }
      if (!(await stores.customers.byId(customerId))) {
        throw new Error(`customer not found: ${customerId}`);
      }
      const t = now();
      const site = await stores.sites.insert({
        id: uid("site"),
        customerId,
        environment,
        status: "active",
        createdAt: t,
        updatedAt: t,
      });
      try {
        for (const [i, hostname] of domains.entries()) {
          await insertDomain(site.id, hostname, i === 0);
        }
      } catch (err) {
        // memory: nothing else to undo except the site row itself
        await stores.sites.update({ ...site, status: "deleted", updatedAt: now() });
        throw err;
      }
      return site;
    },

    async addDomain(siteId, hostname) {
      await requireSite(siteId);
      return insertDomain(siteId, hostname, false);
    },

    async mintSiteKey(siteId) {
      const site = await requireSite(siteId);
      if (site.status !== "active") {
        throw new Error(`cannot mint key for ${site.status} site ${siteId}`);
      }
      return mint(siteId, null);
    },

    async rotateSiteKey(keyId) {
      const old = await stores.siteKeys.byId(keyId);
      if (!old) throw new Error(`site key not found: ${keyId}`);
      if (old.status !== "active") {
        throw new Error(`cannot rotate ${old.status} key ${keyId}`);
      }
      const next = await mint(old.siteId, old.id);
      await stores.siteKeys.update({
        ...old,
        status: "revoked",
        revokedAt: now(),
      });
      return next;
    },

    async revokeSiteKey(keyId, _reason) {
      const key = await stores.siteKeys.byId(keyId);
      if (!key) throw new Error(`site key not found: ${keyId}`);
      if (key.status === "revoked") return key;
      return stores.siteKeys.update({
        ...key,
        status: "revoked",
        revokedAt: now(),
      });
    },

    async authenticateSiteKey(plaintext) {
      if (!isSiteKeyPlaintext(plaintext)) return null;
      const key = await stores.siteKeys.byKeyHash(hashSiteKey(plaintext));
      if (!key || key.status !== "active") return null;
      return { site_id: key.siteId, site_key_id: key.id };
    },

    async recordOwnershipProof(siteId, kind, input) {
      await requireSite(siteId);
      if (!OWNERSHIP_METHODS.includes(input.method)) {
        throw new Error(
          `ownership method not supported in v1: ${String(input.method)}`,
        );
      }
      if (kind === "domain_control" && input.domainId) {
        const domain = (await stores.domains.forSite(siteId)).find(
          (d) => d.id === input.domainId,
        );
        if (!domain) {
          throw new Error(
            `domainId ${input.domainId} does not belong to site ${siteId}`,
          );
        }
      }
      const existing = await stores.ownership.byScope(siteId, kind);
      const t = now();
      return stores.ownership.upsert({
        id: existing?.id ?? uid("own"),
        siteId,
        kind,
        method: input.method,
        status: input.verifiedAt ? "verified" : "pending",
        verifiedAt: iso(input.verifiedAt),
        reverifyAfter: iso(input.reverifyAfter),
        domainId: input.domainId ?? null,
        createdAt: existing?.createdAt ?? t,
        updatedAt: t,
      });
    },

    async ownershipStatus(siteId) {
      await requireSite(siteId);
      const [installation_control, domain_control] = await Promise.all([
        stores.ownership.byScope(siteId, "installation_control"),
        stores.ownership.byScope(siteId, "domain_control"),
      ]);
      return { installation_control, domain_control };
    },

    async needsReverification(at) {
      return stores.ownership.due(at.toISOString());
    },
  };
}
