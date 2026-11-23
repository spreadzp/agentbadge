// EPIC-262 (SLICE-262-0a/3): /api/intel/* namespace.
// GET /status — scaffold smoke. POST /evidence — THE evidence entry
// point: site_key auth → trust boundary → signed envelope → persisted
// with dedupe + retention (SLICE-262-3, D-262-Q5/Q6/Q8).
import { Hono } from "hono";
import { INTEL_API_VERSION } from "../../lib/intel/keys";
import {
  acceptSubmission,
  collectorSubmissionSchema,
} from "../../lib/intel/evidence";
import { computeDedupeHash } from "../../lib/intel/evidence/store";
import { registerScanRoute } from "./scans";
import { INTEL_KEY_MISSING, type IntelRouteDeps } from "./index";

const DAY_MS = 86_400_000;

function bearerToken(c: { req: { header(name: string): string | undefined } }) {
  const h = c.req.header("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function createIntelApiRoutes(deps: IntelRouteDeps): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    return c.json({
      service: "agent-surface-intel",
      status: "ok",
      version: INTEL_API_VERSION,
      key_id: deps.key.keyId,
    });
  });

  // The ONLY evidence entry point. Every trust field on the envelope is
  // derived from the authenticated site_key — the body stays an
  // untrusted CollectorSubmission all the way to the boundary.
  app.post("/evidence", async (c) => {
    if (!deps.key) return c.json(INTEL_KEY_MISSING, 503);
    if (!deps.registry || !deps.evidence) {
      return c.json(
        {
          error: "intake_unavailable",
          message: "evidence intake stores are not configured",
        },
        503,
      );
    }

    // 1. site_key → authenticated site identity (never from the body)
    const token = bearerToken(c);
    const auth = token
      ? await deps.registry.authenticateSiteKey(token)
      : null;
    if (!auth) {
      return c.json(
        { error: "site_key_invalid", message: "missing, unknown, or revoked site key" },
        401,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: "submission_invalid", message: "body is not JSON" },
        400,
      );
    }

    // schema-parse up front — needed for dedupe + ref checks before
    // signing (acceptSubmission re-parses at the boundary)
    const parsed = collectorSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: "submission_invalid",
          message: "not a CollectorSubmission (trust fields are rejected, not stripped)",
          issues: parsed.error.issues.map((i) => i.message),
        },
        400,
      );
    }
    const sub = parsed.data;

    // 2. untrusted site_ref must equal the authenticated site
    if (sub.site_ref !== auth.site_id) {
      return c.json(
        {
          error: "site_ref_mismatch",
          message: `submission claims site "${sub.site_ref}" but the site key authenticates "${auth.site_id}"`,
        },
        400,
      );
    }

    // 3. collector identity derived from the authenticated site —
    // a site_key implies the wp_plugin collector class in v1
    const collectorId = `wp_plugin@${auth.site_id}`;
    if (sub.collector_id !== collectorId) {
      return c.json(
        {
          error: "collector_mismatch",
          message: `submission claims collector "${sub.collector_id}" but the channel derives "${collectorId}"`,
        },
        400,
      );
    }

    // 4. idempotency — a byte-identical resubmission returns the SAME
    // stored envelope (retry does not mint a fresh trust record)
    const dedupeHash = computeDedupeHash(sub, auth.site_id);
    const existing = await deps.evidence.byDedupeHash(dedupeHash);
    if (existing) {
      return c.json({ deduplicated: true, envelope: existing.envelope }, 200);
    }

    // 5. trust boundary → signed canonical envelope
    let envelope;
    try {
      envelope = acceptSubmission(
        sub,
        {
          collector: {
            type: "wp_plugin",
            id: collectorId,
            version:
              c.req.header("agentbadge-plugin-version") ?? "unknown",
          },
          site_id: auth.site_id,
        },
        deps.key,
      );
    } catch (err) {
      return c.json(
        {
          error: "submission_invalid",
          message: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }

    // 6. persist verbatim + transparent retention deadline (D-262-Q8)
    const receivedAt = envelope.received_at;
    const days = deps.evidenceRetentionDays ?? 0;
    const expiresAt =
      days > 0
        ? new Date(new Date(receivedAt).getTime() + days * DAY_MS).toISOString()
        : null;
    try {
      await deps.evidence.insert({
        id: envelope.envelope_id,
        schemaVersion: envelope.schema_version,
        siteId: auth.site_id,
        scanId: envelope.scan_id,
        collectorId,
        provenance: envelope.provenance,
        dedupeHash,
        receivedAt,
        expiresAt,
        envelope,
      });
    } catch {
      // unique dedupeHash → a concurrent twin won the insert race;
      // answer the same deduplicated envelope rather than erroring
      const twin = await deps.evidence.byDedupeHash(dedupeHash);
      if (twin) {
        return c.json({ deduplicated: true, envelope: twin.envelope }, 200);
      }
      throw new Error("evidence insert failed");
    }

    return c.json({ deduplicated: false, envelope }, 201);
  });

  // POST /scans moved to scans.ts (api.ts line budget) — SLICE-262-6/7
  registerScanRoute(app, deps);

  return app;
}

