// EPIC-262 (SLICE-262-28): attestation routes — operator-channel
// only (abop_). Issue binds a signed artifact to an immutable
// report; read recomputes effective status + signature validity.
import type { Context, Hono } from "hono";
import {
  effectiveStatus,
  issueAttestation,
  revokeAttestation,
  verifyAttestation,
  ATTESTATION_VALIDITY_DAYS_DEFAULT,
} from "../../lib/intel/attestation";
import {
  authenticateOperator,
  rolePermitted,
} from "../../lib/intel/registry";
import type { IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

const ATTEST_UNAVAILABLE = {
  error: "attestation_unavailable",
  message: "attestation store or signing key is not configured",
} as const;

export function registerAttestationRoutes(
  app: Hono,
  deps: IntelRouteDeps,
): void {
  const authOp = async (c: Context) => {
    const token = bearerToken(c);
    const auth =
      token && deps.registryStores
        ? await authenticateOperator(deps.registryStores, token)
        : null;
    if (!auth) {
      return {
        err: c.json(
          { error: "key_invalid", message: "missing, unknown, or revoked operator key" },
          401,
        ),
      };
    }
    if (!rolePermitted(auth.role, "attestation")) {
      return {
        err: c.json(
          { error: "role_denied", role: auth.role, message: `role "${auth.role}" cannot run attestation` },
          403,
        ),
      };
    }
    return { auth };
  };

  // POST /scans/:scanId/attest — issue for the job's signed report
  app.post("/scans/:scanId/attest", async (c) => {
    if (!deps.key || !deps.attestations || !deps.scanJobs)
      return c.json(ATTEST_UNAVAILABLE, 503);
    const g = await authOp(c);
    if ("err" in g) return g.err;
    const job = await deps.scanJobs.byScanId(c.req.param("scanId"));
    if (!job || job.tenantId !== g.auth.tenant_id)
      return c.json({ error: "scan_unknown", message: "unknown scan id" }, 404);
    const r = await issueAttestation(
      deps.attestations,
      job,
      deps.key,
      deps.attestationValidityDays ?? ATTESTATION_VALIDITY_DAYS_DEFAULT,
    );
    if (!r.ok) {
      const status = r.reason === "no_report" ? 409 : 422;
      return c.json({ error: r.reason }, status);
    }
    return c.json({ attestation: r.attestation }, 201);
  });

  // GET /attestations/:id — tenant-scoped read; status derived at
  // read (expiry lazy), signature re-verified every time.
  app.get("/attestations/:id", async (c) => {
    if (!deps.key || !deps.attestations) return c.json(ATTEST_UNAVAILABLE, 503);
    const g = await authOp(c);
    if ("err" in g) return g.err;
    const a = await deps.attestations.byId(c.req.param("id"));
    if (!a || a.tenant_id !== g.auth.tenant_id)
      return c.json({ error: "attestation_unknown" }, 404);
    const v = verifyAttestation(a, [
      { keyId: deps.key.keyId, publicKey: deps.key.publicKey },
    ]);
    return c.json({
      attestation: a,
      effective_status: effectiveStatus(a, new Date().toISOString()),
      signature_valid: v.ok,
      ...(v.ok ? {} : { signature_error: v.error }),
    });
  });

  // POST /attestations/:id/revoke — {reason}; idempotent.
  app.post("/attestations/:id/revoke", async (c) => {
    if (!deps.key || !deps.attestations) return c.json(ATTEST_UNAVAILABLE, 503);
    const g = await authOp(c);
    if ("err" in g) return g.err;
    const a = await deps.attestations.byId(c.req.param("id"));
    if (!a || a.tenant_id !== g.auth.tenant_id)
      return c.json({ error: "attestation_unknown" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      reason?: unknown;
    } | null;
    const reason =
      typeof body?.reason === "string" && body.reason.trim()
        ? body.reason
        : "revoked_by_operator";
    const r = await revokeAttestation(deps.attestations, a.attestation_id, reason);
    if (!r.ok) return c.json({ error: "attestation_unknown" }, 404);
    return c.json({
      attestation: r.attestation,
      already_revoked: r.alreadyRevoked === true,
    });
  });

  // GET /sites/:id/attestations — list for the tenant's own site.
  app.get("/sites/:id/attestations", async (c) => {
    if (!deps.key || !deps.attestations) return c.json(ATTEST_UNAVAILABLE, 503);
    const g = await authOp(c);
    if ("err" in g) return g.err;
    const siteId = c.req.param("id");
    const ctx = deps.registry
      ? await deps.registry.resolveSiteContext(siteId)
      : null;
    if (!ctx || ctx.tenantId !== g.auth.tenant_id)
      return c.json({ error: "site_unknown" }, 404);
    const list = await deps.attestations.forSite(siteId);
    const now = new Date().toISOString();
    return c.json({
      attestations: list.map((a) => ({
        ...a,
        effective_status: effectiveStatus(a, now),
      })),
    });
  });
}
