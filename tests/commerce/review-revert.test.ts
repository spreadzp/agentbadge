/**
 * SLICE-227-8 (R9-M2): the shared revert-outcome classifier.
 * Null aborts and dangerous refusals (`released`, `paid_leg`,
 * `intent_state`, unknown) are error-level with a stable `repair`
 * key; benign cycle-moved-on no-ops are warn-level only.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "@agentbadge/passport/logger";

import { logRevertOutcome } from "../../src/server/lib/commerce/services/review-revert";

afterEach(() => {
  vi.restoreAllMocks();
});

const F = { milestoneRowId: "ms_1", submissionId: "sub_1" };

describe("logRevertOutcome classification (R9-M2)", () => {
  it("null abort → error with repair", () => {
    const err = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    logRevertOutcome("approval revert", null, F);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]![1]).toMatchObject({
      repair: "review milestone approval",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reverted → silent", () => {
    const err = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    logRevertOutcome("approval revert", { reverted: true }, F);
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["not_approved", "epoch_mismatch", "intent_mismatch"] as const)(
    "benign %s → warn, no repair",
    (reason) => {
      const err = vi
        .spyOn(logger, "error")
        .mockImplementation(() => logger);
      const warn = vi
        .spyOn(logger, "warn")
        .mockImplementation(() => logger);
      logRevertOutcome("reject-release", { reverted: false, reason }, F);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]![1]).toMatchObject({ reason });
      expect(err).not.toHaveBeenCalled();
    },
  );

  it.each(["released", "paid_leg", "intent_state"] as const)(
    "dangerous %s → error with repair + reason",
    (reason) => {
      const err = vi
        .spyOn(logger, "error")
        .mockImplementation(() => logger);
      const warn = vi
        .spyOn(logger, "warn")
        .mockImplementation(() => logger);
      logRevertOutcome("approval revert", { reverted: false, reason }, F);
      expect(err).toHaveBeenCalledOnce();
      expect(err.mock.calls[0]![1]).toMatchObject({
        repair: "review milestone approval",
        reason,
      });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("missing reason → error 'unknown' (fail closed)", () => {
    const err = vi.spyOn(logger, "error").mockImplementation(() => logger);
    logRevertOutcome("reject-release", { reverted: false }, F);
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]![1]).toMatchObject({ reason: "unknown" });
  });
});
