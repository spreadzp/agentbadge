import { describe, it, expect } from "vitest";
import { FaqPage, getFaqEntries } from "../../../src/views/pages/faq-page";
import { AboutPage } from "../../../src/views/pages/about-page";
import { PricingPage } from "../../../src/views/pages/pricing-page";
import { UseCasesPage } from "../../../src/views/pages/use-cases-page";

describe("SLICE-113-5: Content pages cross-links", () => {
  it("FAQ page has RelatedLinks with /about, /pricing, /use-cases, /blog", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/use-cases"');
    expect(html).toContain('href="/blog"');
  });

  it("About page has RelatedLinks with /blog, /faq, /pricing, /services", () => {
    const html = AboutPage().toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/blog"');
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/services"');
  });

  it("Pricing page has RelatedLinks with /faq, /about, /services, /agent-guide", () => {
    const html = PricingPage().toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/services"');
    expect(html).toContain('href="/agent-guide"');
  });

  it("Use Cases page has RelatedLinks with /services, /faq, /blog, /agent-guide", () => {
    const html = UseCasesPage().toString();
    expect(html).toContain("Explore More");
    expect(html).toContain('href="/services"');
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/blog"');
    expect(html).toContain('href="/agent-guide"');
  });
});
