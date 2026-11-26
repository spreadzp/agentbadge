/**
 * EPIC-233 (SLICE-233-5, D-233-1/2): feedback/review write tools —
 * thin adapters over the SAME 230 services as
 * POST /api/v1/agent/feedback and POST /api/v1/agent/reviews.
 * Rate limits ride the shared REST buckets (feedback-review/
 * rate-limits.ts); dedupe scopes are NOT overridden, so an
 * idempotency_key replays across transports identically.
 *
 * Field mapping (tool args → REST body):
 *   submit_feedback / report_problem: {subject,message} → text
 *     (subject line + blank line + body, D-230-4 text contract).
 *   report_problem: kind=BUG pinned; severity low|medium|high
 *     → LOW|MEDIUM|HIGH (agent hint, §16.2).
 *   request_review: evidence rows pass through verbatim — the tool
 *     inputSchema IS reviewEvidenceSchema (registry).
 */

import { getDatabase } from "../../database";
import { pickDemandStore } from "../../demand/db-stores";
import { pickFeedbackStore } from "../../feedback/db-stores";
import { submitFeedback } from "../../feedback/service";
import { pickReviewStore } from "../../reviews/db-stores";
import { submitReview } from "../../reviews/service";
import {
  limiterKey,
  type TieredLimiter,
} from "../../../routes/agent-interaction/rate-limits";
import {
  getSharedFeedbackLimiter,
  getSharedReviewsLimiter,
} from "../../../routes/feedback-review/rate-limits";
import type {
  AgentToolContext,
  AgentToolResult,
} from "../registry";

const fail = (
  code: string,
  message: string,
  data?: unknown,
): AgentToolResult => ({ ok: false, error: { code, message, data } });

/** Same 429 posture as the REST tier check (agent-feedback-api.ts). */
const limited = (limiter: TieredLimiter): AgentToolResult =>
  fail("RATE_LIMITED", "rate limit exceeded — retry in a minute", {
    retryable: true,
    retry_after_seconds: limiter.retryAfterSec(),
    http_status: 429,
  });

/** Maps the shared service error vocabulary to REST-parity codes. */
const serviceFail = (
  error: string,
  field?: string,
): AgentToolResult => {
  if (error === "actor_mismatch") {
    return fail(
      "IDEMPOTENCY_ACTOR_MISMATCH",
      "idempotency-key already used by a different actor",
      { retryable: false, http_status: 409 },
    );
  }
  if (error === "payload_mismatch") {
    return fail(
      "INVALID_INPUT",
      "idempotency-key reused with a different payload",
      { retryable: false, http_status: 422 },
    );
  }
  return fail("INVALID_INPUT", error, {
    retryable: false,
    http_status: 400,
    ...(field ? { field } : {}),
  });
};

const accepted = (id: string, statusUrl: string, duplicate: boolean) => ({
  ok: true as const,
  data: { id, status_url: statusUrl, duplicate },
});

type FeedbackSeverity = "low" | "medium" | "high";
const SEVERITY_MAP: Record<FeedbackSeverity, string> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

async function submitFeedbackText(
  text: string,
  kind: string,
  ctx: AgentToolContext,
  input: {
    target?: string;
    severity?: string;
    idempotency_key?: string;
  },
): Promise<AgentToolResult> {
  const limiter = getSharedFeedbackLimiter();
  if (!limiter.allow(ctx.actor.resolution, limiterKey(ctx.c, ctx.actor))) {
    return limited(limiter);
  }
  const res = await submitFeedback(
    pickFeedbackStore(getDatabase()),
    {
      text,
      kind,
      ...(input.target ? { target: input.target } : {}),
      ...(input.severity ? { severity: input.severity } : {}),
    },
    ctx.actor,
    {
      idempotencyKey: input.idempotency_key ?? null,
      // FEATURE demand signal — same soft-dep as the REST route.
      demand: pickDemandStore(getDatabase()),
    },
  );
  if (!res.ok) return serviceFail(res.error, res.field);
  return accepted(
    res.record.id,
    `/api/v1/agent/feedback/${res.record.id}`,
    res.duplicate,
  );
}

/** agentbadge_submit_feedback ≡ POST /api/v1/agent/feedback. */
export function handleSubmitFeedback(
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const input = args as {
    subject: string;
    message: string;
    target?: string;
    kind?: string;
    idempotency_key?: string;
  };
  return submitFeedbackText(
    `${input.subject}\n\n${input.message}`,
    input.kind ?? "OTHER",
    ctx,
    input,
  );
}

/** agentbadge_report_problem ≡ POST /api/v1/agent/feedback (kind=BUG). */
export function handleReportProblem(
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const input = args as {
    subject: string;
    message: string;
    severity?: FeedbackSeverity;
    target?: string;
    idempotency_key?: string;
  };
  return submitFeedbackText(
    `${input.subject}\n\n${input.message}`,
    "BUG",
    ctx,
    {
      ...input,
      ...(input.severity
        ? { severity: SEVERITY_MAP[input.severity] }
        : {}),
    },
  );
}

/** agentbadge_request_review ≡ POST /api/v1/agent/reviews. */
export async function handleRequestReview(
  args: unknown,
  ctx: AgentToolContext,
): Promise<AgentToolResult> {
  const input = args as {
    review_type: string;
    work_ref: string;
    agent_criteria?: string[];
    evidence?: unknown[];
    idempotency_key?: string;
  };

  const limiter = getSharedReviewsLimiter();
  if (!limiter.allow(ctx.actor.resolution, limiterKey(ctx.c, ctx.actor))) {
    return limited(limiter);
  }

  const res = await submitReview(
    pickReviewStore(getDatabase()),
    {
      reviewType: input.review_type,
      workRef: input.work_ref,
      ...(input.agent_criteria
        ? { agentCriteria: input.agent_criteria }
        : {}),
      ...(input.evidence ? { evidence: input.evidence } : {}),
    },
    ctx.actor,
    { idempotencyKey: input.idempotency_key ?? null },
  );
  if (!res.ok) return serviceFail(res.error, res.field);
  return accepted(
    res.record.id,
    `/api/v1/agent/reviews/${res.record.id}`,
    res.duplicate,
  );
}
