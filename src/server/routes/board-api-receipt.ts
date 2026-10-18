/**
 * SLICE-201-2 (EPIC-201): Task Receipt route.
 *
 *   GET /api/board/cards/:id/receipt — EIP-712-signed portable receipt for a
 *   DONE card (200), 404 unknown card, 409 non-terminal card.
 *
 * Receipts are immutable once a card reaches DONE — responses are cached
 * (tag "board") and carry an ETag so agents can cheaply revalidate.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { CacheProvider } from "@agentbadge/cache";

import { dr } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { tryGetCache } from "../lib/cache";
import {
  buildTaskReceipt,
  type BuildReceiptDeps,
} from "../lib/board/task-receipt";

const RECEIPT_TTL_SEC = 60 * 60; // immutable after DONE — long TTL is safe

export function createReceiptRoutes(
  deps: Partial<BuildReceiptDeps> & { cache?: CacheProvider | null },
) {
  const app = new Hono();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  app.get(
    "/api/board/cards/:id/receipt",
    dr("EIP-712-signed task receipt (DONE cards only)"),
    async (c) => {
      if (
        !deps.signer ||
        deps.chainId === undefined ||
        !deps.agentRegistry ||
        !deps.escrowAddress
      ) {
        return errorResponse(
          c,
          503 as never,
          ErrorCodes.RESOURCE_NOT_FOUND,
          "task receipts are not enabled — no receipt signer configured",
        );
      }
      const buildDeps: BuildReceiptDeps = {
        signer: deps.signer,
        chainId: deps.chainId,
        agentRegistry: deps.agentRegistry,
        escrowAddress: deps.escrowAddress,
      };
      const cardId = c.req.param("id") ?? "";
      const cacheKey = `board:receipt:${cardId}`;
      if (cache) {
        const hit = await cache.get<unknown>(cacheKey).catch(() => null);
        if (hit) {
          const etag = `W/"${createHash("sha256").update(JSON.stringify(hit)).digest("hex").slice(0, 32)}"`;
          c.header("ETag", etag);
          return c.json(hit);
        }
      }

      const result = await buildTaskReceipt(cardId, buildDeps);
      if (result === null) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          "unknown cardId",
        );
      }
      if ("error" in result) {
        return errorResponse(
          c,
          409,
          ErrorCodes.INVALID_STATE,
          "card is not in a terminal state — receipt requires column=done",
        );
      }

      // Strip the EIP-712 signing body from the wire — it's an internal
      // message artifact; the public shape is what verifyTypedData needs.
      const { body: _body, ...publicReceipt } = result;
      const etag = `W/"${createHash("sha256").update(result.signature).digest("hex").slice(0, 32)}"`;
      c.header("ETag", etag);
      await cache
        ?.set(cacheKey, publicReceipt, {
          ttlSec: RECEIPT_TTL_SEC,
          tags: ["board"],
        })
        .catch(() => undefined);
      return c.json(publicReceipt);
    },
  );

  return app;
}
