import { describe, it, expect } from "vitest";
import { Layout } from "../../../src/views/layout";
import { Footer } from "../../../src/views/footer";
import { LandingHeader } from "../../../src/views/landing/header";
import { LandingLayout } from "../../../src/views/landing/layout";
import { PageMeta, BASE_URL, SITE_DESCRIPTION } from "../../../src/server/lib/page-meta";

// ─── Footer (shared) ──────────────────────────────────────────
describe("SLICE-19-1: Footer (shared)", () => {
  it("renders footer element with AgentGate branding", () => {
    const html = Footer().toString();
    expect(html).toContain("<footer");
    expect(html).toContain("AgentGate");
    expect(html).toContain("On-chain identity for AI agents on Hedera");
  });

  it("contains guide links", () => {
    const html = Footer().toString();
    expect(html).toContain('href="/agent-guide"');
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/changelog"');
  });

  it("contains social links (GitHub)", () => {
    const html = Footer().toString();
    expect(html).toContain('githubusercontent.com');
  });

  it("contains HashScan external link", () => {
    const html = Footer().toString();
    expect(html).toContain('hashscan.io');
  });
});

// ─── LandingHeader ────────────────────────────────────────────
describe("SLICE-19-1: LandingHeader", () => {
  it("renders header element with logo and AgentGate name", () => {
    const html = LandingHeader().toString();
    expect(html).toContain("<header");
    expect(html).toContain("AgentGate");
    expect(html).toContain('/icons/logo-32.png');
  });

  it("contains marketing nav links", () => {
    const html = LandingHeader().toString();
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/dashboard"');
  });

  it("contains Get Started CTA button", () => {
    const html = LandingHeader().toString();
    expect(html).toContain("Get Started");
    expect(html).toContain('href="/agent-guide"');
  });

  it("has mobile hamburger toggle", () => {
    const html = LandingHeader().toString();
    expect(html).toContain('nav-toggle');
    expect(html).toContain('aria-label="Toggle menu"');
  });
});

// ─── LandingLayout ────────────────────────────────────────────
describe("SLICE-19-1: LandingLayout", () => {
  it("renders full HTML document with DOCTYPE", () => {
    const html = LandingLayout("<p>test content</p>").toString();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  it("contains LandingHeader", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("<header");
    expect(html).toContain("AgentGate");
  });

  it("contains Footer", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("<footer");
    expect(html).toContain("On-chain identity for AI agents on Hedera");
  });

  it("does NOT contain sidebar", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).not.toContain("sidebar-toggle");
    expect(html).not.toContain('<aside');
  });

  it("contains main content area with id=main", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain('id="main"');
    expect(html).toContain("<main");
  });

  it("contains skip-to-content link", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain('href="#main"');
    expect(html).toContain("sr-only");
  });

  it("contains noscript fallback", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("<noscript>");
    expect(html).toContain("/dashboard");
  });

  it("renders children content", () => {
    const html = LandingLayout("<p>unique-test-content</p>").toString();
    expect(html).toContain("unique-test-content");
  });

  it("renders meta tags from PageMeta", () => {
    const meta = PageMeta["/"];
    const html = LandingLayout("<p>test</p>", "Test Title", meta).toString();
    expect(html).toContain("<title>");
    expect(html).toContain("Test Title");
    expect(html).toContain(meta.description);
  });

  it("renders canonical URL", () => {
    const html = LandingLayout("<p>test</p>", "Test", PageMeta["/"]).toString();
    expect(html).toContain('<link rel="canonical"');
    expect(html).toContain(BASE_URL);
  });

  it("renders OG and Twitter meta tags", () => {
    const html = LandingLayout("<p>test</p>", "Test").toString();
    expect(html).toContain('og:title');
    expect(html).toContain('twitter:card');
  });

  it("renders JSON-LD scripts", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain('application/ld+json');
  });

  it("includes HTMX script", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("htmx.org");
  });

  it("includes Tailwind CDN", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("tailwindcss");
  });

  it("includes CSS animation keyframes (fade-in-up, gradient-shift, pulse-glow)", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("fade-in-up");
    expect(html).toContain("gradient-shift");
    expect(html).toContain("pulse-glow");
    expect(html).toContain("@keyframes");
  });

  it("includes scroll-reveal animation", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain("scroll-reveal");
  });

  it("falls back to SITE_DESCRIPTION when no meta provided", () => {
    const html = LandingLayout("<p>test</p>").toString();
    expect(html).toContain(SITE_DESCRIPTION);
  });
});

