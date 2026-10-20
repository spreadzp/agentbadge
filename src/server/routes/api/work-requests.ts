/**
 * Work Request API routes.
 *
 * SLICE-46-9: POST + GET with validation, rate limiting, and security.
 *
 * POST   /api/work-requests      — submit a work request (202)
 * GET    /api/work-requests/:id  — get work request status (200)
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ErrorCodes, type ErrorCode } from "../../lib/error-codes";
import { errorResponse } from "../../lib/error-response";
import { workRequestStore } from "../../services/work-request-store";
import { notifyWorkRequest } from "../../services/work-request-notification";
import {
  createRateLimiter,
  type RateLimitStore,
  type RateLimitEntry,
} from "../../middleware/rate-limit";
import { logger } from "@agentbadge/passport/logger";

export const workRequestRoutes = new Hono();

// ─── Rate limiting (unified, SLICE-86-3) ─────────────────

/** In-memory store kept as a handle so resetRateLimits() can clear it (tests). */
function mapStore(): RateLimitStore {
  const map = new Map<string, RateLimitEntry>();
  return {
    get: (key) => map.get(key),
    set: (key, entry) => void map.set(key, entry),
    delete: (key) => void map.delete(key),
    sweep: (now) => {
      for (const [key, entry] of map) {
        if (entry.resetAt <= now) map.delete(key);
      }
    },
    size: () => map.size,
  };
}

const postStore = mapStore();
const getStore = mapStore();

const postLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  routes: ["/api/work-requests"],
  store: postStore,
});

const getLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 min
  max: 100,
  routes: ["/api/work-requests/:id"],
  store: getStore,
});

/** Test hook: drop every bucket — sweep with a far-future now clears all entries. */
export function resetRateLimits(): void {
  postStore.sweep(Number.MAX_SAFE_INTEGER);
  getStore.sweep(Number.MAX_SAFE_INTEGER);
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
    const rlResult = await postLimiter(c, async () => { });
    if (rlResult instanceof Response) {
      return rlResult;
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body");
    }

    const error = validateWorkRequest(body);
    if (error) {
      return errorResponse(c, 400, error.code as ErrorCode, error.message);
    }

    const { request, preferred_contact } = body as {
      request: { title: string; summary: string; requirements?: string[] };
      preferred_contact?: { channel: string };
    };

    const record = workRequestStore.create(
      { title: request.title, summary: request.summary, requirements: request.requirements },
      preferred_contact,
    );

    // Async notification — fire and forget, errors logged but don't block
    notifyWorkRequest(record).catch((err) => {
      logger.warn("work-request: notification failed", { error: err });
    });

    return c.json(
      {
        request_id: record.id,
        status_url: `/api/work-requests/${record.id}`,
      },
      202,
    );
  },
);

// ─── GET /api/work-requests ───────────────────────────────
// SLICE-200-01 F1: list endpoint for list_work_requests MCP tool.
// Public projection strips preferred_contact and summary (user-submitted PII).

const listLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 min
  max: 60,
  routes: ["/api/work-requests"],
});

const MAX_LIST_LIMIT = 100;

workRequestRoutes.get(
  "/api/work-requests",
  describeRoute({
    tags: ["Work Requests"],
    summary: "List work requests",
    description: "Paginated list of submitted work requests (public projection — no contact details).",
    responses: {
      200: { description: "Paginated list" },
      429: { description: "Rate limit exceeded" },
    },
  }),
  async (c) => {
    const rlResult = await listLimiter(c, async () => { });
    if (rlResult instanceof Response) {
      return rlResult;
    }

    const rawLimit = Number(c.req.query("limit")) || 20;
    const rawOffset = Number(c.req.query("offset")) || 0;
    const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIST_LIMIT);
    const offset = Math.max(Math.trunc(rawOffset), 0);

    const { items, total } = workRequestStore.list(limit, offset);

    return c.json(
      {
        requests: items.map((r) => ({
          id: r.id,
          status: r.status,
          title: r.request.title,
          created_at: r.created_at,
          updated_at: r.updated_at,
        })),
        total,
        limit,
        offset,
      },
      200,
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
    const rlResult = await getLimiter(c, async () => { });
    if (rlResult instanceof Response) {
      return rlResult;
    }

    const id = c.req.param("id");
    const record = workRequestStore.get(id);

    if (!record) {
      return errorResponse(c, 404, ErrorCodes.WORK_REQUEST_NOT_FOUND, "Work request not found");
    }

    return c.json(record, 200);
  },
);
