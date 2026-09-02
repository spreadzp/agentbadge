/**
 * SLICE-84-4: Stripe Webhook Idempotency Ledger
 *
 * Tests:
 * 1. Same event twice → single fulfillment call
 * 2. Fail-then-retry succeeds exactly once (claim released on error)
 * 3. Three failures → alert logged
 * 4. withIdempotency reusable for other webhook sources
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventLedger, withIdempotency } from "../../src/server/lib/event-ledger";

describe("SLICE-84-4: Stripe Webhook Idempotency", () => {
  let ledger: EventLedger;

  beforeEach(() => {
    ledger = new EventLedger();
  });

  describe("EventLedger", () => {
    it("claimEvent returns true for new event, false for duplicate", () => {
      expect(ledger.claimEvent("evt_001", "sess_001")).toBe(true);
      expect(ledger.claimEvent("evt_001", "sess_001")).toBe(false);
    });

    it("claimEvent by session.id also deduplicates", () => {
      expect(ledger.claimEvent("evt_001", "sess_001")).toBe(true);
      // Different event ID but same session → should dedup
      expect(ledger.claimEvent("evt_002", "sess_001")).toBe(false);
    });

    it("markDone releases claim and prevents future claims", () => {
      ledger.claimEvent("evt_001", "sess_001");
      ledger.markDone("evt_001");
      expect(ledger.claimEvent("evt_001", "sess_001")).toBe(false);
    });

    it("releaseClaim allows retry on same event", () => {
      ledger.claimEvent("evt_001", "sess_001");
      ledger.releaseClaim("evt_001");
      expect(ledger.claimEvent("evt_001", "sess_001")).toBe(true);
    });

    it("tracks attempt count per event", () => {
      ledger.claimEvent("evt_001", "sess_001");
      ledger.releaseClaim("evt_001");
      ledger.claimEvent("evt_001", "sess_001");
      ledger.releaseClaim("evt_001");
      ledger.claimEvent("evt_001", "sess_001");
      expect(ledger.getAttempts("evt_001")).toBe(3);
    });

    it("getAttempts returns 0 for unknown event", () => {
      expect(ledger.getAttempts("evt_unknown")).toBe(0);
    });
  });

  describe("withIdempotency", () => {
    it("same event twice → fulfillment called once", async () => {
      const fulfill = vi.fn(async () => { });
      const eventId = "evt_001";
      const sessionId = "sess_001";

      const r1 = await withIdempotency(ledger, eventId, sessionId, fulfill);
      const r2 = await withIdempotency(ledger, eventId, sessionId, fulfill);

      expect(r1.fulfilled).toBe(true);
      expect(r1.deduped).toBe(false);
      expect(r2.fulfilled).toBe(false);
      expect(r2.deduped).toBe(true);
      expect(fulfill).toHaveBeenCalledTimes(1);
    });

    it("fail-then-retry succeeds exactly once", async () => {
      let callCount = 0;
      const fulfill = vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new Error("Transient failure");
      });

      const r1 = await withIdempotency(ledger, "evt_001", "sess_001", fulfill);
      expect(r1.fulfilled).toBe(false);
      expect(r1.error).toBe("Transient failure");

      const r2 = await withIdempotency(ledger, "evt_001", "sess_001", fulfill);
      expect(r2.fulfilled).toBe(true);
      expect(r2.deduped).toBe(false);

      expect(fulfill).toHaveBeenCalledTimes(2);
    });

    it("three failures → alert logged", async () => {
      const alertSpy = vi.fn();
      const fulfill = vi.fn(async () => {
        throw new Error("Persistent failure");
      });

      for (let i = 0; i < 3; i++) {
        await withIdempotency(ledger, "evt_001", "sess_001", fulfill, { onAlert: alertSpy });
      }

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: "evt_001",
          attempts: 3,
        }),
      );
    });

    it("alert fires only once (not on 4th attempt)", async () => {
      const alertSpy = vi.fn();
      const fulfill = vi.fn(async () => {
        throw new Error("Persistent failure");
      });

      for (let i = 0; i < 4; i++) {
        await withIdempotency(ledger, "evt_001", "sess_001", fulfill, { onAlert: alertSpy });
      }

      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    it("reusable for non-Stripe webhooks (different source)", async () => {
      const fulfill = vi.fn(async () => { });
      const r = await withIdempotency(ledger, "github_evt_001", "github_del_001", fulfill);
      expect(r.fulfilled).toBe(true);
      expect(fulfill).toHaveBeenCalledTimes(1);
    });
  });
});
