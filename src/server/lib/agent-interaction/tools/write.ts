/**
 * EPIC-233 (SLICE-233-3, D-233-2/5/6): write tool handlers — thin
 * adapters over the SAME request-inbox submit pipeline the REST
 * POST /api/requests uses (lib/request-inbox/submit.ts). The adapter
 * only maps args → pipeline input and outcome → toolResult; policy
 * (caps, fast-path, idempotency, submit lanes, spam probe) is
 * inherited, never copied.
 */

import { getConfig } from "../../../../config/env";
import { resolveClientIp } from "../../../middleware/rate-limit";
import { buildFingerprint } from "../../request-inbox/fingerprint";
import {
  headerSnapshot,
  normalizeIntakePayload,
} from "../../request-inbox/intake";
import { qaFastPathBody } from "../../request-inbox/qa";
import { validateCallbackUrl } from "../../request-inbox/callback-url";
import { getSharedRequestSubmitter } from "../../request-inbox/submit";
import type { AgentToolContext, AgentToolResult } from "../registry";

/** Same poll hint as the REST route (agent-requests-poll-api.ts). */
const POLL_AFTER_SECONDS = 5;

const fail = (
  code: string,
  message: string,
  data?: unknown,
): AgentToolResult => ({ ok: false, error: { code, message, data } });

/** agentbadge_create_task_request ≡ POST /api/requests. */
export async function handleCreateTaskRequest(
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const input = args as {
    payload: unknown;
    kind?: string;
    publish_to_qa?: boolean;
    idempotency_key?: string;
    callback_url?: string;
  };

  // Same payload normalization/caps the REST parse path runs
  // (string → {question}, ≤256KB, jsonb-safe).
  const norm = normalizeIntakePayload(input.payload);
  if (!norm.ok) {
    return fail(
      norm.error === "too_large" ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
      norm.error === "too_large" ? "payload over 256KB" : "payload unsafe",
    );
  }

  // D-233-5: https + SSRF guard (incl. DNS) before persist — the same
  // validator the REST route runs.
  let callbackUrl: string | null = null;
  if (input.callback_url != null) {
    const check = await validateCallbackUrl(input.callback_url);
    if (!check.ok) {
      return fail(
        "INVALID_INPUT",
        `callback_url rejected: ${check.reason}`,
        { reason: check.reason },
      );
    }
    callbackUrl = check.url;
  }

  const env = getConfig().requestInbox;
  const c = ctx.c;
  const { fpHash, softFpHash, ipFpHash, fingerprint } = buildFingerprint({
    ip: resolveClientIp(c),
    ua: c.req.header("user-agent") ?? null,
    referer: c.req.header("referer") ?? null,
    src: c.req.query("src") ?? null,
    headers: headerSnapshot(c),
    salt: env.fingerprintSalt,
  });
  // D-233-6: keyed callers (Bearer agb_) carry the verified agentId
  // into the row; anonymous submits ride the fingerprint lanes.
  const agentId = ctx.actor.agentId ?? null;

  const outcome = await getSharedRequestSubmitter()({
    kind: input.kind ?? null,
    payload: norm.payload,
    publishToQa: input.publish_to_qa ?? false,
    agentId,
    fpHash,
    softFpHash,
    ipFpHash,
    fingerprint,
    idempotencyKey: input.idempotency_key ?? null,
    callbackUrl,
    channel: "mcp-agent-interaction",
  });

  switch (outcome.kind) {
    case "fast_path":
      // Same body shape the REST fast-path returns (D-256-Q15
      // provenance fields included).
      return { ok: true, data: qaFastPathBody(outcome.pair) };
    case "payload_mismatch":
      return fail(
        "INVALID_INPUT",
        "idempotency_key reused with a different payload",
        { retryable: false, http_status: 422 },
      );
    case "limited":
      return fail("RATE_LIMITED", "submit rate-limit exceeded", {
        retryable: true,
        retry_after_seconds: outcome.retryAfterSec,
        http_status: 429,
      });
    case "store_error":
      return fail("INTERNAL", "submit failed, retry later", {
        retryable: true,
        http_status: 503,
      });
    case "duplicate":
    case "submitted": {
      const rec = outcome.record;
      return {
        ok: true,
        data: {
          request_id: rec.id,
          state: rec.state,
          poll_url: `/api/requests/${rec.id}`,
          poll_after_seconds: POLL_AFTER_SECONDS,
          duplicate: outcome.kind === "duplicate",
          expires_in_seconds: Math.round(env.requestTtlMs / 1000),
        },
      };
    }
  }
}
