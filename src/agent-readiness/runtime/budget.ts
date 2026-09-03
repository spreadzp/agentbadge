/**
 * SLICE-98-2: Budget enforcement primitive
 *
 * BudgetGuard enforces per-task + per-run budgets:
 * maxRequests, maxSteps, timeoutMs.
 * Throws/exhausts deterministically; usable by the executor later.
 */

export interface BudgetConfig {
  max_requests: number;
  max_steps: number;
  timeout_ms: number;
}

export class BudgetGuard {
  private requestsUsed = 0;
  private stepsUsed = 0;
  private readonly startTime: number;

  constructor(private readonly config: BudgetConfig) {
    this.startTime = Date.now();
  }

  canRequest(): boolean {
    return this.requestsUsed < this.config.max_requests && !this.isTimedOut();
  }

  canStep(): boolean {
    return this.stepsUsed < this.config.max_steps && !this.isTimedOut();
  }

  recordRequest(): void {
    this.checkRequest();
    this.requestsUsed++;
  }

  recordStep(): void {
    this.checkStep();
    this.stepsUsed++;
  }

  checkRequest(): void {
    if (this.requestsUsed >= this.config.max_requests) {
      throw new Error(
        `Budget exhausted: max_requests (${this.config.max_requests}) exceeded`,
      );
    }
    if (this.isTimedOut()) {
      throw new Error(
        `Budget exhausted: timeout (${this.config.timeout_ms}ms) exceeded`,
      );
    }
  }

  checkStep(): void {
    if (this.stepsUsed >= this.config.max_steps) {
      throw new Error(
        `Budget exhausted: max_steps (${this.config.max_steps}) exceeded`,
      );
    }
    if (this.isTimedOut()) {
      throw new Error(
        `Budget exhausted: timeout (${this.config.timeout_ms}ms) exceeded`,
      );
    }
  }

  remainingRequests(): number {
    return Math.max(0, this.config.max_requests - this.requestsUsed);
  }

  remainingSteps(): number {
    return Math.max(0, this.config.max_steps - this.stepsUsed);
  }

  isExhausted(): boolean {
    return (
      this.requestsUsed >= this.config.max_requests &&
      this.stepsUsed >= this.config.max_steps
    );
  }

  isTimedOut(): boolean {
    return Date.now() - this.startTime >= this.config.timeout_ms;
  }
}
