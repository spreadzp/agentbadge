/**
 * SLICE-153-4: venue admin routes — owner/delegate self-serve config.
 *
 *   PATCH /api/venue/instances/:id           — name/desc/policies/active
 *   GET   /api/venue/instances/:id/admin     — full record + stats + audit
 *   POST  /api/venue/instances/:id/delegates — {add}|{remove} admin wallets
 *
 * All gated on admin+ role (owner wallet or delegates[] count as admin —
 * see venueRole in lib/venue/members). Every PATCH writes an audit entry
 * {ts, actor, field, old, new} to the venue ledger (meta lane) so tenant
 * members can see who changed what.
 */
import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isAddress } from "viem";

import { requireVenueAccess, type VenueAccess } from "../middleware/venue-auth";
import { listVenueMembers } from "../lib/venue/members";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import {
  appendAdminAudit,
  listAdminAudit,
  updateVenue,
  type VenuePolicies,
  type VenueRecord,
} from "../lib/venue/venues";
import { listJobs } from "../lib/venue/store";
import { venueEvaluator } from "./venue-api-helpers";

const EVALUATOR_RE = /^(server|owner|custom:0x[0-9a-fA-F]{40})$/;

function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  return c.req.json().catch(() => null) as Promise<Record<
    string,
    unknown
  > | null>;
}

/** Validate + normalize a PATCH body → VenueRecord patch or error string. */
function buildPatch(body: Record<string, unknown>): {
  patch: Partial<
    Pick<
      VenueRecord,
      "name" | "description" | "clientPolicy" | "requiredClass" | "active" |
        "policies"
    >
  >;
  error?: string;
} {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim() ||
      body.name.length > 120) {
      return { patch: {}, error: "name must be a string ≤120 chars" };
    }
    patch.name = body.name.trim();
  }
  if (body.description !== undefined) {
    if (body.description !== null &&
      (typeof body.description !== "string" || body.description.length > 500)) {
      return { patch: {}, error: "description must be a string ≤500 chars" };
    }
    patch.description = body.description ?? undefined;
  }
  if (body.clientPolicy !== undefined) {
    if (body.clientPolicy !== "members" && body.clientPolicy !== "open") {
      return { patch: {}, error: 'clientPolicy must be "members" | "open"' };
    }
    patch.clientPolicy = body.clientPolicy;
  }
  if (body.requiredClass !== undefined) {
    const cls = Number(body.requiredClass);
    if (!Number.isInteger(cls) || cls < 0 || cls > 7) {
      return { patch: {}, error: "requiredClass must be an int 0..7" };
    }
    patch.requiredClass = cls || undefined;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return { patch: {}, error: "active must be boolean" };
    }
    patch.active = body.active;
  }
  if (body.policies !== undefined) {
    if (typeof body.policies !== "object" || body.policies === null) {
      return { patch: {}, error: "policies must be an object" };
    }
    const p = body.policies as Record<string, unknown>;
    const policies: VenuePolicies = {};
    if (p.evaluator !== undefined) {
      const ev = String(p.evaluator);
      if (!EVALUATOR_RE.test(ev)) {
        return {
          patch: {},
          error: 'policies.evaluator must be "server" | "owner" | "custom:0x…"',
        };
      }
      policies.evaluator = ev as VenuePolicies["evaluator"];
    }
    if (p.takeRateBps !== undefined) {
      const bps = Number(p.takeRateBps);
      if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
        return { patch: {}, error: "policies.takeRateBps must be int 0..10000" };
      }
      policies.takeRateBps = bps;
    }
    if (p.branding !== undefined) {
      if (typeof p.branding !== "object" || p.branding === null) {
        return { patch: {}, error: "policies.branding must be an object" };
      }
      const b = p.branding as Record<string, unknown>;
      policies.branding = {
        title: b.title != null ? String(b.title).slice(0, 120) : undefined,
        color: b.color != null ? String(b.color).slice(0, 32) : undefined,
        logoUrl: b.logoUrl != null ? String(b.logoUrl).slice(0, 500) : undefined,
      };
    }
    patch.policies = policies;
  }
  return { patch: patch as never };
}

