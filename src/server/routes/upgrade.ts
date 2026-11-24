/**
 * Tier upgrade route.
 *
 * Reference: SLICE-1-4, hackathon-flow.md:110,233
 *
 * POST /passport/:tokenId/:serial/upgrade — upgrade tier in-place
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { type Tier, extractTokenAndSerial, didToAccountId } from "@agentbadge/hedera-core";
import { upgradeTier, getPassportInfo } from "@agentbadge/passport";
import { errorSchema } from "../openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { chainDisabled, passportChainEnabled } from "../lib/passport-chain-gate";
import { didAuthEnrich } from "../middleware/did-enrich";
import { getDatabase } from "../lib/database";
import { pickOperatorStores, type OperatorStore } from "../lib/operators";
import { authenticateOperatorKey } from "../middleware/operator-verify";

/** Request body for tier upgrade. */
export interface UpgradeRequestBody {
  newTier: Tier;
  accountId?: string;
}

// SLICE-264-8: the admin branch is an operator credential with the
// workflow capability (the shared key rides the dual-auth window via
// the same verdict — break_glass, marked, deadline-bound). An invalid
// key falls through to the DID check instead of 401ing the route.
export function createUpgradeRoutes(
  deps: { operatorStore?: OperatorStore } = {},
): Hono {
  const upgradeRoutes = new Hono();
  const opStore = deps.operatorStore ?? pickOperatorStores(getDatabase());

upgradeRoutes.post(
    "/passport/:tokenId/:serial/upgrade",
    // EPIC-259 (SLICE-259-4): optional DID verification — sets verifiedDid
    // when X-AgentBadge-* headers carry a valid signature.
    didAuthEnrich(),
    describeRoute({
      tags: ["Passport"],
      summary: "Upgrade passport tier",
      description:
        "Upgrades the passport NFT tier in-place by updating metadata and submitting an audit message.",
      responses: {
        200: { description: "Tier upgraded successfully" },
        400: {
          description: "Invalid parameters or downgrade attempt",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
        403: {
          description: "Passport not owned by requester",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
        404: {
          description: "Passport not found or revoked",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
        500: {
          description: "Upgrade failed",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    async (c) => {
      if (!passportChainEnabled()) return chainDisabled(c);

      const tokenId = c.req.param("tokenId");
      const serialStr = c.req.param("serial");
      const serial = Number(serialStr);

      if (!tokenId || Number.isNaN(serial)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid tokenId or serial");
      }

      let body: UpgradeRequestBody;
      try {
        const json = await c.req.json();
        body = json as UpgradeRequestBody;
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
      }

      if (!body.newTier) {
        return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "newTier is required");
      }

      // EPIC-259 (SLICE-259-4): requester identity comes from verified
      // context — owner DID signature matching this passport, or admin —
      // never from the request body's accountId field (spoofable).
      if (body.accountId) {
        return errorResponse(
          c, 400, ErrorCodes.INVALID_INPUT,
          "accountId must not be sent — identity is taken from the verified DID signature or operator credential",
        );
      }

      const xAdminKey = c.req.header("X-Admin-Key");
      const authHeader = c.req.header("Authorization");
      const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const key = xAdminKey || bearerKey;
      let isAdmin = false;
      if (key) {
        const verdict = await authenticateOperatorKey(opStore, key, c.req.path);
        if (verdict.ok) {
          isAdmin = verdict.operator.capabilities.includes("workflow");
        } else if (verdict.status === 500) {
          // store/integrity failure is loud — never masked as "not admin".
          return errorResponse(c, 500, verdict.code, verdict.message);
        }
      }
      const verifiedDid = (c.get as (key: string) => unknown)("verifiedDid") as
        | string
        | undefined;

      let accountId: string | null;
      if (isAdmin) {
        const info = await getPassportInfo(tokenId, serial);
        if (!info) {
          return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, "Passport not found");
        }
        accountId = info.owner;
      } else {
        if (!verifiedDid) {
          return errorResponse(
            c, 401, ErrorCodes.MISSING_FIELDS,
            `Upgrade requires a verified DID signature matching did:hcs:${tokenId}:${serial} or admin access`,
          );
        }
        const parsed = extractTokenAndSerial(verifiedDid);
        if (!parsed || parsed.tokenId !== tokenId || parsed.serial !== serial) {
          return errorResponse(
            c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
            "Verified DID does not match the target passport",
          );
        }
        accountId = await didToAccountId(verifiedDid);
        if (!accountId) {
          return errorResponse(c, 401, ErrorCodes.PASSPORT_NOT_FOUND, "Verified DID does not resolve to an account");
        }
      }

      try {
        const result = await upgradeTier(tokenId, serial, body.newTier, accountId);
        return c.json(result, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";

        if (message.includes("not found")) {
          return errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, message);
        }
        if (message.includes("not owned")) {
          return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, message);
        }
        if (message.includes("revoked")) {
          return errorResponse(c, 404, ErrorCodes.PASSPORT_REVOKED, message);
        }
        if (message.includes("downgrade") || message.includes("not a forward upgrade")) {
          return errorResponse(c, 400, ErrorCodes.INVALID_JSON, message);
        }

        return errorResponse(c, 500, ErrorCodes.INTERNAL_ERROR, `Upgrade failed: ${message}`, { retryable: true });
      }
    },
  );

  return upgradeRoutes;
}
