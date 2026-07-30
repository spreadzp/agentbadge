import { describe, it, expect } from "vitest";
import { LiveStatsSection } from "../../../src/views/landing/live-stats";

describe("SLICE-19-5: Live Stats section (SSR + HTMX polling)", () => {
  describe("LiveStatsSection() with SSR data", () => {
    it("returns HTML string", () => {
      const html = LiveStatsSection({
        totalIssued: 20,
        activeCount: 12,
        totalUpgrades: 3,
        tasksCount: 5,
      }).toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id live-stats", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toContain('id="live-stats"');
    });

    it("contains 4 stat cards", () => {
      const html = LiveStatsSection({ totalIssued: 20, activeCount: 12, totalUpgrades: 3, tasksCount: 5 }).toString();
      // 4 cards: Passports Issued, Active Agents, Marketplace Tasks, Tier Upgrades
      expect(html).toMatch(/Passports Issued/i);
      expect(html).toMatch(/Active Agents/i);
      expect(html).toMatch(/Marketplace Tasks/i);
      expect(html).toMatch(/Tier Upgrades/i);
    });

    it("displays SSR values in cards", () => {
      const html = LiveStatsSection({ totalIssued: 20, activeCount: 12, totalUpgrades: 3, tasksCount: 5 }).toString();
      expect(html).toContain("20");
      expect(html).toContain("12");
      expect(html).toContain("5");
      expect(html).toContain("3");
    });

    it("contains HTMX polling attributes (hx-get, hx-trigger)", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toContain("hx-get");
      expect(html).toContain("hx-trigger");
      expect(html).toContain("every 10s");
    });

    it("hx-get points to /ui/stats", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toContain('hx-get="/ui/stats"');
    });

    it("shows 0 for empty state", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      // Should show 0 values, not error or undefined
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    });

    it("contains heading for the section", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toMatch(/<h2/i);
      expect(html).toMatch(/Live|Stats|Network/i);
    });

    it("contains fade-in-up animation class", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toContain("fade-in-up");
    });
  });

  describe("LiveStatsSection() without SSR data (empty state)", () => {
    it("works with all zeros", () => {
      const html = LiveStatsSection({ totalIssued: 0, activeCount: 0, totalUpgrades: 0, tasksCount: 0 }).toString();
      expect(html).toContain("0");
    });
  });
});
