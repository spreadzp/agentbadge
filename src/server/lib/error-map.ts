/**
 * SLICE-83-4: Error mapper — translates internal errors to sanitized public responses.
 *
 * Never leaks: account IDs (0.0.X), hex strings (0x...), URLs, SDK traces.
 */

import { ErrorCodes, type ErrorCode } from "./error-codes";

export interface PublicError {
  code: ErrorCode;
  safeMessage: string;
}

const SAFE_MESSAGES: Record<string, string> = {
  [ErrorCodes.HCS_SUBMISSION_FAILED]: "Message submission failed. Please retry.",
  [ErrorCodes.MIRROR_NODE_UNAVAILABLE]: "Network query failed. Please retry.",
  [ErrorCodes.VERIFICATION_FAILED]: "Verification failed. Check your inputs.",
  [ErrorCodes.INVALID_INPUT]: "Invalid input provided.",
  [ErrorCodes.RATE_LIMITED]: "Too many requests. Please slow down.",
  [ErrorCodes.INTERNAL_ERROR]: "Internal error occurred. Please retry with request ID if available.",
};

const ERROR_PATTERNS: Array<{ pattern: RegExp; code: ErrorCode }> = [
  { pattern: /hcs|topic.*submit|consensus/i, code: ErrorCodes.HCS_SUBMISSION_FAILED },
  { pattern: /mirror.*node|mirror.*query/i, code: ErrorCodes.MIRROR_NODE_UNAVAILABLE },
  { pattern: /signature.*verif|verif.*signature|signer/i, code: ErrorCodes.VERIFICATION_FAILED },
  { pattern: /invalid.*input|invalid.*format|invalid.*value|wrong.*format/i, code: ErrorCodes.INVALID_INPUT },
  { pattern: /rate.*limit|too many request|throttl/i, code: ErrorCodes.RATE_LIMITED },
];

export function toPublicError(err: unknown): PublicError {
  const message = err instanceof Error ? err.message : String(err ?? "");

  for (const { pattern, code } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { code, safeMessage: SAFE_MESSAGES[code] };
    }
  }

  return {
    code: ErrorCodes.INTERNAL_ERROR,
    safeMessage: SAFE_MESSAGES[ErrorCodes.INTERNAL_ERROR],
  };
}
