export const SsrfErrorCodes = {
  SSRF_BLOCKED: "SSRF_BLOCKED",
  SSRF_DNS_ALL_BLOCKED: "SSRF_DNS_ALL_BLOCKED",
  SSRF_DNS_RESOLVE_FAILED: "SSRF_DNS_RESOLVE_FAILED",
} as const;

export type SsrfErrorCode = (typeof SsrfErrorCodes)[keyof typeof SsrfErrorCodes];

export class SsrfBlockedError extends Error {
  readonly code: SsrfErrorCode;
  readonly details: { ip: string; range?: string };

  constructor(ip: string, range?: string, code: SsrfErrorCode = SsrfErrorCodes.SSRF_BLOCKED) {
    super(`SSRF blocked: ${ip}${range ? ` (range: ${range})` : ""}`);
    this.name = "SsrfBlockedError";
    this.code = code;
    this.details = { ip, range };
  }
}
