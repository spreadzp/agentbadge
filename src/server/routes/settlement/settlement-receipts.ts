/**
 * SLICE-227-4 — receipt artifact + memo-anchor routes.
 *
 *   GET  /api/settlement/receipts/:agreementId         projection + artifact
 *   POST /api/settlement/receipts/:agreementId/anchor  request the memo anchor
 *
 * The receipt projection stays truthful without a signer (artifact:null).
 * The anchor row is durable — the POST queues PENDING and the drain ships
 * memo(target, 0x, memoIdFor("settlement", ref), receiptHash) on Arc;
 * only the returned real txHash flips the row to ANCHORED.
 */
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import z from "zod";

import { getDatabase } from "../../lib/database";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { authenticateOperatorKey } from "../../middleware/operator-verify";
import {
  pickOperatorStores,
  type OperatorStore,
} from "../../lib/operators";
import {
  buildSettlementReceipt,
  createSettlementCtx,
  drainSettlementAnchors,
  getSettlementReceipt,
  isParticipant,
  requestReceiptAnchor,
  settlementReceiptToJson,
} from "../../lib/settlement/index.js";
import { requireWallet, scopedWallet } from "../commerce/shared";
import { errs, ok as okResp, row } from "../commerce/schemas";
import { respond, type SettlementRouteDeps } from "./helpers";

const TAG = { tags: ["Settlement"] };

/** SLICE-264-9: the anchor's admin branch is an operator credential —
 *  opk_ via authenticateOperatorKey, the shared key only through the
 *  break-glass verdict (marked, alerted). A mutating write requires
 *  the workflow capability; anything else falls through to wallet auth.
 *  Returns the principal.id for the audit actor, or null. */
async function operatorAnchorActor(
  c: Parameters<typeof scopedWallet>[0],
  store: OperatorStore,
): Promise<string | null> {
  const provided =
    c.req.header("x-admin-key") ??
    (c.req.header("authorization")?.startsWith("Bearer ")
      ? c.req.header("authorization")!.slice(7)
      : undefined);
  if (!provided) return null;
  const v = await authenticateOperatorKey(store, provided, c.req.path);
  return v.ok && v.operator.capabilities.includes("workflow")
    ? v.principal.id
    : null;
}

export function createSettlementReceiptRoutes(
  deps: SettlementRouteDeps = {},
): Hono {
  const r = new Hono();
  const getDb = deps.getDb ?? getDatabase;

  // GET /api/settlement/receipts/:agreementId — participant receipt
  r.get(
    "/api/settlement/receipts/:agreementId",
    describeRoute({
      ...TAG,
      summary: "Settlement receipt projection",
      description:
        "Deterministic receipt over settled state — ordered milestones " +
        "with intents/legs (payee, amount, txHash) plus the memo anchor " +
        "row once anchored. `artifact` is the signed EIP-712 receipt " +
        "when a signer is wired and ≥1 leg completed (else null). " +
        "Participant-only.",
      responses: {
        ...okResp(z.object({ agreementRef: z.string() }).passthrough()),
        ...errs(401, 404),
      },
    }),
    async (c) => {
      const viewer = await scopedWallet(c);
      if (viewer instanceof Response) return viewer;
      if (viewer === null) {
        return errorResponse(
          c,
          401,
          ErrorCodes.UNAUTHORIZED,
          "participant signature required",
        );
      }
      const receipt = await getSettlementReceipt(
        createSettlementCtx(getDb()),
        c.req.param("agreementId"),
      );
      if (
        !receipt ||
        !isParticipant(
          viewer,
          receipt.plan.buyerWallet,
          receipt.plan.providerWallet,
        )
      ) {
        return errorResponse(
          c,
          404,
          ErrorCodes.RESOURCE_NOT_FOUND,
          `receipt ${c.req.param("agreementId")} not found`,
        );
      }
      let artifact = null;
      if (deps.signer && deps.chainId !== undefined) {
        const built = await buildSettlementReceipt(
          createSettlementCtx(getDb()),
          c.req.param("agreementId"),
          { signer: deps.signer, chainId: deps.chainId },
        );
        artifact = built.ok ? settlementReceiptToJson(built.value) : null;
      }
      return c.json({ ...receipt, artifact });
    },
  );

  // POST /api/settlement/receipts/:agreementId/anchor — participant or
  // admin requests the memo anchor (idempotent; drain is async).
  r.post(
    "/api/settlement/receipts/:agreementId/anchor",
    describeRoute({
      ...TAG,
      summary: "Request a memo anchor for the settlement receipt",
      description:
        "Gated to fully-terminal plans (every milestone RELEASED/" +
        "CANCELLED, ≥1 RELEASED). Creates the durable PENDING anchor " +
        "row — the outbox drain ships memo(target, 0x, " +
        "memoIdFor('settlement', ref), receiptHash) on Arc and marks " +
        "it ANCHORED with the real txHash. Idempotent per agreement; " +
        "a replay returns duplicate:true.",
      responses: {
        ...okResp(
          z
            .object({ anchor: row, duplicate: z.boolean() })
            .passthrough(),
        ),
        ...errs(400, 401, 403, 404, 409, 503),
      },
    }),
    async (c) => {
      const opActor = await operatorAnchorActor(
        c,
        deps.operatorStore ?? pickOperatorStores(getDb()),
      );
      const admin = opActor !== null;
      let actor: string;
      if (admin) {
        actor = opActor;
      } else {
        const auth = await requireWallet(c, { allowIdemReplay: true });
        if (auth instanceof Response) return auth;
        actor = auth.wallet;
      }
      if (!deps.signer || deps.chainId === undefined) {
        return errorResponse(
          c,
          503,
          ErrorCodes.CHECKOUT_PROVIDER_UNAVAILABLE,
          "receipt signer not configured — anchoring unavailable",
        );
      }
      const res = await requestReceiptAnchor(
        createSettlementCtx(getDb()),
        c.req.param("agreementId"),
        actor,
        { signerAddress: deps.signer.address, chainId: deps.chainId },
        { admin },
      );
      // Fire-and-forget drain when a send seam is wired — the durable
      // row carries PENDING until the memo tx lands (or attempts cap).
      if (res.ok && deps.anchorSend && deps.memo && deps.selfAddress) {
        void drainSettlementAnchors(createSettlementCtx(getDb()), {
          send: deps.anchorSend,
          memo: deps.memo,
          selfAddress: deps.selfAddress,
        }).catch(() => undefined);
      }
      return respond(c, res);
    },
  );

  return r;
}
