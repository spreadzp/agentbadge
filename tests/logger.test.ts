import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, setLogLevel, type LogLevel } from "@agentbadge/passport";

describe("logger — SLICE-7-4", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    setLogLevel("info");
  });

  it("logger.info outputs structured JSON with timestamp, level, message", () => {
    logger.info("Server started");

    expect(logSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("info");
    expect(output.message).toBe("Server started");
    expect(output.timestamp).toBeDefined();
  });

  it("logger.warn outputs to console.warn with level warn", () => {
    logger.warn("Cache miss");

    expect(warnSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("warn");
    expect(output.message).toBe("Cache miss");
  });

  it("logger.error outputs to console.error with level error", () => {
    logger.error("Mint failed");

    expect(errorSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("error");
    expect(output.message).toBe("Mint failed");
  });

  it("logger.debug outputs to console.debug with level debug", () => {
    setLogLevel("debug");
    logger.debug("Processing request");

    expect(debugSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(debugSpy.mock.calls[0][0] as string);
    expect(output.level).toBe("debug");
    expect(output.message).toBe("Processing request");
  });

  it("logger includes context object in output", () => {
    logger.info("Passport issued", { did: "did:hcs:0.0.123:1", tier: "gold" });

    const output = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(output.context).toEqual({ did: "did:hcs:0.0.123:1", tier: "gold" });
  });

  it("respects LOG_LEVEL env var (debug level shows debug)", () => {
    setLogLevel("debug");
    logger.debug("Debug message");

    expect(debugSpy).toHaveBeenCalledOnce();
  });

  it("respects LOG_LEVEL env var (info level hides debug)", () => {
    setLogLevel("info");
    logger.debug("Debug message");

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("respects LOG_LEVEL env var (warn level hides info)", () => {
    setLogLevel("warn");
    logger.info("Info message");

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("respects LOG_LEVEL env var (error level hides warn)", () => {
    setLogLevel("error");
    logger.warn("Warning message");

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("logger.error includes error stack when Error passed in context", () => {
    const err = new Error("Something broke");
    logger.error("Operation failed", { error: err });

    const output = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(output.context.error).toBe("Something broke");
    expect(output.context.stack).toBeDefined();
  });
});