// ─── Layout regression (footer extraction doesn't break existing) ──
describe("SLICE-19-1: Layout regression after Footer extraction", () => {
  it("Layout still renders footer with same content", () => {
    const html = Layout("<p>test</p>").toString();
    expect(html).toContain("<footer");
    expect(html).toContain("AgentGate");
    expect(html).toContain("On-chain identity for AI agents on Hedera");
  });

  it("Layout still renders sidebar", () => {
    const html = Layout("<p>test</p>").toString();
    expect(html).toContain("sidebar-toggle");
    expect(html).toContain("<aside");
  });

  it("Layout still renders header with dashboard nav", () => {
    const html = Layout("<p>test</p>").toString();
    expect(html).toContain("<header");
    expect(html).toContain("/ui/agents");
  });

  it("Layout still renders DOCTYPE and full HTML", () => {
    const html = Layout("<p>test</p>").toString();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });
});

// ─── SLICE-21-8: Layout Enhancements ─────────────────────────
describe("SLICE-21-8: Layout Enhancements", () => {
  describe("LandingLayout", () => {
    it("contains theme-color meta tag", () => {
      const html = LandingLayout("<p>test</p>").toString();
      expect(html).toContain('name="theme-color"');
      expect(html).toContain('#0f172a');
    });

    it("contains og:locale meta tag", () => {
      const html = LandingLayout("<p>test</p>").toString();
      expect(html).toContain('og:locale');
      expect(html).toContain('en_US');
    });

    it("contains og:image:width and og:image:height", () => {
      const html = LandingLayout("<p>test</p>").toString();
      expect(html).toContain('og:image:width');
      expect(html).toContain('1200');
      expect(html).toContain('og:image:height');
      expect(html).toContain('630');
    });

    it("all script tags have defer attribute", () => {
      const html = LandingLayout("<p>test</p>").toString();
      const scriptTags = html.match(/<script\s+src="[^"]*"\s*(?:[^>]*)>/g) ?? [];
      for (const tag of scriptTags) {
        expect(tag).toContain("defer");
      }
    });

    it("noscript contains product name and /dashboard link", () => {
      const html = LandingLayout("<p>test</p>").toString();
      expect(html).toContain("<noscript>");
      expect(html).toContain("AgentGate — On-Chain Identity for AI Agents");
      expect(html).toContain('href="/dashboard"');
    });
  });

  describe("Layout (dashboard)", () => {
    it("contains theme-color meta tag", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain('name="theme-color"');
      expect(html).toContain('#0f172a');
    });

    it("contains og:locale meta tag", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain('og:locale');
      expect(html).toContain('en_US');
    });

    it("contains og:image:width and og:image:height", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain('og:image:width');
      expect(html).toContain('og:image:height');
    });

    it("all script tags have defer attribute", () => {
      const html = Layout("<p>test</p>").toString();
      const scriptTags = html.match(/<script\s+src="[^"]*"\s*(?:[^>]*)>/g) ?? [];
      for (const tag of scriptTags) {
        expect(tag).toContain("defer");
      }
    });

    it("noscript contains product name and /dashboard link", () => {
      const html = Layout("<p>test</p>").toString();
      expect(html).toContain("<noscript>");
      expect(html).toContain("AgentGate — On-Chain Identity for AI Agents");
      expect(html).toContain('href="/dashboard"');
    });
  });

  describe("Footer copyright bar", () => {
    it("contains copyright with AgentGate and MIT License", () => {
      const html = Footer().toString();
      expect(html).toContain("© 2026 AgentGate");
      expect(html).toContain("MIT License");
      expect(html).toContain("Built on Hedera");
    });
  });
});
