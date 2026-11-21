/**
 * EPIC-228 (SLICE-228-3, D-228-8): public interaction polls —
 *   GET /api/v1/agent/requests/:id        → public projection
 *   GET /api/v1/agent/requests/:id/status → {status} cheap poll
 *
 * Split out of agent-interaction-api.ts for the 300-line guard.
 * Visibility rule (tenant isolation, A2A ownerAgentId precedent):
 * an identified actor whose actorRef differs from the record's gets
 * a 404; anonymous callers read via the unguessable requestId.
 */

import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import type { RequestInboxStores } from "../../lib/request-inbox/store";
import type { InboxRequestRecord } from "../../lib/request-inbox/types";
import {
  publicProjection,
  resolveActor,
} from "../../lib/agent-interaction";

const notFound = (c: Context) =>
  errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such request");

const expired410 = (c: Context) =>
  errorResponse(c, 410, ErrorCodes.REQUEST_EXPIRED, "request expired — do not retry", {
    retryable: false,
  });

/** 404 when the caller may not read this row (identical-oracle:
 *  foreign ids look exactly like unknown ids).
 *
 *  Arc-audit M1: API_KEY-owned rows now require the owning key on
 *  GET too (agentKeyAuth is global and resolves on GET) — an
 *  anonymous caller who learns the id can no longer read them.
 *  DID/ANON rows stay capability-URL readable: the DID scheme only
 *  authenticates mutations (middleware skips GET/HEAD), so the
 *  unguessable ireq_* id is the only read mechanism those callers
 *  have — document that honestly rather than brick the owner. */
function tenantDeny(
  c: Context,
  record: InboxRequestRecord,
): Response | null {
  const actor = resolveActor(c);
  if (record.actorResolution === "API_KEY") {
    return actor.actorRef === record.actorRef ? null : notFound(c);
  }
  if (
    actor.actorRef !== null &&
    record.actorRef !== null &&
    actor.actorRef !== record.actorRef
  ) {
    return notFound(c);
  }
  return null;
}

export function registerInteractionGetRoutes(
  app: Hono,
  stores: RequestInboxStores,
): void {
  app.get(
    "/api/v1/agent/requests/:id",
    describeRoute({
      summary: "Poll an interaction request — public projection",
      tags: ["Agent Interaction"],
      responses: {
        200: { description: "Projection {id,status,response?,timestamps}" },
        404: { description: "Unknown id or other-tenant request" },
        410: { description: "Expired — do not retry" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (id.length > 128) return notFound(c);
      const { record, expired } = await stores.requests.get(id);
      if (!record) return notFound(c);
      if (expired) return expired410(c);
      const deny = tenantDeny(c, record);
      if (deny) return deny;
      return c.json(publicProjection(record));
    },
  );

  app.get(
    "/api/v1/agent/requests/:id/status",
    describeRoute({
      summary: "Cheap status-only poll for an interaction request",
      tags: ["Agent Interaction"],
      responses: {
        200: { description: "{status}" },
        404: { description: "Unknown id or other-tenant request" },
        410: { description: "Expired" },
      },
    }),
    async (c) => {
      const id = c.req.param("id");
      if (id.length > 128) return notFound(c);
      const { record, expired } = await stores.requests.get(id);
      if (!record) return notFound(c);
      if (expired) return expired410(c);
      const deny = tenantDeny(c, record);
      if (deny) return deny;
      return c.json({ status: publicProjection(record).status });
    },
  );
}
