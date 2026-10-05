// SLICE-176-9: approval API — owner list/decide for parked spend intents.
//  GET  /api/wallets/:address/approvals?state&limit&cursor — audit-feed
//       read gate (wallet itself, registrant, or venue admin), newest
//       first, cursor pagination by approval id.
//  POST /api/wallets/:address/approvals/:id/approve — pending→approved,
//       refreshes permit expiresAt = now + approvalTtlMs (env TTL).
//  POST /api/wallets/:address/approvals/:id/reject — pending→rejected,
//       optional {reason} lands in the approval.decided audit event.
//  Decide uses ownerGate (registrant/venue-admin) — the agent wallet
//  cannot self-approve (that's the point of the hold). Errors:
//  400 invalid address, 401 missing sig, 403 not owner, 404 unknown/
//  foreign id (no existence leak), 409 already decided / expired.
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import type { ApprovalStore, ApprovalState } from "../lib/agent-wallet/approvals";
import { emitSpendAlert } from "../lib/agent-wallet/audit";
import { requireVenueAccess } from "../middleware/venue-auth";
import {
  ADDRESS_RE,
  sigWallet,
  ownerGate,
} from "./agent-wallet-api";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const STATES = new Set<ApprovalState>([
  "pending",
  "approved",
  "rejected",
  "expired",
  "consumed",
]);

export interface AgentWalletApprovalsRoutesDeps {
  store: AgentWalletStore;
  approvals: ApprovalStore;
  /** Permit window granted on approve — APPROVAL_TTL_MS. */
  approvalTtlMs: number;
}

export function createAgentWalletApprovalsRoutes(
  deps: AgentWalletApprovalsRoutesDeps,
): Hono {
  const routes = new Hono();

  /** Shared preamble: address → wallet record → sig → caller. */
  async function preamble(c: Parameters<typeof sigWallet>[0]) {
    const addr = c.req.param("address") ?? "";
    if (!ADDRESS_RE.test(addr)) {
      return {
        err: errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address"),
      } as const;
    }
    const rec = await deps.store.get(addr);
    if (!rec || !rec.active) {
      return {
        err: errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered"),
      } as const;
    }
    const caller = await sigWallet(c);
    if (!caller) {
      return {
        err: errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "valid X-Wallet/X-Sig/X-Timestamp required"),
      } as const;
    }
    return { rec, caller } as const;
  }

  /** Read gate (audit-feed parity): wallet itself, registrant or venue admin. */
  async function readGate(
    c: Parameters<typeof sigWallet>[0],
    rec: { address: string; registeredBy: string; venueId?: string },
    caller: string,
  ): Promise<Response | null> {
    const allowed =
      caller === rec.address.toLowerCase() ||
      caller === rec.registeredBy ||
      (!!rec.venueId &&
        !(await requireVenueAccess(c, rec.venueId, "admin") instanceof Response));
    return allowed
      ? null
      : errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
        "only wallet owner, registrant or venue admin can read approvals");
  }

  routes.get(
    "/api/wallets/:address/approvals",
    describeRoute({
      description:
        "Parked/decided spend-approval intents for a wallet (state filter, " +
        "cursor pagination, newest first); owner-sig read gate",
      responses: {
        200: { description: "{approvals,nextCursor}" },
        400: { description: "Invalid address" },
        401: { description: "Signature required" },
        403: { description: "Caller not wallet owner/registrant/venue admin" },
        404: { description: "Wallet not registered" },
      },
    }),
    async (c) => {
      const p = await preamble(c);
      if ("err" in p) return p.err;
      const authErr = await readGate(c, p.rec, p.caller);
      if (authErr) return authErr;

      const q = c.req.query("state")?.trim();
      const state = q && STATES.has(q as ApprovalState)
        ? (q as ApprovalState)
        : undefined;
      const limit = Math.min(
        Math.max(Number(c.req.query("limit")) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      );
      const cursor = c.req.query("cursor")?.trim() || undefined;

      let list = await deps.approvals.listByWallet(p.rec.address, state);
      if (cursor) {
        const idx = list.findIndex((a) => a.id === cursor);
        if (idx >= 0) list = list.slice(idx + 1);
      }
      const page = list.slice(0, limit);
      return c.json({
        approvals: page,
        nextCursor: list.length > limit ? page[page.length - 1].id : null,
      });
    },
  );

  for (const action of ["approve", "reject"] as const) {
    routes.post(
      `/api/wallets/:address/approvals/:id/${action}`,
      describeRoute({
        description:
          (action === "approve"
            ? "Approve a parked intent — single-use permit (TTL refresh)"
            : "Reject a parked intent — terminal, optional {reason}") +
          "; owner wallet-sig required",
        responses: {
          200: { description: "{approval}" },
          400: { description: "Invalid address" },
          401: { description: "Signature required" },
          403: { description: "Not registrant/venue admin" },
          404: { description: "Wallet or approval not found" },
          409: { description: "Already decided / expired" },
        },
      }),
      async (c) => {
        const p = await preamble(c);
        if ("err" in p) return p.err;
        const authErr = await ownerGate(c, p.rec, p.caller);
        if (authErr) return authErr;

        const id = c.req.param("id");
        const a = await deps.approvals.get(id);
        // 404 on unknown OR foreign-wallet id — no existence leak.
        if (!a || a.wallet.toLowerCase() !== p.rec.address.toLowerCase()) {
          return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
            "approval not found");
        }
        if (a.state === "expired") {
          return errorResponse(c, 409, ErrorCodes.APPROVAL_EXPIRED,
            "approval expired — parked intent is dead");
        }
        if (a.state !== "pending") {
          return errorResponse(c, 409, ErrorCodes.APPROVAL_ALREADY_DECIDED,
            `approval already ${a.state}`);
        }

        const body = (await c.req.json().catch(() => ({}))) as {
          reason?: string;
        };
        // Approve grants a fresh permit window (env TTL); reject keeps the
        // original expiresAt for audit correlation.
        const expiresAt =
          action === "approve" ? Date.now() + deps.approvalTtlMs : undefined;
        const ok = await deps.approvals.decide(
          id,
          action,
          p.caller,
          expiresAt,
        );
        if (!ok) {
          // Lost the decide race (expired/decided between get and write).
          return errorResponse(c, 409, ErrorCodes.APPROVAL_ALREADY_DECIDED,
            "approval no longer pending");
        }

        emitSpendAlert(
          "approval.decided",
          p.rec.address,
          {
            approvalId: id,
            decision: action === "approve" ? "approved" : "rejected",
            actor: p.caller,
            amountUsd: a.amountUsd,
            kind: a.kind,
            refId: a.refId,
            ...(body.reason ? { reason: body.reason } : {}),
          },
          p.rec.venueId,
        );
        const fresh = await deps.approvals.get(id);
        return c.json({ approval: fresh });
      },
    );
  }

  return routes;
}
