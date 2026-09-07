import { describe, it, expect } from "vitest";
import { ReadinessLandingPage } from "../../../src/views/landing/readiness-landing-page";
import { ReadinessThesisSection } from "../../../src/views/landing/sections/readiness-thesis";

describe("SLICE-113-4: Homepage cross-links", () => {
  const html = ReadinessLandingPage().toString();

  it("homepage contains link to /blog in body", () => {
    expect(html).toContain('href="/blog"');
  });

  it("homepage contains link to /what-is-agent-readiness in body", () => {
    expect(html).toContain('href="/what-is-agent-readiness"');
  });

  it("homepage contains link to /faq in body", () => {
    expect(html).toContain('href="/faq"');
  });

  it("homepage contains link to /use-cases in body", () => {
    expect(html).toContain('href="/use-cases"');
  });

  it("RelatedLinks section renders with 'Explore More' title", () => {
    expect(html).toContain("Explore More");
  });

  it("thesis section has contextual link to /blog", () => {
    const thesisHtml = ReadinessThesisSection().toString();
    expect(thesisHtml).toContain('href="/blog"');
    expect(thesisHtml).toContain("Read our deep dives on the blog");
  });

  it("thesis section has contextual link to /what-is-agent-readiness", () => {
    const thesisHtml = ReadinessThesisSection().toString();
    expect(thesisHtml).toContain('href="/what-is-agent-readiness"');
    expect(thesisHtml).toContain("Learn what agent readiness means");
  });
});
