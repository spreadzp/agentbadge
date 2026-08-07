/**
 * Work Request API routes.
 *
 * SLICE-46-9: POST + GET with validation, rate limiting, and security.
 *
 * POST   /api/work-requests      — submit a work request (202)
 * GET    /api/work-requests/:id  — get work request status (200)
 */

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { ErrorCodes } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";
import { workRequestStore } from "../../services/work-request-store";

export const workRequestRoutes = new Hono();

// ─── Rate limiting (in-memory, per IP) ───────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

const postBuckets = new Map<string, RateBucket>();
const POST_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const POST_MAX = 5;

const getBuckets = new Map<string, RateBucket>();
const GET_WINDOW_MS = 60 * 1000; // 1 min
const GET_MAX = 100;

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

function checkRateLimit(
  buckets: Map<string, RateBucket>,
  ip: string,
  max: number,
  windowMs: number,
): { allowed: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  let entry = buckets.get(ip);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(ip, entry);
  }

  entry.count++;
  const remaining = Math.max(0, max - entry.count);
  const retryAfter = Math.ceil((entry.resetAt - now) / 1000);

  return { allowed: entry.count <= max, remaining, retryAfter };
}

export function resetRateLimits(): void {
  postBuckets.clear();
  getBuckets.clear();
}

// ─── Validation ───────────────────────────────────────────

const SECRET_PATTERNS = [
  /\bAPI_KEY\b/i,
  /\bPRIVATE_KEY\b/i,
  /\bPASSWORD\b/i,
  /\bSECRET\b/i,
  /\bTOKEN\b/i,
];

const HTML_JS_PATTERNS = [
  /<script\b/i,
  /<iframe\b/i,
  /javascript:/i,
  /on\w+\s*=/i,
  /<embed\b/i,
  /<object\b/i,
];

const MAX_TITLE = 200;
const MAX_SUMMARY = 5000;
const MAX_REQUIREMENTS = 20;

interface ValidationError {
  code: string;
  message: string;
}

function validateWorkRequest(body: unknown): ValidationError | null {
  if (!body || typeof body !== "object") {
    return { code: ErrorCodes.INVALID_JSON, message: "Invalid JSON body" };
  }

  const { request } = body as Record<string, unknown>;
  if (!request || typeof request !== "object") {
    return { code: ErrorCodes.MISSING_FIELDS, message: "Missing 'request' field" };
  }

  const { title, summary, requirements } = request as Record<string, unknown>;

  if (!title || typeof title !== "string") {
    return { code: ErrorCodes.MISSING_FIELDS, message: "Missing or invalid 'title'" };
  }
  if (title.length > MAX_TITLE) {
    return { code: ErrorCodes.INVALID_INPUT, message: `Title exceeds ${MAX_TITLE} chars` };
  }

  if (!summary || typeof summary !== "string") {
    return { code: ErrorCodes.MISSING_FIELDS, message: "Missing or invalid 'summary'" };
  }
  if (summary.length > MAX_SUMMARY) {
    return { code: ErrorCodes.INVALID_INPUT, message: `Summary exceeds ${MAX_SUMMARY} chars` };
  }

  if (requirements !== undefined) {
    if (!Array.isArray(requirements)) {
      return { code: ErrorCodes.INVALID_INPUT, message: "'requirements' must be an array" };
    }
    if (requirements.length > MAX_REQUIREMENTS) {
      return { code: ErrorCodes.INVALID_INPUT, message: `Requirements exceed ${MAX_REQUIREMENTS} items` };
    }
  }

  // Secrets rejection
  const allText = `${title} ${summary} ${(requirements ?? []).join(" ")}`;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(allText)) {
      return { code: ErrorCodes.SECRET_REJECTED, message: "Request contains forbidden secret pattern" };
    }
  }

  // HTML/JS sanitization
  for (const pattern of HTML_JS_PATTERNS) {
    if (pattern.test(allText)) {
      return { code: ErrorCodes.INVALID_INPUT, message: "Request contains forbidden HTML/JS content" };
    }
  }

  return null;
}

// ─── POST /api/work-requests ──────────────────────────────

workRequestRoutes.post(
  "/api/work-requests",
  describeRoute({
    tags: ["Work Requests"],
    summary: "Submit a work request",
    description: "Submit a work request to connect with the human team. Returns 202 with request_id.",
    responses: {
      202: { description: "Request accepted" },
      400: { description: "Validation error" },
      429: { description: "Rate limit exceeded" },
    },
  }),
  async (c) => {
    const ip = getClientIp(c);
    const rl = checkRateLimit(postBuckets, ip, POST_MAX, POST_WINDOW_MS);

    c.header("X-RateLimit-Limit", String(POST_MAX));
    c.header("X-RateLimit-Remaining", String(rl.remaining));

    if (!rl.allowed) {
      c.header("Retry-After", String(Math.max(1, rl.retryAfter)));
      return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Too Many Requests");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const error = validateWorkRequest(body);
    if (error) {
      return errorResponse(c, 400, error.code as any, error.message);
    }

    const { request, preferred_contact } = body as {
      request: { title: string; summary: string; requirements?: string[] };
      preferred_contact?: { channel: string };
    };

    const record = workRequestStore.create(
      { title: request.title, summary: request.summary, requirements: request.requirements },
      preferred_contact,
    );

    return c.json(
      {
        request_id: record.id,
        status_url: `/api/work-requests/${record.id}`,
      },
      202,
    );
  },
);

// ─── GET /api/work-requests/:id ───────────────────────────

workRequestRoutes.get(
  "/api/work-requests/:id",
  describeRoute({
    tags: ["Work Requests"],
    summary: "Get work request status",
    description: "Retrieve the current status and details of a work request.",
    responses: {
      200: { description: "Request details" },
      404: { description: "Request not found" },
      429: { description: "Rate limit exceeded" },
    },
  }),
  async (c) => {
    const ip = getClientIp(c);
    const rl = checkRateLimit(getBuckets, ip, GET_MAX, GET_WINDOW_MS);

    c.header("X-RateLimit-Limit", String(GET_MAX));
    c.header("X-RateLimit-Remaining", String(rl.remaining));

    if (!rl.allowed) {
      c.header("Retry-After", String(Math.max(1, rl.retryAfter)));
      return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Too Many Requests");
    }

    const id = c.req.param("id");
    const record = workRequestStore.get(id);

    if (!record) {
      return errorResponse(c, 404, ErrorCodes.WORK_REQUEST_NOT_FOUND, "Work request not found");
    }

    return c.json(record, 200);
  },
);
