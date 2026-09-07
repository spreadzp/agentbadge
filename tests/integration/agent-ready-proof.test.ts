import { describe, it, expect } from "vitest";
import { AgentReadyProofSection } from "../../src/views/landing/sections/agent-ready-proof";
import { ReadinessLandingPage } from "../../src/views/landing/readiness-landing-page";

describe("SLICE-119-1: AgentReadyProofSection homepage component", () => {
  const sectionHtml = AgentReadyProofSection().toString();
  const pageHtml = ReadinessLandingPage().toString();

  describe("Section content", () => {
    it('contains id="agent-ready-proof" section', () => {
      expect(sectionHtml).toContain('id="agent-ready-proof"');
    });

    it('contains headline "We don\'t just measure Agent Readiness"', () => {
      expect(sectionHtml).toContain("We don't just measure Agent Readiness");
    });

    it("contains 6 evidence cards (6 <a> elements)", () => {
      const count = (sectionHtml.match(/<a href/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(6);
    });

    it("card links to /robots.txt", () => {
      expect(sectionHtml).toContain('href="/robots.txt"');
    });

    it("card links to /llms.txt", () => {
      expect(sectionHtml).toContain('href="/llms.txt"');
    });

    it("card links to /openapi.json", () => {
      expect(sectionHtml).toContain('href="/openapi.json"');
    });

    it("card links to /hackathon/webmcp", () => {
      expect(sectionHtml).toContain('href="/hackathon/webmcp"');
    });

    it("card links to /agent-guide/", () => {
      expect(sectionHtml).toContain('href="/agent-guide/"');
    });

    it("card links to /agent-guide/knowledge-map.json", () => {
      expect(sectionHtml).toContain('href="/agent-guide/knowledge-map.json"');
    });

    it("CTA button links to /hackathon/webmcp", () => {
      expect(sectionHtml).toContain("See the agent architecture");
      expect(sectionHtml).toContain('href="/hackathon/webmcp"');
    });

    it("each card has a status badge", () => {
      expect(sectionHtml).toContain("200 OK");
      expect(sectionHtml).toContain("6 tools");
      expect(sectionHtml).toContain("Live");
    });
  });

  describe("Wired into ReadinessLandingPage", () => {
    it('homepage contains id="agent-ready-proof"', () => {
      expect(pageHtml).toContain('id="agent-ready-proof"');
    });

    it("homepage contains the headline", () => {
      expect(pageHtml).toContain("We don't just measure Agent Readiness");
    });

    it("homepage contains all 6 card URLs", () => {
      expect(pageHtml).toContain("/robots.txt");
      expect(pageHtml).toContain("/llms.txt");
      expect(pageHtml).toContain("/openapi.json");
      expect(pageHtml).toContain("/hackathon/webmcp");
      expect(pageHtml).toContain("/agent-guide/");
      expect(pageHtml).toContain("/agent-guide/knowledge-map.json");
    });
  });
});
