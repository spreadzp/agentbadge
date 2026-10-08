/**
 * SLICE-191-9: verdict verification — recomputes the anchor hash and
 * reports the Arc anchor tx. Free (verification IS the product).
 *
 *   GET /api/fx-delta/verify/:id
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { getFxDeltaAnchorQueue } from "../lib/fx-delta";
import {
  verdictCanonical,
  verdictHash,
} from "../lib/fx-delta/anchor";
import { ARC_EXPLORER } from "../lib/fx-delta/arc-writer";

export const fxDeltaVerifyRoutes = new Hono();

fxDeltaVerifyRoutes.get(
  "/api/fx-delta/verify/:id",
  describeRoute({
    tags: ["FX Delta"],
    summary: "Verify a delta alert verdict — hash recomputed, onchain tx",
    description:
      "Returns the stored verdict, recomputed sha256(canonical), and " +
      "the Arc txHash once anchored. Free — verification is the product.",
    responses: {
      200: { description: "Verdict status + hash" },
      404: { description: "Unknown verdict id" },
    },
  }),
  (c) => {
    const q = getFxDeltaAnchorQueue();
    const rec = q?.get(c.req.param("id"));
    if (!rec) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "unknown verdict id",
      );
    }
    return c.json({
      id: rec.id,
      status: rec.status,
      verdict: rec.verdict,
      canonical: verdictCanonical(rec.verdict),
      sha256: verdictHash(rec.verdict),
      hashMatch: verdictHash(rec.verdict) === rec.hash,
      txHash: rec.txHash ?? null,
      explorer: rec.txHash ? `${ARC_EXPLORER}/tx/${rec.txHash}` : null,
      attempts: rec.attempts,
      lastError: rec.lastError ?? null,
    });
  },
);
