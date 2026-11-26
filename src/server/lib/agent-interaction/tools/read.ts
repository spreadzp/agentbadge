/**
 * EPIC-233 (SLICE-233-2, D-233-2/4): live READ tool handlers —
 * thin adapters over the shipped request-inbox/discovery code paths.
 * No business logic here: the domain functions they call are the same
 * ones the REST routes call (searchPublicQa, requestPoll,
 * buildAgentInteractionManifest) — contracts are inherited, never
 * copied. Store access is lazy per call: pickRequestInboxStores is
 * process-singleton in memory mode and a thin repo wrapper in db mode.
 */

import { getDatabase } from "../../database";
import { pickRequestInboxStores } from "../../request-inbox/db-stores";
import { requestPoll } from "../../request-inbox/poll";
import { searchPublicQa } from "../../request-inbox/qa";
import { buildAgentInteractionManifest } from "../manifest";
import type { AgentToolContext, AgentToolResult } from "../registry";

/** Same poll hint as the REST route (agent-requests-poll-api.ts). */
const POLL_AFTER_SECONDS = 5;

/** discover → aggregate of the discovery artifacts that already exist
 *  (the generated manifest + agent-card refs) — no new information. */
export async function handleDiscover(): Promise<AgentToolResult> {
  const m = buildAgentInteractionManifest();
  return {
    ok: true,
    data: {
      service: m.name,
      summary:
        "AgentBadge agent-interaction protocol — keyless JSON-RPC tools " +
        "over the request inbox, QA corpus, knowledge base and " +
        "feedback/review intake.",
      mcp_endpoint: m.mcp_endpoint,
      transport: m.transport,
      manifest: m.manifest,
      auth: m.auth,
      rate_limits: m.rate_limits,
      capabilities: m.tools,
      requests: m.requests,
      webhooks: m.webhooks,
      start_here: {
        step_1: "agentbadge_discover — this call",
        step_2: "agentbadge_ask — public QA corpus answers",
        step_3: "agentbadge_create_task_request — submit async work",
        step_4: "agentbadge_get_request_status — poll by request_id",
      },
      discovery_refs: m.discovery_refs,
    },
  };
}

/** ask → GET /api/requests/qa?q= (252 QA corpus, D-252-Q7). */
export async function handleAsk(
  args: unknown,
): Promise<AgentToolResult> {
  const { question } = args as { question: string };
  const stores = pickRequestInboxStores(getDatabase());
  const results = await searchPublicQa(stores.requests, question, 25);
  return { ok: true, data: { results, count: results.length } };
}

/** get_request_status → GET /api/requests/:id (D-233-4 passthrough).
 *  HTTP semantics map to structured fields: 202→poll_after_seconds,
 *  200→response, 410→expired, 404→not_found. id = capability — the
 *  tool takes only a request id, no enumeration surface exists. */
export async function handleGetRequestStatus(
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const { request_id } = args as { request_id: string };
  const stores = pickRequestInboxStores(getDatabase());
  const outcome = await requestPoll(
    stores.requests,
    request_id,
    ctx.actor.actorRef,
  );
  switch (outcome.kind) {
    case "not_found":
      return {
        ok: true,
        data: {
          state: "not_found",
          http_status: 404,
          retryable: false,
          message: "no such request",
        },
      };
    case "expired":
      return {
        ok: true,
        data: {
          state: "expired",
          http_status: 410,
          retryable: false,
          message: "request expired — do not retry",
        },
      };
    case "pending":
      return {
        ok: true,
        data: {
          state: outcome.record.state,
          http_status: 202,
          poll_after_seconds: POLL_AFTER_SECONDS,
          created_at: outcome.record.createdAtMs,
          expires_at: outcome.record.expiresAtMs,
        },
      };
    case "terminal":
      return {
        ok: true,
        data: {
          state: outcome.record.state,
          http_status: 200,
          response: outcome.record.response,
          poll_after_seconds: null,
          created_at: outcome.record.createdAtMs,
          expires_at: outcome.record.expiresAtMs,
        },
      };
  }
}
