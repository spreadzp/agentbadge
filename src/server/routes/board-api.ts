/**
 * SLICE-199-11 (EPIC-199): board mutation routes.
 *
 *   POST /api/board/cards            — ops-tier create (card+bounty+outbox)
 *   POST /api/board/cards/:id/claim  — off-chain claim (199-07)
 *   POST /api/board/cards/:id/submit — lease-holder submit (in_progress→testing)
 *   POST /api/board/cards/:id/review — reviewer EIP-191 verdict (199-08)
 *   POST /api/board/cards/:id/cancel — ops cancel
 *
 *   Idempotency-Key on POST claim/submit/review → board:idem replay
 *   (24h): identical response, zero repeated side effects. Every
 *   mutation invalidates tag "board" (board:snap:* + board:idem:*).
 *   Read routes live in board-api-read.ts; mount both.
 */
import { Hono, type Context } from "hono";
import { isAddress } from "viem";

import { dr, str } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { tryGetCache } from "../lib/cache";
import { createBoardCard } from "../lib/board/create";
import { claimBoardCard, type BoardClaimDeps } from "../lib/board/claim";
import {
  submitBoardReview,
  type BoardReviewDeps,
} from "../lib/board/review";
import { submitBoardWork } from "../lib/board/submit";
import { cancelBoardCard } from "../lib/board/cancel";
import {
  denyPassport,
  denyRate,
  denyTier,
  boardRateLimited,
  err,
  readIdem,
  writeIdem,
  type AgentCtx,
  type HttpStatus,
  type IdemRecord,
} from "./board-api-helpers";

export interface BoardRouteDeps
  extends BoardClaimDeps,
  BoardReviewDeps {
  now?: () => number;
}

