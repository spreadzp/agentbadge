import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
}));

import * as Sentry from "@sentry/node";
import { initSentry, captureError, isSentryEnabled } from "../src/server/lib/sentry";

const sentryInit = vi.mocked(Sentry.init);
const sentryCapture = vi.mocked(Sentry.captureException);

describe("Sentry integration — SLICE-7-6", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
    // Reset module-level state by re-importing
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.SENTRY_DSN;
    vi.clearAllMocks();
  });

  it("initSentry returns true when SENTRY_DSN is set", async () => {
    process.env.SENTRY_DSN = "https://abc@example.com/123";
    const { initSentry: freshInit, isSentryEnabled: freshCheck } =
      await import("../src/server/lib/sentry");

    const result = freshInit();
    expect(result).toBe(true);
    expect(sentryInit).toHaveBeenCalledOnce();
  });

  it("initSentry returns false when SENTRY_DSN is not set", async () => {
    const { initSentry: freshInit } = await import("../src/server/lib/sentry");

    const result = freshInit();
    expect(result).toBe(false);
    expect(sentryInit).not.toHaveBeenCalled();
  });

  it("isSentryEnabled returns false before initSentry is called", async () => {
    const { isSentryEnabled: freshCheck } = await import("../src/server/lib/sentry");
    expect(freshCheck()).toBe(false);
  });

  it("isSentryEnabled returns true after successful init", async () => {
    process.env.SENTRY_DSN = "https://abc@example.com/123";
    const { initSentry: freshInit, isSentryEnabled: freshCheck } =
      await import("../src/server/lib/sentry");

    freshInit();
    expect(freshCheck()).toBe(true);
  });

  it("captureError calls Sentry.captureException when enabled", async () => {
    process.env.SENTRY_DSN = "https://abc@example.com/123";
    const { initSentry: freshInit, captureError: freshCapture } =
      await import("../src/server/lib/sentry");

    freshInit();
    const err = new Error("Test error");
    freshCapture(err);

    expect(sentryCapture).toHaveBeenCalledOnce();
    expect(sentryCapture).toHaveBeenCalledWith(err, undefined);
  });

  it("captureError does not call Sentry.captureException when disabled", async () => {
    const { captureError: freshCapture } = await import("../src/server/lib/sentry");

    const err = new Error("Test error");
    freshCapture(err);

    expect(sentryCapture).not.toHaveBeenCalled();
  });

  it("captureError passes context as second argument", async () => {
    process.env.SENTRY_DSN = "https://abc@example.com/123";
    const { initSentry: freshInit, captureError: freshCapture } =
      await import("../src/server/lib/sentry");

    freshInit();
    const err = new Error("Test error");
    const context = { tags: { route: "/passport" }, extra: { agentId: "0.0.123" } };
    freshCapture(err, context);

    expect(sentryCapture).toHaveBeenCalledWith(err, context);
  });

  it("initSentry passes correct options to Sentry.init", async () => {
    process.env.SENTRY_DSN = "https://abc@example.com/123";
    process.env.HEDERA_NETWORK = "testnet";
    const { initSentry: freshInit } = await import("../src/server/lib/sentry");

    freshInit();

    expect(sentryInit).toHaveBeenCalledOnce();
    const options = sentryInit.mock.calls[0]![0]!;
    expect(options.dsn).toBe("https://abc@example.com/123");
    expect(options.environment).toBe("testnet");
    expect(options.tracesSampleRate).toBeDefined();
  });
});
