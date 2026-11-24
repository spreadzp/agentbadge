// EPIC-262: GET /site/status — site_key-scoped status snapshot.
// The connected plugin periodically pulls ITS OWN latest attestation
// and report findings, then caches them locally (a WP option) — so
// consumers on the site (portal cards, health widgets) read a signed,
// self-contained snapshot without operator keys or a live backend.
// Read-only, site-scoped by the authenticated key (D-262-Q23 spirit).
import type { Hono } from "hono";
import { effectiveStatus, verifyAttestation } from "../../lib/intel/attestation";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerSiteStatusRoute(
  app: Hono,
  deps: IntelRouteDeps,
): void {
  app.get("/site/status", async (c) => {
    if (!deps.key || !deps.registry || !deps.scanJobs || !deps.attestations) {
      return c.json(INTEL_KEY_MISSING, 503);
    }
    const token = bearerToken(c);
    const site = token
      ? await deps.registry.authenticateSiteKey(token)
      : null;
    if (!site) {
      return c.json(
        {
          error: "site_key_invalid",
          message: "missing, unknown, or revoked site key",
        },
        401,
      );
    }

    const now = new Date().toISOString();
    const [atts, jobs] = await Promise.all([
      deps.attestations.forSite(site.site_id),
      deps.scanJobs.forSite(site.site_id),
    ]);

    const att =
      atts.length === 0
        ? null
        : atts.reduce((a, b) => (a.issued >= b.issued ? a : b));
    const attestation = att
      ? {
          attestation_id: att.attestation_id,
          issued: att.issued,
          valid_until: att.valid_until,
          effective_status: effectiveStatus(att, now),
          signature_valid: verifyAttestation(att, [
            { keyId: deps.key.keyId, publicKey: deps.key.publicKey },
          ]).ok,
          scores: att.scores,
          ruleset: att.ruleset,
        }
      : null;

    const job =
      jobs
        .filter((j) => j.report !== null)
        .reduce<typeof jobs[number] | null>(
          (acc, j) => (acc === null || j.createdAt >= acc.createdAt ? j : acc),
          null,
        );
    const report = job?.report
      ? {
          scan_id: job.report.scan.scan_id,
          generated_at: job.report.scan.generated_at,
          completeness: job.report.scan.completeness,
          ruleset: job.report.ruleset,
          findings: job.report.findings.map((f) => ({
            rule_id: f.rule_id,
            name: f.name,
            surface: f.surface,
            severity: f.severity,
            status: f.status,
            reason: f.reason,
            evidence_count: f.evidence_ids.length,
          })),
        }
      : null;

    return c.json(
      {
        site_id: site.site_id,
        snapshot_at: now,
        attestation,
        report,
      },
      200,
      { "Cache-Control": "private, max-age=60" },
    );
  });
}
