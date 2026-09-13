import { describe, it, expect } from "vitest";
import { CLUSTER_PAGES, getClusterPage, type ClusterPageData } from "../../../src/server/lib/cluster-data";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import { ClusterPage } from "../../../src/views/cluster-page";

describe("SLICE-116-1: ClusterPage View + CLUSTER_PAGES Metadata", () => {
  // ─── cluster-data.ts ───

  describe("getClusterPage()", () => {
    it("returns ClusterPageData for valid slug", () => {
      const page = getClusterPage("how-to-make-an-api-agent-ready");
      expect(page).toBeDefined();
      expect(page!.slug).toBe("how-to-make-an-api-agent-ready");
      expect(page!.question).toContain("How to make");
    });

    it("returns undefined for invalid slug", () => {
      const page = getClusterPage("invalid-slug");
      expect(page).toBeUndefined();
    });
  });

  describe("CLUSTER_PAGES", () => {
    it("has 6 entries", () => {
      expect(CLUSTER_PAGES).toHaveLength(6);
    });

    it("all relatedRuleIds exist in RULE_DESCRIPTIONS", () => {
      const ruleIds = new Set(RULE_DESCRIPTIONS.map((r) => r.rule_id));
      for (const page of CLUSTER_PAGES) {
        for (const id of page.relatedRuleIds) {
          expect(ruleIds.has(id)).toBe(true);
        }
      }
    });

    it("all relatedPages slugs exist in CLUSTER_PAGES", () => {
      const slugs = new Set(CLUSTER_PAGES.map((p) => p.slug));
      for (const page of CLUSTER_PAGES) {
        for (const slug of page.relatedPages) {
          expect(slugs.has(slug)).toBe(true);
        }
      }
    });

    it("each entry has all required fields", () => {
      for (const page of CLUSTER_PAGES) {
        expect(page.slug).toBeTruthy();
        expect(page.question).toBeTruthy();
        expect(page.title).toBeTruthy();
        expect(page.description).toBeTruthy();
        expect(page.directAnswer).toBeTruthy();
        expect(page.contentFile).toBeTruthy();
        expect(page.relatedRuleIds.length).toBeGreaterThan(0);
        expect(page.relatedPages.length).toBeGreaterThan(0);
        expect(page.pillar).toBeTruthy();
      }
    });
  });

  // ─── cluster-page.ts (View) ───

  describe("ClusterPage(data)", () => {
    const data: ClusterPageData = CLUSTER_PAGES[0];
    const html = ClusterPage(data).toString();

    it("returns HTML string containing the question as H1", () => {
      expect(html).toContain(data.question);
      expect(html).toMatch(/<h1[^>]*>.*How to make.*<\/h1>/s);
    });

    it("contains direct answer in highlighted box", () => {
      expect(html).toContain(data.directAnswer);
      expect(html).toContain("border-emerald-500");
    });

    it("contains links to related rules", () => {
      expect(html).toContain("/rules/AB-001");
      expect(html).toContain("/rules/AB-002");
    });

    it("contains 'Scan your site' CTA", () => {
      expect(html).toContain("Scan your site");
      expect(html).toContain("/#scan");
    });

    it("contains breadcrumb navigation", () => {
      expect(html).toContain("Home");
      expect(html).toContain(data.title);
    });

    it("contains related pages links", () => {
      expect(html).toContain("/what-is-an-ai-ready-api");
      expect(html).toContain("/openapi-vs-agent-readiness");
    });

    it("includes Article JSON-LD schema", () => {
      expect(html).toContain('"@type":"Article"');
    });

    it("includes BreadcrumbList JSON-LD schema", () => {
      expect(html).toContain('"@type":"BreadcrumbList"');
    });
  });
});
