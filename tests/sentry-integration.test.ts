import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerError = vi.fn();

vi.mock("@agentbadge/passport/logger", () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args), info: vi.fn(), warn: vi.fn() },
}));

import { captureError } from "../src/server/lib/sentry";

describe("captureError — error capture hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs an Error with the provided context", () => {
    const err = new Error("Test error");
    const context = { route: "/passport", agentId: "0.0.123" };

    captureError(err, context);

    expect(loggerError).toHaveBeenCalledOnce();
    expect(loggerError).toHaveBeenCalledWith("Captured error", { error: err, ...context });
  });

  it("logs a non-Error value without throwing", () => {
    expect(() => captureError("plain string")).not.toThrow();
    expect(loggerError).toHaveBeenCalledWith("Captured error", { error: "plain string" });
  });
});
