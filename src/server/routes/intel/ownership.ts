// EPIC-262 (SLICE-262-8): site connect + ownership verification.
//
// POST /ownership/handshake — the plugin proves installation control
// with its site_key (installation control IS the ownership proof,
// decisions.md) and grants audit-consent inline: site connect IS the
// consent to be audited.
//
// POST /ownership/dns/challenge + /dns/verify — the operator proves
// domain control by publishing a stateless HMAC-bound TXT record;
// verification re-upserts the domain_control scope (90d re-verify
// orientir, D-262-Q9).
import type { Hono } from "hono";
import {
  DNS_REVERIFY_DAYS,
  DNS_TXT_NAME,
  dnsTxtMatch,
  expectedDnsToken,
} from "../../lib/intel/ownership";
import { grantConsent } from "../../lib/intel/consent";
import { gateOperatorSite } from "./operator-guard";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

const DAY_MS = 86_400_000;

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerOwnershipRoutes(
  app: Hono,
  deps: IntelRouteDeps,
): void {
  app.post("/ownership/handshake", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    if (!deps.registry || !deps.consent) {
      return c.json(
        { error: "ownership_unavailable", message: "ownership/consent stores are not configured" },
        503,
      );
    }
    const token = bearerToken(c);
    const auth = token
      ? await deps.registry.authenticateSiteKey(token)
      : null;
    if (!auth) {
      return c.json(
        { error: "key_invalid", message: "missing, unknown, or revoked site key" },
        401,
      );
    }
    // installation control verified BY the authenticated site_key —
    // and the connect itself grants the first audit-consent inline
    const proof = await deps.registry.recordOwnershipProof(
      auth.site_id,
      "installation_control",
      { method: "plugin_handshake", verifiedAt: new Date() },
    );
    const consent = await grantConsent(deps.consent, auth.site_id, "audit", {
      principal: "site_key",
      id: auth.site_key_id,
    });
    return c.json({ proof, consent }, 200);
  });

  app.post("/ownership/dns/challenge", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    if (!deps.registry || !deps.registryStores) {
      return c.json(
        { error: "ownership_unavailable", message: "ownership stores are not configured" },
        503,
      );
    }
    const body = (await c.req.json().catch(() => null)) as {
      site_id?: unknown;
    } | null;
    const gate = await gateOperatorSite(
      deps,
      bearerToken(c),
      body,
      "ownership_verify",
    );
    if (!gate.ok) return c.json(gate.body, gate.status);
    if (!gate.ctx.primaryHostname) {
      return c.json(
        { error: "site_no_domain", message: "site has no active domain to verify" },
        409,
      );
    }
    const hostname = gate.ctx.primaryHostname;
    return c.json({
      hostname,
      txt_name: `${DNS_TXT_NAME}.${hostname}`,
      txt_value: expectedDnsToken(deps.key, gate.siteId, hostname),
      ttl_hint_seconds: 300,
      reverify_days: DNS_REVERIFY_DAYS,
    });
  });

  app.post("/ownership/dns/verify", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    if (!deps.registry || !deps.registryStores || !deps.dnsResolver) {
      return c.json(
        { error: "ownership_unavailable", message: "ownership stores are not configured" },
        503,
      );
    }
    const body = (await c.req.json().catch(() => null)) as {
      site_id?: unknown;
    } | null;
    const gate = await gateOperatorSite(
      deps,
      bearerToken(c),
      body,
      "ownership_verify",
    );
    if (!gate.ok) return c.json(gate.body, gate.status);
    const hostname = gate.ctx.primaryHostname;
    if (!hostname) {
      return c.json(
        { error: "site_no_domain", message: "site has no active domain to verify" },
        409,
      );
    }
    const expected = expectedDnsToken(deps.key, gate.siteId, hostname);
    if (!(await dnsTxtMatch(deps.dnsResolver, hostname, expected))) {
      return c.json(
        {
          error: "dns_txt_not_found",
          message: `no "${expected}" TXT record on ${hostname}`,
        },
        422,
      );
    }
    const now = new Date();
    const domains = await deps.registryStores.domains.forSite(gate.siteId);
    const primary = domains.find(
      (d) => d.hostname === hostname && d.isPrimary,
    );
    const proof = await deps.registry.recordOwnershipProof(
      gate.siteId,
      "domain_control",
      {
        method: "dns_txt",
        verifiedAt: now,
        reverifyAfter: new Date(now.getTime() + DNS_REVERIFY_DAYS * DAY_MS),
        domainId: primary?.id,
      },
    );
    return c.json({ proof }, 200);
  });
}
