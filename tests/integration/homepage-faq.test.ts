import { describe, it, expect } from "vitest";
import { ReadinessLandingPage, getHomepageFaqJsonLd } from "../../src/views/landing/readiness-landing-page";

describe("SLICE-118-3: Homepage FAQ — 5 key questions + anchor links + JSON-LD", () => {
  const html = ReadinessLandingPage().toString();

  it("contains h2 with 'Frequently Asked Questions'", () => {
    expect(html).toContain("Frequently Asked Questions");
  });

  it("contains exactly 5 <details> elements in the FAQ section", () => {
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(5);
  });

  it("contains 'What is Agent Readiness?' question", () => {
    expect(html).toContain("What is Agent Readiness?");
  });

  it("contains 'What does AgentBadge measure?' question", () => {
    const encoded = "What does AgentBadge measure?".replace(/&/g, "&amp;");
    expect(html.includes("What does AgentBadge measure?") || html.includes(encoded)).toBe(true);
  });

  it("contains 'Is OpenAPI enough?' question", () => {
    expect(html).toContain("Is OpenAPI enough?");
  });

  it("contains 'How does AgentBadge score?' question", () => {
    const encoded = "How does AgentBadge score?".replace(/&/g, "&amp;");
    expect(html.includes("How does AgentBadge score?") || html.includes(encoded)).toBe(true);
  });

  it("contains 'What is an Agent Passport?' question", () => {
    expect(html).toContain("What is an Agent Passport?");
  });

  it("each FAQ item has a 'Read more' link to /faq#anchor", () => {
    expect(html).toContain("Read more");
    expect(html).toContain('href="/faq#what-is-agent-readiness"');
  });

  it('"Read more" link for "What is Agent Readiness?" points to /faq#what-is-agent-readiness', () => {
    expect(html).toContain('href="/faq#what-is-agent-readiness"');
  });

  it('"See all FAQs" link points to /faq', () => {
    expect(html).toContain('href="/faq"');
    expect(html).toContain("See all FAQs");
  });

  it("homepage FAQ JSON-LD contains 5 questions", () => {
    const jsonLd = getHomepageFaqJsonLd() as Record<string, unknown>;
    const mainEntity = jsonLd["mainEntity"] as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(5);
  });

  it('old hardcoded "Do I need to pay for a scan?" is NOT present', () => {
    expect(html).not.toContain("Do I need to pay for a scan?");
  });

  it('old hardcoded "What is an agent readiness scan?" is NOT present', () => {
    expect(html).not.toContain("What is an agent readiness scan?");
  });
});