export function createBoardRoutes(deps: BoardRouteDeps = {}) {
  const app = new Hono<{ Variables: { agent?: AgentCtx } }>();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  const bump = () => cache?.invalidateTag("board").catch(() => 0);

  async function idempotent(
    c: Context,
    handler: () => Promise<IdemRecord>,
  ): Promise<Response> {
    const key = str(c.req.header("idempotency-key"), 128);
    const hit = await readIdem(cache, key);
    if (hit) return c.json(hit.body, hit.status as 200);
    const rec = await handler();
    await writeIdem(cache, key, rec);
    return c.json(rec.body, rec.status as 200);
  }

  // ─── create (ops tier) ──────────────────────────────────────
  app.post("/api/board/cards", dr("Create board card (ops)"), async (c) => {
    const agent = c.get("agent");
    if (!agent?.agentId) return denyPassport(c);
    if (agent.tier !== "ops") return denyTier(c, "create");
    if (await boardRateLimited(cache, String(agent.agentId)))
      return denyRate(c);
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const result = await createBoardCard(
      {
        title: str(body?.title, 200) ?? "",
        spec: str(body?.spec, 8192) ?? "",
        budgetUsdc: str(body?.budgetUsdc, 32) ?? undefined,
        createdByPassportId: agent.agentId,
      },
      deps,
    );
    if (!result.ok) {
      return errorResponse(
        c,
        result.status as 400 | 409,
        result.code,
        result.message,
      );
    }
    await bump();
    return c.json({ card: result.card }, 201);
  });

  // ─── claim (off-chain, 199-07) ──────────────────────────────
  app.post(
    "/api/board/cards/:id/claim",
    dr("Off-chain board claim"),
    async (c) => {
      const agent = c.get("agent");
      if (!agent?.agentId) return denyPassport(c);
      if (await boardRateLimited(cache, String(agent.agentId)))
        return denyRate(c);
      const body = (await c.req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const payoutWallet = str(body?.payoutWallet, 64);
      const claimSig = str(body?.claimSig, 1024);
      const sigExpiresAt =
        typeof body?.sigExpiresAt === "number"
          ? body.sigExpiresAt
          : undefined;
      if (!payoutWallet || !isAddress(payoutWallet) || !claimSig) {
        return errorResponse(
          c,
          400,
          ErrorCodes.MISSING_FIELDS,
          "body must contain payoutWallet (0x…), claimSig, sigExpiresAt",
        );
      }
      return idempotent(c, async () => {
        const result = await claimBoardCard(
          {
            cardId: c.req.param("id") ?? "",
            passportId: String(agent.agentId),
            payoutWallet: payoutWallet as `0x${string}`,
            claimSig,
            sigExpiresAt,
          },
          deps,
        );
        if (!result.ok) {
          return { status: result.status as HttpStatus, body: err(result) };
        }
        await bump();
        return { status: 200, body: { card: result.card } };
      });
    },
  );

  // ─── submit (lease holder) ──────────────────────────────────
  app.post(
    "/api/board/cards/:id/submit",
    dr("Submit deliverable"),
    async (c) => {
      const agent = c.get("agent");
      if (!agent?.agentId) return denyPassport(c);
      if (await boardRateLimited(cache, String(agent.agentId)))
        return denyRate(c);
      const body = (await c.req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      return idempotent(c, async () => {
        const result = await submitBoardWork(
          {
            cardId: c.req.param("id") ?? "",
            passportId: String(agent.agentId),
            deliverableHash: str(body?.deliverableHash, 80) ?? "",
            prUrl: str(body?.prUrl, 512) ?? undefined,
            commitSha: str(body?.commitSha, 80) ?? undefined,
          },
          deps,
        );
        if (!result.ok) {
          return { status: result.status as HttpStatus, body: err(result) };
        }
        await bump();
        return { status: 200, body: { card: result.card } };
      });
    },
  );

  // ─── review (reviewer verdict, 199-08) ──────────────────────
  app.post(
    "/api/board/cards/:id/review",
    dr("Reviewer verdict"),
    async (c) => {
      const agent = c.get("agent");
      if (!agent?.agentId) return denyPassport(c);
      if (await boardRateLimited(cache, String(agent.agentId)))
        return denyRate(c);
      const body = (await c.req.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const verdict = str(body?.verdict, 10);
      const reviewerWallet = str(body?.reviewerWallet, 64);
      const reviewSig = str(body?.reviewSig, 1024);
      const sigExpiresAt =
        typeof body?.sigExpiresAt === "number"
          ? body.sigExpiresAt
          : undefined;
      if (
        (verdict !== "approve" && verdict !== "reject") ||
        !reviewerWallet ||
        !isAddress(reviewerWallet) ||
        !reviewSig
      ) {
        return errorResponse(
          c,
          400,
          ErrorCodes.MISSING_FIELDS,
          "body must contain verdict approve|reject, reviewerWallet, reviewSig, sigExpiresAt",
        );
      }
      return idempotent(c, async () => {
        const result = await submitBoardReview(
          {
            cardId: c.req.param("id") ?? "",
            reviewerPassportId: String(agent.agentId),
            reviewerWallet,
            verdict,
            comment: str(body?.comment, 1024) ?? undefined,
            reviewSig,
            sigExpiresAt,
          },
          {
            ...deps,
            // Audit H-3: never fall back to `() => false` — the caller's
            // own passport must carry reviewer tier when no dep is wired.
            isReviewer:
              deps.isReviewer ??
              ((p: string) =>
                p === String(agent.agentId) && agent.tier === "reviewer"),
          },
        );
        if (!result.ok) {
          return { status: result.status as HttpStatus, body: err(result) };
        }
        await bump();
        return { status: 200, body: { card: result.card } };
      });
    },
  );
  // ─── cancel (ops tier) ──────────────────────────────────────
  app.post(
    "/api/board/cards/:id/cancel",
    dr("Ops cancel"),
    async (c) => {
      const agent = c.get("agent");
      if (!agent?.agentId) return denyPassport(c);
      if (await boardRateLimited(cache, String(agent.agentId)))
        return denyRate(c);
      if (agent.tier !== "ops") return denyTier(c, "cancel");
      const result = await cancelBoardCard(
        c.req.param("id") ?? "",
        String(agent.agentId),
        deps,
      );
      if (!result.ok) {
        return errorResponse(
          c,
          result.status as 404 | 409,
          result.code,
          result.message,
        );
      }
      await bump();
      return c.json({ card: result.card });
    },
  );

  return app;
}

/** Mount under / — registerApiRoutes calls app.route("/", …). */
export const boardApiRoutes = createBoardRoutes();
