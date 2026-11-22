/**
 * EPIC-230 (SLICE-230-4): shared route helpers — the identical-oracle
 * tenant rule from agent-interaction-gets.ts, generalized over the
 * actor fields both 230 record types carry.
 *
 * API_KEY-owned rows require the owning key on GET (agentKeyAuth is
 * global and resolves on GET) — an anonymous caller who learns the
 * id cannot read them. DID/ANON rows stay capability-URL readable:
 * the DID scheme only authenticates mutations, so the unguessable
 * fb_-/rv_-prefixed id is the only read mechanism those callers have.
 */

import type { Context } from "hono";

import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { resolveActor } from "../../lib/agent-interaction/actor";

export const notFound = (c: Context) =>
  errorResponse(c, 404, ErrorCodes.REQUEST_NOT_FOUND, "no such record");

export function tenantDeny(
  c: Context,
  record: { actorResolution: string; actorRef: string | null },
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
