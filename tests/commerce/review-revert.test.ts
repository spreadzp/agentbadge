/**
 * SLICE-227-8 (R9-M2): the shared revert-outcome classifier.
 * Null aborts and dangerous refusals (`released`, `paid_leg`,
 * `intent_state`, unknown) are error-level with a stable `repair`
 * key; benign cycle-moved-on no-ops are warn-level only.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { logger } from "@agentbadge/passport/logger";

import {
  logRevertOutcome,
  revertGateApproval,
} from "../../src/server/lib/commerce/services/review-revert";

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

  it.each(["not_approved"] as const)(
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

  it.each(
    [
      "released",
      "paid_leg",
      "intent_state",
      // R10 nits 5/6: a re-stamped epoch is a standing ruling (same
      // end-state the !releasable branch reports at error level); an
      // intent mismatch under a matching epoch is an inconsistent row.
      "epoch_mismatch",
      "intent_mismatch",
    ] as const,
  )(
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

describe("revertGateApproval token pin (R10 nit 2)", () => {
  it("approvedByUs without an approvalToken fails closed — error+repair, no revert call", async () => {
    const err = vi.spyOn(logger, "error").mockImplementation(() => logger);
    const revertApproval = vi.fn();
    const ctx = {
      stores: { submissions: { getById: vi.fn() } },
      settlement: { revertApproval },
    };
    await revertGateApproval(
      ctx as never,
      "0xBuyer",
      "sub_1",
      {
        approvedByUs: true,
        milestoneRowId: "ms_1",
        intentId: "pi_1",
        pendingAfter: 0,
        approvalToken: undefined,
      },
    );
    expect(err).toHaveBeenCalledOnce();
    expect(err.mock.calls[0]![1]).toMatchObject({
      repair: "review milestone approval",
      milestoneRowId: "ms_1",
    });
    // Fail closed — an unpinned revert could undo an rsv_/ops_ ruling.
    expect(revertApproval).not.toHaveBeenCalled();
    expect(ctx.stores.submissions.getById).not.toHaveBeenCalled();
  });
});
