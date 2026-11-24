// EPIC-262 (SLICE-262-29): public verification surface — the S4
// opt-in status page. Unauthenticated BY DESIGN: the whole point is
// that anyone can check a published attestation. The opt-in switch
// is the site's `publication` consent (262-23) — no consent → 404
// with an empty body so the route never leaks site existence.
import { Hono } from "hono";
import { hasActiveConsent } from "../../lib/intel/consent";
import {
  effectiveStatus,
  verifyAttestation,
  type IntelAttestation,
} from "../../lib/intel/attestation";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";
import { IntelVerifyPage } from "../../../views/intel/verify";
import { intelPage as page } from "./ui-page";

const latestOf = (list: IntelAttestation[]): IntelAttestation | null =>
  list.length === 0
    ? null
    : list.reduce((a, b) => (a.issued >= b.issued ? a : b));

export function createIntelVerifyRoutes(deps: IntelRouteDeps): Hono {
  const app = new Hono();

  app.get("/verify/agent-surface/:siteId", async (c) => {
    if (!deps.key || !deps.consent || !deps.attestations)
      return c.json(INTEL_KEY_MISSING, 503);
    const siteId = c.req.param("siteId");

    // THE opt-in gate — silent 404, not a redirect or a "private"
    // notice: a probe must not learn the site is registered.
    if (!(await hasActiveConsent(deps.consent, siteId, "publication"))) {
      return c.text("Not found", 404);
    }

    const attestation = latestOf(await deps.attestations.forSite(siteId));
    const now = new Date().toISOString();
    const status = attestation
      ? effectiveStatus(attestation, now)
      : null;
    const signatureValid = attestation
      ? verifyAttestation(attestation, [
          { keyId: deps.key.keyId, publicKey: deps.key.publicKey },
        ]).ok
      : null;

    const wantsJson = c.req
      .header("accept")
      ?.includes("application/json");
    const payload = {
      site_id: siteId,
      attestation,
      effective_status: status,
      signature_valid: signatureValid,
      keys_url: "/.well-known/agentbadge-keys.json",
    };
    if (wantsJson) {
      return c.json(payload, 200, {
        "Cache-Control": "public, max-age=60",
      });
    }
    return c.html(
      page(
        IntelVerifyPage(siteId, attestation, status, signatureValid).toString(),
        "Agent-surface verification — AgentBadge",
        `/verify/agent-surface/${siteId}`,
      ),
      200,
      { "Cache-Control": "public, max-age=60" },
    );
  });

  return app;
}
