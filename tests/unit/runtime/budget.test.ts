import { describe, it, expect } from "vitest";
import { BudgetGuard } from "../../../src/agent-readiness/runtime/budget";

describe("SLICE-98-2: BudgetGuard", () => {
  it("allows requests within budget", () => {
    const guard = new BudgetGuard({ max_requests: 3, max_steps: 5, timeout_ms: 10000 });
    expect(guard.canRequest()).toBe(true);
    guard.recordRequest();
    expect(guard.canRequest()).toBe(true);
    guard.recordRequest();
    expect(guard.canRequest()).toBe(true);
    guard.recordRequest();
    expect(guard.canRequest()).toBe(false);
  });

  it("allows steps within budget", () => {
    const guard = new BudgetGuard({ max_requests: 10, max_steps: 2, timeout_ms: 10000 });
    expect(guard.canStep()).toBe(true);
    guard.recordStep();
    expect(guard.canStep()).toBe(true);
    guard.recordStep();
    expect(guard.canStep()).toBe(false);
  });

  it("throws on request over budget", () => {
    const guard = new BudgetGuard({ max_requests: 1, max_steps: 5, timeout_ms: 10000 });
    guard.recordRequest();
    expect(() => guard.checkRequest()).toThrow(/budget.*exhaust|max_requests/i);
  });

  it("throws on step over budget", () => {
    const guard = new BudgetGuard({ max_requests: 5, max_steps: 1, timeout_ms: 10000 });
    guard.recordStep();
    expect(() => guard.checkStep()).toThrow(/budget.*exhaust|max_steps/i);
  });

  it("reports remaining requests and steps", () => {
    const guard = new BudgetGuard({ max_requests: 5, max_steps: 10, timeout_ms: 10000 });
    guard.recordRequest();
    guard.recordStep();
    guard.recordStep();
    expect(guard.remainingRequests()).toBe(4);
    expect(guard.remainingSteps()).toBe(8);
  });

  it("isExhausted returns true when both requests and steps are depleted", () => {
    const guard = new BudgetGuard({ max_requests: 1, max_steps: 1, timeout_ms: 10000 });
    expect(guard.isExhausted()).toBe(false);
    guard.recordRequest();
    guard.recordStep();
    expect(guard.isExhausted()).toBe(true);
  });

  it("timeout check: expired timeout returns true", () => {
    const guard = new BudgetGuard({ max_requests: 10, max_steps: 10, timeout_ms: 50 });
    expect(guard.isTimedOut()).toBe(false);
    // Use fake timer approach — just check after a delay
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(guard.isTimedOut()).toBe(true);
        resolve();
      }, 60);
    });
  });
});
