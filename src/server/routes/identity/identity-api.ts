/**
 * SLICE-225-3 (EPIC-225): identity REST routes — thin reads over the
 * domain services (D-225-6) + owner enrich (EIP-191 sig) + admin revoke.
 *
 *   GET  /api/v1/actors/:wallet              — actor + type + links
 *   GET  /api/v1/entitlements/:wallet        — entitlement rows
 *   GET  /api/v1/reputation/:wallet          — facts (factType filter)
 *   POST /api/v1/actors/:wallet/enrich       — owner enriches links
 *   POST /api/v1/entitlements/:wallet/revoke — operatorAuth manual revoke
 *
 * Enforcement (`entitlements.check`) stays internal — consumed by
 * middleware, never exposed as an endpoint (D-225-6).
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { getDatabase } from "../../lib/database";
import { pickOperatorStores, type OperatorStore } from "../../lib/operators";
import { operatorAuth } from "../../middleware/operatorAuth";
import { capabilityGate } from "../../middleware/operator-gate";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";
import type { IdentityService } from "../../lib/identity";
import {
  errs,
  jsonBody,
  ok,
} from "../commerce/schemas";
import { readJson, requireWallet } from "../commerce/shared";
import {
  actorSchema,
  entitlementListSchema,
  enrichSchema,
  mapIdentityError,
  parseBody,
  parseLimit,
  publicActor,
  publicEntitlement,
  publicFact,
  reputationSchema,
  revokeSchema,
} from "./identity-dtos";
import {
  ENTITLEMENT_STATUSES,
  FACT_TYPES,
} from "../../lib/identity/types";

// ---------- route factory ----------

export function createIdentityRoutes(
  service: IdentityService,
  opts: { operatorStore?: OperatorStore } = {},
): Hono {
  const r = new Hono();
  const opStore = opts.operatorStore ?? pickOperatorStores(getDatabase());

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
        return c.json({ actor: publicActor(actor) });
      } catch (e) {
        return mapIdentityError(c, e);
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
        "Public read: entitlement rows for a wallet — status, productCode, validFrom/Until. Optional ?status=ACTIVE|EXPIRED|REVOKED and ?productCode= filters. (sourcePaymentId / idempotencyKey / payload are internal rails — redacted, audit H-6.)",
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
        // Audit M-6: validate query filters — junk values used to
        // reach the store unvalidated.
        if (
          status !== undefined &&
          !ENTITLEMENT_STATUSES.includes(status as never)
        ) {
          return errorResponse(
            c,
            400,
            ErrorCodes.INVALID_INPUT,
            `status must be one of ${ENTITLEMENT_STATUSES.join("|")}`,
          );
        }
        if (productCode !== undefined && !/^[A-Z0-9_]{2,64}$/.test(productCode)) {
          return errorResponse(
            c,
            400,
            ErrorCodes.INVALID_INPUT,
            "productCode must match ^[A-Z0-9_]{2,64}$",
          );
        }
        const limit = parseLimit(c.req.query("limit"));
        const rows = await service.entitlements.listByOwner(wallet, {
          status,
          productCode,
          limit,
        });
        return c.json({ wallet, entitlements: rows.map(publicEntitlement) });
      } catch (e) {
        return mapIdentityError(c, e);
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
        const limit = parseLimit(c.req.query("limit"));
        const [facts, counts] = await Promise.all([
          service.facts.listByActor(wallet, { factType, limit }),
          service.facts.countsByActor(wallet),
        ]);
        return c.json({ wallet, counts, facts: facts.map(publicFact) });
      } catch (e) {
        return mapIdentityError(c, e);
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
        ...errs(400, 401, 409, 503),
      },
    }),
    async (c) => {
      try {
        // H-2: no store-level idem dedupe here — the nonce must be
        // fresh even when an idempotency_key header rides along.
        const auth = await requireWallet(c, { allowIdemReplay: false });
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
        const body = parseBody(c, enrichSchema, raw);
        if (body instanceof Response) return body;
        const actor = await service.actors.enrich(target, body);
        return c.json({ actor: publicActor(actor) });
      } catch (e) {
        return mapIdentityError(c, e);
      }
    },
  );

  // POST /api/v1/entitlements/:wallet/revoke — operator manual revoke
  // (264-8: workflow cap).
  r.post(
    "/api/v1/entitlements/:wallet/revoke",
    operatorAuth(opStore),
    capabilityGate(),
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
        const body = parseBody(c, revokeSchema, raw);
        if (body instanceof Response) return body;
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
        return c.json({ entitlement: publicEntitlement(row) });
      } catch (e) {
        return mapIdentityError(c, e);
      }
    },
  );

  return r;
}
