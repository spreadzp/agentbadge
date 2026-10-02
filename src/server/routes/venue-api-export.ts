/**
 * SLICE-153-7: venue audit export — «аудит на выгрузку» (D6-CONTEXT).
 *
 *   GET /api/venue/instances/:id/export?format=json|csv   — admin+ only
 *
 * JSON = canonical (recursively key-sorted) payload + sha256 manifest so
 * the export is self-verifying. CSV = flattened sections (# jobs /
 * # members / # payments / # audit) for Excel.
 *
 * Read-only by construction: requireVenueAccess never checks the
 * subscription gate, so expired venues still export (AC).
 *
 * ARC_BV_EXPORT_MEMO=1 → response carries `anchor` = memo() calldata the
 * owner signs to anchor the manifest hash onchain (sales feature).
 */
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { encodeFunctionData, toHex } from "viem";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";

import { requireVenueAccess } from "../middleware/venue-auth";
import { listJobs } from "../lib/venue/store";
import { listVenueMembers } from "../lib/venue/members";
import { listAdminAudit, type VenueRecord } from "../lib/venue/venues";
import { listVenuePayments, subscriptionStatus } from "../lib/venue/billing";
import type { VenueNetwork } from "../lib/venue/chain";
import { recordVenueEvent } from "../services/venue-events";

/** Recursively key-sorted deep copy — canonical form for the manifest. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>).sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

function buildExport(venue: VenueRecord, now: number) {
  return {
    schema: "agentbadge.venue-export.v1",
    exportedAt: new Date(now).toISOString(),
    venue,
    subscriptionStatus: subscriptionStatus(venue, Math.floor(now / 1000)),
    jobs: listJobs({ venueId: venue.id }),
    members: listVenueMembers(venue.id, { includeRevoked: true }),
    payments: listVenuePayments(venue.id),
    audit: listAdminAudit(venue.id),
  };
}

/** RFC-4180 cell escape. */
const cell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cols: unknown[]) => cols.map(cell).join(",");

function exportCsv(ex: ReturnType<typeof buildExport>): string {
  const out: string[] = [
    row("# venue", ex.venue.id, ex.venue.slug, ex.venue.name,
      ex.subscriptionStatus, ex.exportedAt),
    "# jobs", row("jobId", "onchainJobId", "title", "status", "budgetUsdc",
      "client", "provider", "verdict", "rating", "createdAt",
      "txCreated", "txFunded", "txSubmitted", "txCompleted", "txRated"),
    ...ex.jobs.map((j) => row(j.jobId, j.onchainJobId, j.title, j.status,
      j.budgetUsdc, j.client, j.provider, j.verdict, j.rating?.score,
      j.createdAt, j.chainTxs.created, j.chainTxs.funded, j.chainTxs.submitted,
      j.chainTxs.completed, j.chainTxs.rated)),
    "# members", row("wallet", "role", "addedAt", "revoked"),
    ...ex.members.map((m) => row(m.wallet, m.role, m.addedAt, m.revoked)),
    "# payments", row("ts", "payer", "amountAtomic", "durationSec", "tx",
      "expiresAtAfter"),
    ...ex.payments.map((p) => row(new Date(p.ts).toISOString(), p.payer,
      p.amountAtomic, p.durationSec, p.tx, p.expiresAtAfter)),
    "# audit", row("ts", "actor", "field", "old", "new"),
    ...ex.audit.map((a) => row(new Date(a.ts).toISOString(), a.actor, a.field,
      a.old, a.new)),
  ];
  return out.join("\n") + "\n";
}

export function registerVenueExportRoutes(
  app: Hono,
  net: () => VenueNetwork,
): void {
  app.get("/api/venue/instances/:id/export", describeRoute({
    tags: ["Venue"],
    summary:
      "Audit export (admin+) — jobs/members/payments/audit, sha256 manifest; " +
      "?format=csv flattens. ARC_BV_EXPORT_MEMO=1 → onchain anchor calldata.",
    responses: {
      200: { description: "Export payload / CSV body" },
      401: { description: "Signature required" },
      403: { description: "Requires venue role ≥ admin" },
      404: { description: "Unknown venue" },
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const venue = access.venue;
    const now = Date.now();
    const payload = buildExport(venue, now);
    const manifest = {
      algorithm: "sha256" as const,
      canonicalJsonSha256:
        createHash("sha256").update(JSON.stringify(canon(payload))).digest("hex"),
      counts: {
        jobs: payload.jobs.length,
        members: payload.members.length,
        payments: payload.payments.length,
        audit: payload.audit.length,
      },
    };
    recordVenueEvent({
      action: "venue.export",
      text: `venue ${venue.slug} — audit export (${manifest.counts.jobs} jobs)`,
      jobId: "",
      dedupeKey: `venue.export:${venue.id}:${manifest.canonicalJsonSha256}`,
    });

    if (c.req.query("format") === "csv") {
      return new Response(exportCsv(payload) + `# manifest ${manifest.canonicalJsonSha256}\n`, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition":
            `attachment; filename="venue-${venue.slug}-export.csv"`,
        },
      });
    }

    // Optional onchain anchor — memo(ownerWallet, 0x, memoId, context w/ hash).
    let anchor: { to: string; data: string; description: string } | undefined;
    if (process.env.ARC_BV_EXPORT_MEMO === "1") {
      const n = net();
      anchor = {
        to: n.memo,
        data: encodeFunctionData({
          abi: MEMO_ABI,
          functionName: "memo",
          args: [
            venue.ownerWallet,
            "0x",
            memoIdFor("venue-export", venue.id,
              manifest.canonicalJsonSha256.slice(0, 16)),
            toHex(JSON.stringify({
              kind: "venue-export",
              venueId: venue.id,
              sha256: manifest.canonicalJsonSha256,
              exportedAt: payload.exportedAt,
            })),
          ],
        } as never),
        description: `memo anchor — venue ${venue.slug} export ${manifest.canonicalJsonSha256.slice(0, 12)}…`,
      };
    }
    return c.json({ ...payload, manifest, anchor });
  });
}
