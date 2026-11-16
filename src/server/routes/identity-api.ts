/**
 * SLICE-225-3 (EPIC-225): identity REST routes — thin reads over the
 * domain services (D-225-6) + the two write surfaces the slice
 * allows: owner enrich (EIP-191 sig) and admin revoke.
 *
 *   GET  /api/v1/actors/:wallet              — actor + type + links
 *   GET  /api/v1/entitlements/:wallet        — entitlement rows
 *   GET  /api/v1/reputation/:wallet          — facts (factType filter)
 *   POST /api/v1/actors/:wallet/enrich       — owner enriches links
 *   POST /api/v1/entitlements/:wallet/revoke — adminAuth manual revoke
 *
 * Enforcement (`entitlements.check`) stays internal — consumed by
 * middleware, never exposed as an endpoint (D-225-6).
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Context } from "hono";
import z from "zod";

import { adminAuth } from "../middleware/adminAuth";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { IdentityError, type IdentityService } from "../lib/identity";
import {
  errs,
  jsonBody,
  ok,
} from "./commerce/schemas";
import { readJson, requireWallet } from "./commerce/shared";
import { FACT_TYPES } from "../lib/identity/types";

// ---------- response/error plumbing ----------

const actorSchema = z.record(z.string(), z.unknown());
const entitlementListSchema = z.object({
  wallet: z.string(),
  entitlements: z.array(z.record(z.string(), z.unknown())),
});
const reputationSchema = z.object({
  wallet: z.string(),
  counts: z.record(z.string(), z.number()),
  facts: z.array(z.record(z.string(), z.unknown())),
});
const enrichSchema = z.object({
  agentId: z.string().nullable().optional(),
  passportTokenId: z.string().nullable().optional(),
  did: z.string().nullable().optional(),
  orgId: z.string().nullable().optional(),
  tier: z.string().nullable().optional(),
  type: z
    .enum(["EXTERNAL_AGENT", "EXTERNAL_HUMAN", "ORGANIZATION"])
    .optional(),
});
const revokeSchema = z.object({
  productCode: z.string().min(1),
});

type HttpStatus = 400 | 401 | 403 | 404 | 409;

function mapError(c: Context, e: unknown): Response {
  if (e instanceof IdentityError) {
    const status = (e.httpStatus as HttpStatus) ?? 400;
    const code =
      e.code === "NOT_FOUND"
        ? ErrorCodes.RESOURCE_NOT_FOUND
        : e.code === "CONFLICT"
          ? ErrorCodes.CONFLICT
          : ErrorCodes.INVALID_INPUT;
    return errorResponse(c, status, code, e.message);
  }
  throw e;
}

// ---------- route factory ----------

export function createIdentityRoutes(service: IdentityService): Hono {
  const r = new Hono();

  // GET /api/v1/actors/:wallet — public read; 404 when unknown.
  r.get(
    "/api/v1/actors/:wallet",
    describeRoute({
      tags: ["Identity"],
      summary: "Actor record",
      description:
        "Public read: the wallet-keyed Actor — type (REGISTERED_USER/REGISTERED_AGENT/EXTERNAL_*/ORGANIZATION), identity links (agentId, passportTokenId, did, orgId), tier. 404 when the wallet has no actor row.",
      responses: {
        ...ok(actorSchema, "Actor record"),
        ...errs(400, 404),
      },
    }),
    async (c) => {
      try {
        const wallet = c.req.param("wallet").toLowerCase();
        const actor = await service.actors.get(wallet);
        if (!actor) {
          return errorResponse(
            c,
            404,
            ErrorCodes.RESOURCE_NOT_FOUND,
            `actor ${wallet} not found`,
          );
        }
        return c.json({ actor });
      } catch (e) {
        return mapError(c, e);
      }
    },
  );

  // GET /api/v1/entitlements/:wallet — public read; list rows.
  r.get(
    "/api/v1/entitlements/:wallet",
    describeRoute({
      tags: ["Identity"],
      summary: "Entitlements for a wallet",
      description:
        "Public read: entitlement rows for a wallet — status, productCode, validFrom/Until, sourcePaymentId provenance. Optional ?status=ACTIVE|EXPIRED|REVOKED and ?productCode= filters.",
      responses: {
        ...ok(entitlementListSchema, "Entitlement list"),
        ...errs(400),
      },
    }),
    async (c) => {
      try {
        const wallet = c.req.param("wallet").toLowerCase();
        const status = c.req.query("status") ?? undefined;
        const productCode = c.req.query("productCode") ?? undefined;
        const limit = Math.min(
          Number(c.req.query("limit") ?? 100) || 100,
          500,
        );
        const rows = await service.entitlements.listByOwner(wallet, {
          status,
          productCode,
          limit,
        });
        return c.json({ wallet, entitlements: rows });
      } catch (e) {
        return mapError(c, e);
      }
    },
  );

  // GET /api/v1/reputation/:wallet — public read; facts + rollup.
  r.get(
    "/api/v1/reputation/:wallet",
    describeRoute({
      tags: ["Identity"],
      summary: "Reputation facts for a wallet",
      description:
        "Public read: append-only ReputationFact rows for a wallet with per-factType counts. Optional ?factType= filter and ?limit= (default 100, max 500). Facts are verifiable — each carries sourceRef to the auditable record.",
      responses: {
        ...ok(reputationSchema, "Reputation facts"),
        ...errs(400),
      },
    }),
    async (c) => {
      try {
        const wallet = c.req.param("wallet").toLowerCase();
        const factType = c.req.query("factType") ?? undefined;
        if (factType && !FACT_TYPES.includes(factType as never)) {
          return errorResponse(
            c,
            400,
            ErrorCodes.INVALID_INPUT,
            `factType must be one of ${FACT_TYPES.join("|")}`,
          );
        }
        const limit = Math.min(
          Number(c.req.query("limit") ?? 100) || 100,
          500,
        );
        const [facts, counts] = await Promise.all([
          service.facts.listByActor(wallet, { factType, limit }),
          service.facts.countsByActor(wallet),
        ]);
        return c.json({ wallet, counts, facts });
      } catch (e) {
        return mapError(c, e);
      }
    },
  );

  // POST /api/v1/actors/:wallet/enrich — owner enriches own links
  // (EIP-191 signed commerce challenge; signer must equal :wallet).
  r.post(
    "/api/v1/actors/:wallet/enrich",
    describeRoute({
      tags: ["Identity"],
      summary: "Enrich actor identity links",
      description:
        "Signed write (X-Wallet/X-Sig/X-Timestamp/X-Nonce — commerce v2 challenge): the wallet owner attaches identity links — agentId, passportTokenId, did, orgId, tier — or clears them with null. Signer must equal the path wallet. `type` accepts EXTERNAL_* / ORGANIZATION hints only; REGISTERED_* is derived from registrations/passports.",
      requestBody: jsonBody(enrichSchema),
      responses: {
        ...ok(actorSchema, "Updated actor record"),
        ...errs(400, 401, 409),
      },
    }),
    async (c) => {
      try {
        const auth = await requireWallet(c);
        if (auth instanceof Response) return auth;
        const target = c.req.param("wallet").toLowerCase();
        if (auth.wallet !== target) {
          return errorResponse(
            c,
            403,
            ErrorCodes.WRONG_SIGNER,
            "signer must equal the path wallet",
          );
        }
        // Body already consumed by requireWallet's rawBody cache —
        // parse via the shared readJson helper, not c.req.json().
        const raw = await readJson(c);
        if (raw instanceof Response) return raw;
        const body = enrichSchema.parse(raw);
        const actor = await service.actors.enrich(target, body);
        return c.json({ actor });
      } catch (e) {
        return mapError(c, e);
      }
    },
  );

  // POST /api/v1/entitlements/:wallet/revoke — admin manual revoke.
  r.post(
    "/api/v1/entitlements/:wallet/revoke",
    adminAuth,
    describeRoute({
      tags: ["Identity"],
      summary: "Revoke an entitlement (admin)",
      description:
        "Admin-only manual revoke: transitions the ACTIVE entitlement for (wallet, productCode) to REVOKED. 404 when no ACTIVE row exists.",
      requestBody: jsonBody(revokeSchema),
      responses: {
        ...ok(actorSchema, "Revoked entitlement"),
        ...errs(400, 401, 404),
      },
    }),
    async (c) => {
      try {
        const wallet = c.req.param("wallet").toLowerCase();
        const raw = await readJson(c);
        if (raw instanceof Response) return raw;
        const body = revokeSchema.parse(raw);
        const active = await service.entitlements.listByOwner(wallet, {
          status: "ACTIVE",
          productCode: body.productCode,
          limit: 1,
        });
        if (active.length === 0) {
          return errorResponse(
            c,
            404,
            ErrorCodes.RESOURCE_NOT_FOUND,
            `no ACTIVE entitlement for ${wallet} / ${body.productCode}`,
          );
        }
        const row = await service.entitlements.revoke(active[0].id);
        return c.json({ entitlement: row });
      } catch (e) {
        return mapError(c, e);
      }
    },
  );

  return r;
}
