import { describe, it, expect } from "vitest";
import { Layout } from "../../src/views/layout";
import { LandingLayout } from "../../src/views/landing/layout";
import { Footer } from "../../src/views/footer";

describe("SLICE-76-1: Image alt text — all <img> tags have alt", () => {
  it("dashboard layout has no <img> without alt", () => {
    const html = Layout("test content").toString();
    const imgTags = html.match(/<img[^>]*>/g) ?? [];
    for (const tag of imgTags) {
      expect(tag).toMatch(/\salt=/);
    }
  });

  it("landing layout has no <img> without alt", () => {
    const html = LandingLayout("test content").toString();
    const imgTags = html.match(/<img[^>]*>/g) ?? [];
    for (const tag of imgTags) {
      expect(tag).toMatch(/\salt=/);
    }
  });

  it("footer has no <img> without alt", () => {
    const html = Footer().toString();
    const imgTags = html.match(/<img[^>]*>/g) ?? [];
    for (const tag of imgTags) {
      expect(tag).toMatch(/\salt=/);
    }
  });
});

describe("SLICE-76-2: Lazy loading — all <img> have loading attribute", () => {
  it("dashboard layout has no <img> without loading", () => {
    const html = Layout("test content").toString();
    const imgTags = html.match(/<img[^>]*>/g) ?? [];
    for (const tag of imgTags) {
      expect(tag).toMatch(/\sloading=/);
    }
  });

  it("landing layout has no <img> without loading", () => {
    const html = LandingLayout("test content").toString();
    const imgTags = html.match(/<img[^>]*>/g) ?? [];
    for (const tag of imgTags) {
      expect(tag).toMatch(/\sloading=/);
    }
  });
});

describe("SLICE-76-4: Skip-to-content link present", () => {
  it("dashboard layout has skip-to-content link", () => {
    const html = Layout("test content").toString();
    expect(html).toContain('href="#main"');
    expect(html.toLowerCase()).toContain("skip to content");
  });

  it("landing layout has skip-to-content link", () => {
    const html = LandingLayout("test content").toString();
    expect(html).toContain('href="#main"');
    expect(html.toLowerCase()).toContain("skip to content");
  });

  it("dashboard layout has <main id=\"main\">", () => {
    const html = Layout("test content").toString();
    expect(html).toContain('id="main"');
  });

  it("landing layout has <main id=\"main\">", () => {
    const html = LandingLayout("test content").toString();
    expect(html).toContain('id="main"');
  });
});

describe("SLICE-76-4: ARIA landmarks present", () => {
  it("dashboard layout has <header>, <nav>, <main>, <footer>", () => {
    const html = Layout("test content").toString().toLowerCase();
    expect(html).toContain("<header");
    expect(html).toContain("<nav");
    expect(html).toContain("<main");
    expect(html).toContain("<footer");
  });

  it("landing layout has <header>, <nav>, <main>, <footer>", () => {
    const html = LandingLayout("test content").toString().toLowerCase();
    expect(html).toContain("<header");
    expect(html).toContain("<nav");
    expect(html).toContain("<main");
    expect(html).toContain("<footer");
  });
});

describe("SLICE-76-4: focus-visible CSS present", () => {
  it("dashboard layout has :focus-visible CSS rule", () => {
    const html = Layout("test content").toString();
    expect(html).toContain(":focus-visible");
  });

  it("landing layout has :focus-visible CSS rule", () => {
    const html = LandingLayout("test content").toString();
    expect(html).toContain(":focus-visible");
  });
});

describe("SLICE-76-5: prefers-reduced-motion CSS present", () => {
  it("dashboard layout has prefers-reduced-motion media query", () => {
    const html = Layout("test content").toString();
    expect(html).toContain("prefers-reduced-motion");
  });

  it("landing layout has prefers-reduced-motion media query", () => {
    const html = LandingLayout("test content").toString();
    expect(html).toContain("prefers-reduced-motion");
  });
});
