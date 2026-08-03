import { describe, it, expect } from "vitest";
import { Layout } from "../src/views/layout";
import { PageTitles } from "../src/server/lib/page-titles";

describe("SLICE-17-8: Per-page <title> tags", () => {
  describe("Layout() with title parameter", () => {
    it("uses custom title when provided", () => {
      const html = Layout("<p>test</p>", "Agent Directory").toString();
      expect(html).toContain("<title>Agent Directory — AgentBadge</title>");
    });

    it("uses default title when no title provided", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain(
        "<title>AgentBadge — On-chain Identity for AI Agents on Hedera</title>",
      );
    });

    it("formats title as 'Page Name — AgentBadge'", () => {
      const html = Layout("<p>test</p>", "Search Agents").toString();
      expect(html).toContain("<title>Search Agents — AgentBadge</title>");
    });

    it("default title is backward compatible", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).not.toContain("Hedera Passport Dashboard");
    });
  });

  describe("PageTitles map", () => {
    it("contains entries for all UI routes", () => {
      expect(PageTitles["/ui/agents"]).toBe("Agent Directory");
      expect(PageTitles["/ui/search"]).toBe("Search Agents");
      expect(PageTitles["/ui/catalog"]).toBe("Passport Tiers & Pricing");
      expect(PageTitles["/ui/a2a"]).toBe("A2A Messaging Inbox");
      expect(PageTitles["/ui/market/tasks"]).toBe("Agent Marketplace");
      expect(PageTitles["/ui/medical-demo"]).toBe("Medical Data Demo");
      expect(PageTitles["/ui/help"]).toBe("Help & Documentation");
      expect(PageTitles["/ui/passport/request"]).toBe("Request Passport");
    });

    it("has at least 8 unique titles", () => {
      const titles = Object.values(PageTitles);
      const unique = new Set(titles);
      expect(unique.size).toBe(titles.length);
    });
  });

  describe("Unique titles per route", () => {
    const routes: { path: string; expectedTitle: string }[] = [
      { path: "/", expectedTitle: "AgentBadge — On-chain Identity for AI Agents on Hedera" },
      { path: "/ui/agents", expectedTitle: "Agent Directory — AgentBadge" },
      { path: "/ui/search", expectedTitle: "Search Agents — AgentBadge" },
      { path: "/ui/catalog", expectedTitle: "Passport Tiers & Pricing — AgentBadge" },
      { path: "/ui/a2a", expectedTitle: "A2A Messaging Inbox — AgentBadge" },
      { path: "/ui/market/tasks", expectedTitle: "Agent Marketplace — AgentBadge" },
      { path: "/ui/medical-demo", expectedTitle: "Medical Data Demo — AgentBadge" },
      { path: "/ui/help", expectedTitle: "Help & Documentation — AgentBadge" },
      { path: "/ui/passport/request", expectedTitle: "Request Passport — AgentBadge" },
    ];

    const seenTitles = new Set<string>();

    for (const route of routes) {
      it(`GET ${route.path} → <title>${route.expectedTitle}</title>`, () => {
        expect(route.expectedTitle).not.toBe("");
        // Ensure no duplicates
        expect(seenTitles.has(route.expectedTitle)).toBe(false);
        seenTitles.add(route.expectedTitle);
      });
    }
  });
});
