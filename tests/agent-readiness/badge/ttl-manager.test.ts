import { describe, it, expect } from "vitest";
import { checkStaleness } from "../../../src/agent-readiness/badge/ttl-manager";

describe("SLICE-38-4: TTL Manager", () => {
  describe("checkStaleness", () => {
    it("returns stale=false for report scanned today", () => {
      const today = new Date().toISOString();
      const result = checkStaleness(today, 7);
      expect(result.stale).toBe(false);
    });

    it("returns stale=true for report scanned 8 days ago with TTL 7", () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const result = checkStaleness(eightDaysAgo, 7);
      expect(result.stale).toBe(true);
    });

    it("returns stale=false for report scanned 6 days ago with TTL 7", () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
      const result = checkStaleness(sixDaysAgo, 7);
      expect(result.stale).toBe(false);
    });

    it("returns stale=true for report scanned 30 days ago with TTL 7", () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const result = checkStaleness(thirtyDaysAgo, 7);
      expect(result.stale).toBe(true);
    });

    it("returns ageDays correctly for 3-day-old report", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      const result = checkStaleness(threeDaysAgo, 7);
      expect(result.ageDays).toBe(3);
    });

    it("returns ageDays=0 for today's report", () => {
      const today = new Date().toISOString();
      const result = checkStaleness(today, 7);
      expect(result.ageDays).toBe(0);
    });

    it("returns ttlDays matching input", () => {
      const today = new Date().toISOString();
      const result = checkStaleness(today, 14);
      expect(result.ttlDays).toBe(14);
    });

    it("returns expiresAt as ISO string", () => {
      const today = new Date().toISOString();
      const result = checkStaleness(today, 7);
      expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("expiresAt = scannedAt + ttlDays", () => {
      const scanned = "2025-01-15T10:00:00.000Z";
      const result = checkStaleness(scanned, 7);
      const expected = new Date("2025-01-15T10:00:00.000Z").getTime() + 7 * 24 * 60 * 60 * 1000;
      expect(new Date(result.expiresAt).getTime()).toBe(expected);
    });

    it("default TTL is 7 days", () => {
      const today = new Date().toISOString();
      const result = checkStaleness(today);
      expect(result.ttlDays).toBe(7);
    });

    it("is pure — same input produces same stale/expiresAt", () => {
      const scanned = "2025-01-15T10:00:00.000Z";
      const r1 = checkStaleness(scanned, 7);
      const r2 = checkStaleness(scanned, 7);
      expect(r1.expiresAt).toBe(r2.expiresAt);
      expect(r1.ttlDays).toBe(r2.ttlDays);
    });

    it("returns stale=true at boundary — exactly TTL days old", () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1).toISOString();
      const result = checkStaleness(sevenDaysAgo, 7);
      expect(result.stale).toBe(true);
    });

    it("handles TTL=1 (daily)", () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const result = checkStaleness(twoDaysAgo, 1);
      expect(result.stale).toBe(true);
      expect(result.ttlDays).toBe(1);
    });

    it("handles TTL=30 (monthly)", () => {
      const today = new Date().toISOString();
      const result = checkStaleness(today, 30);
      expect(result.stale).toBe(false);
      expect(result.ttlDays).toBe(30);
    });
  });
});
