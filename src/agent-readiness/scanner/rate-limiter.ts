export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export interface RateCheckResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class ScannerRateLimiter {
  private buckets = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(opts: RateLimiterOptions = { maxRequests: 20, windowMs: 60_000 }) {
    this.maxRequests = opts.maxRequests;
    this.windowMs = opts.windowMs;
  }

  checkDomain(domain: string): RateCheckResult {
    const now = Date.now();
    const timestamps = this.getValidTimestamps(domain, now);

    if (timestamps.length < this.maxRequests) {
      return { allowed: true, retryAfterMs: 0 };
    }

    const oldest = timestamps[0];
    const retryAfterMs = oldest + this.windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  recordRequest(domain: string): void {
    const now = Date.now();
    const timestamps = this.getValidTimestamps(domain, now);
    timestamps.push(now);
    this.buckets.set(domain, timestamps);
  }

  reset(domain?: string): void {
    if (domain) {
      this.buckets.delete(domain);
    } else {
      this.buckets.clear();
    }
  }

  private getValidTimestamps(domain: string, now: number): number[] {
    const cutoff = now - this.windowMs;
    const existing = this.buckets.get(domain) ?? [];
    const valid = existing.filter((ts) => ts > cutoff);
    if (valid.length !== existing.length) {
      if (valid.length === 0) {
        this.buckets.delete(domain);
      } else {
        this.buckets.set(domain, valid);
      }
    }
    return valid;
  }
}
