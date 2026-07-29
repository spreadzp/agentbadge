import type { Context } from "hono";
import type { ErrorCode } from "./error-codes";

interface ErrorBody {
  error: string;
  code: ErrorCode;
  retryable?: boolean;
  hint?: string;
}

export function errorResponse(
  c: Context,
  status: 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500,
  code: ErrorCode,
  error: string,
  opts?: { retryable?: boolean; hint?: string },
): Response {
  const body: ErrorBody = { error, code };
  if (opts?.retryable !== undefined) body.retryable = opts.retryable;
  if (opts?.hint) body.hint = opts.hint;
  return c.json(body, status);
}