/** Deep-ish diff → one audit entry per changed key (policies flattened). */
function auditPatch(
  access: VenueAccess,
  patch: Record<string, unknown>,
): void {
  const venue = access.venue;
  const actor = access.wallet;
  for (const [field, next] of Object.entries(patch)) {
    if (field === "policies" && typeof next === "object" && next !== null) {
      const cur = venue.policies ?? {};
      for (const [pk, pv] of Object.entries(next)) {
        const old = (cur as Record<string, unknown>)[pk];
        if (JSON.stringify(old) !== JSON.stringify(pv)) {
          appendAdminAudit(venue.id, {
            actor, field: `policies.${pk}`, old, new: pv,
          });
        }
      }
      continue;
    }
    const old = (venue as unknown as Record<string, unknown>)[field];
    if (JSON.stringify(old) !== JSON.stringify(next)) {
      appendAdminAudit(venue.id, { actor, field, old, new: next });
    }
  }
}

export function registerVenueAdminRoutes(app: Hono): void {
  // PATCH /api/venue/instances/:id — owner/admin wallet-sig.
  app.patch("/api/venue/instances/:id", describeRoute({
    tags: ["Venue"],
    summary: "Patch venue config (admin+): name, description, policies, active",
    responses: {
      200: { description: "Updated venue record" },
      400: { description: "Invalid field value" },
      401: { description: "Signature check failed" },
      403: { description: "Requires admin+ role" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const body = await bodyOf(c);
    if (!body) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "JSON body required");
    }
    const { patch, error } = buildPatch(body);
    if (error) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, error);
    }
    if (Object.keys(patch).length === 0) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "at least one patchable field required");
    }
    auditPatch(access, patch);
    const venue = updateVenue(access.venue.id, patch);
    return c.json({ venue });
  });

  // GET /api/venue/instances/:id/admin — admin-only console payload.
  app.get("/api/venue/instances/:id/admin", describeRoute({
    tags: ["Venue"],
    summary: "Venue admin payload: record + members + stats + audit trail",
    responses: {
      200: { description: "Admin payload" },
      401: { description: "Signature check failed" },
      403: { description: "Requires admin+ role" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const jobs = listJobs({ venueId: access.venue.id });
    const byStatus: Record<string, number> = {};
    let volume = 0;
    for (const j of jobs) {
      byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
      volume += j.budgetUsdc;
    }
    return c.json({
      venue: access.venue,
      members: listVenueMembers(access.venue.id, { includeRevoked: true }),
      stats: {
        jobs: byStatus,
        jobCount: jobs.length,
        volumeUsdc: volume,
        memberCount:
          listVenueMembers(access.venue.id).length,
      },
      audit: listAdminAudit(access.venue.id),
      serverEvaluator: venueEvaluator(),
    });
  });

  // POST /api/venue/instances/:id/delegates — {add}|{remove} admin wallet.
  app.post("/api/venue/instances/:id/delegates", describeRoute({
    tags: ["Venue"],
    summary: 'Manage delegate admin wallets {add: "0x…"} | {remove: "0x…"}',
    responses: {
      200: { description: "Updated delegates" },
      400: { description: "Invalid wallet" },
      401: { description: "Signature check failed" },
      403: { description: "Requires admin+ role" },
      404: { description: "Unknown venue" }
    },
  }), async (c) => {
    const access = await requireVenueAccess(c, c.req.param("id"), "admin");
    if (access instanceof Response) return access;
    const body = await bodyOf(c);
    const op = body?.add != null ? "add" : body?.remove != null ? "remove" : null;
    const target = (body?.add ?? body?.remove) as unknown;
    if (!op || typeof target !== "string" || !isAddress(target)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        'body must be {add: "0x…"} or {remove: "0x…"}');
    }
    const w = target.toLowerCase();
    const cur = access.venue.delegates.map((d) => d.toLowerCase());
    if (op === "add" && cur.includes(w)) {
      return c.json({ delegates: access.venue.delegates });
    }
    if (op === "remove" && !cur.includes(w)) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "delegate not found");
    }
    const delegates = op === "add"
      ? [...access.venue.delegates, target as `0x${string}`]
      : access.venue.delegates.filter((d) => d.toLowerCase() !== w);
    appendAdminAudit(access.venue.id, {
      actor: access.wallet,
      field: "delegates",
      old: access.venue.delegates,
      new: delegates,
    });
    const venue = updateVenue(access.venue.id, { delegates });
    return c.json({ delegates: venue?.delegates });
  });
}
