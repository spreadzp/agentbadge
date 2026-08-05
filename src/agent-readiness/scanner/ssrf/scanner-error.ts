import { SsrfBlockedError, SsrfErrorCodes } from "./ssrf-error";

export const ScannerErrorCodes = {
  ...SsrfErrorCodes,
  SSRF_REDIRECT_BLOCKED: "SSRF_REDIRECT_BLOCKED",
  REDIRECT_LIMIT_EXCEEDED: "REDIRECT_LIMIT_EXCEEDED",
  REDIRECT_LOOP: "REDIRECT_LOOP",
  TIMEOUT: "TIMEOUT",
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",
  CONTENT_TYPE_MISMATCH: "CONTENT_TYPE_MISMATCH",
  FETCH_FAILED: "FETCH_FAILED",
} as const;

export type ScannerErrorCode = (typeof ScannerErrorCodes)[keyof typeof ScannerErrorCodes];

export class ScannerError extends Error {
  readonly code: ScannerErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ScannerErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ScannerError";
    this.code = code;
    this.details = details ?? {};
  }
}

export class SsrfRedirectError extends ScannerError {
  constructor(redirectUrl: string, ip: string, range?: string) {
    super(
      ScannerErrorCodes.SSRF_REDIRECT_BLOCKED,
      `Redirect to blocked IP: ${redirectUrl} (${ip}${range ? `, ${range}` : ""})`,
      { redirectUrl, ip, range },
    );
    this.name = "SsrfRedirectError";
  }
}

export class RedirectLimitError extends ScannerError {
  constructor(maxRedirects: number, chain: string[]) {
    super(
      ScannerErrorCodes.REDIRECT_LIMIT_EXCEEDED,
      `Exceeded max redirects (${maxRedirects})`,
      { maxRedirects, chain },
    );
    this.name = "RedirectLimitError";
  }
}

export class RedirectLoopError extends ScannerError {
  constructor(chain: string[]) {
    super(
      ScannerErrorCodes.REDIRECT_LOOP,
      `Redirect loop detected`,
      { chain },
    );
    this.name = "RedirectLoopError";
  }
}

export class TimeoutError extends ScannerError {
  constructor(url: string, phase: "connect" | "total") {
    super(
      ScannerErrorCodes.TIMEOUT,
      `Request timed out (${phase}): ${url}`,
      { url, phase },
    );
    this.name = "TimeoutError";
  }
}

export class ResponseTooLargeError extends ScannerError {
  constructor(url: string, maxSize: number, actualSize: number) {
    super(
      ScannerErrorCodes.RESPONSE_TOO_LARGE,
      `Response exceeds max size (${actualSize} > ${maxSize} bytes): ${url}`,
      { url, maxSize, actualSize },
    );
    this.name = "ResponseTooLargeError";
  }
}

export class ContentTypeMismatchError extends ScannerError {
  constructor(url: string, expected: string[], actual: string) {
    super(
      ScannerErrorCodes.CONTENT_TYPE_MISMATCH,
      `Content-Type mismatch: expected one of [${expected.join(", ")}], got "${actual}"`,
      { url, expected, actual },
    );
    this.name = "ContentTypeMismatchError";
  }
}

export { SsrfBlockedError };
