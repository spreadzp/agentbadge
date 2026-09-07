import { describe, it, expect } from "vitest";
import { LandingLayout } from "../../src/views/landing/layout";
import { Layout } from "../../src/views/layout";
import { GuideLayout } from "../../src/views/guide-layout";
import { PageMeta, BASE_URL } from "../../src/server/lib/page-meta";

describe("SLICE-121-1: AI-Agent Discovery meta tags", () => {
  const testMeta = PageMeta["/"];

  describe("landing/layout.ts", () => {
    const html = LandingLayout("<div>test</div>", undefined, testMeta, []).toString();

    it('contains <meta name="ai-agent-discovery">', () => {
      expect(html).toContain('name="ai-agent-discovery"');
      expect(html).toContain(`${BASE_URL}/llms.txt`);
    });

    it('contains <meta name="ai-agent-onboarding">', () => {
      expect(html).toContain('name="ai-agent-onboarding"');
      expect(html).toContain(`${BASE_URL}/skill.md`);
    });
  });

  describe("layout.ts", () => {
    const html = Layout("<div>test</div>", "Test Page", testMeta, []).toString();

    it('contains <meta name="ai-agent-discovery">', () => {
      expect(html).toContain('name="ai-agent-discovery"');
      expect(html).toContain(`${BASE_URL}/llms.txt`);
    });

    it('contains <meta name="ai-agent-onboarding">', () => {
      expect(html).toContain('name="ai-agent-onboarding"');
      expect(html).toContain(`${BASE_URL}/skill.md`);
    });
  });

  describe("guide-layout.ts", () => {
    const html = GuideLayout("Test Guide", "test-guide", [], []).toString();

    it('contains <meta name="ai-agent-discovery">', () => {
      expect(html).toContain('name="ai-agent-discovery"');
      expect(html).toContain(`${BASE_URL}/llms.txt`);
    });

    it('contains <meta name="ai-agent-onboarding">', () => {
      expect(html).toContain('name="ai-agent-onboarding"');
      expect(html).toContain(`${BASE_URL}/skill.md`);
    });
  });
});
