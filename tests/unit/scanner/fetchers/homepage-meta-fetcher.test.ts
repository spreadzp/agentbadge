import { describe, it, expect } from "vitest";
import { fetchHomepageMeta } from "../../../../src/agent-readiness/scanner/fetchers/homepage-meta-fetcher";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const BASE = "https://example.com";

const htmlWith = (head: string): string =>
  `<!doctype html><html><head>${head}</head><body></body></html>`;

interface MockPage {
  ok: boolean;
  status?: number;
  text?: string;
}

function mkFetch(pages: Record<string, MockPage>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const key = typeof url === "string" ? url : url.toString();
    const page = pages[key];
    if (!page) {
      return { ok: false, status: 404, text: async () => "" } as unknown as Response;
    }
    return {
      ok: page.ok,
      status: page.status ?? 200,
      text: async () => page.text ?? "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const AI_META_TAGS = htmlWith(
  `<meta name="ai-agent-discovery" content="${BASE}/llms.txt">` +
  `<meta name="ai-agent-onboarding" content="${BASE}/skill.md">`,
);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-125-1: homepage-meta-fetcher — AI-Agent Discovery meta tags", () => {
  it("extracts ai-agent-discovery and ai-agent-onboarding meta tags", async () => {
    const fetchFn = mkFetch({
      [`${BASE}/`]: { ok: true, text: AI_META_TAGS },
      [`${BASE}/llms.txt`]: { ok: true, text: "# llms" },
      [`${BASE}/skill.md`]: { ok: true, text: "# skill" },
    });
    const result = await fetchHomepageMeta(BASE, fetchFn);
    expect(result.data.aiAgentDiscovery).toBe(`${BASE}/llms.txt`);
    expect(result.data.aiAgentOnboarding).toBe(`${BASE}/skill.md`);
    expect(result.data.aiAgentDiscoveryReachable).toBe(true);
    expect(result.data.aiAgentOnboardingReachable).toBe(true);
  });

  it("returns null and false when meta tags absent", async () => {
    const fetchFn = mkFetch({
      [`${BASE}/`]: { ok: true, text: htmlWith("<title>No AI meta</title>") },
    });
    const result = await fetchHomepageMeta(BASE, fetchFn);
    expect(result.data.aiAgentDiscovery).toBeNull();
    expect(result.data.aiAgentOnboarding).toBeNull();
    expect(result.data.aiAgentDiscoveryReachable).toBe(false);
    expect(result.data.aiAgentOnboardingReachable).toBe(false);
  });

  it("marks meta tag URLs unreachable when URL fetch fails", async () => {
    const fetchFn = mkFetch({
      [`${BASE}/`]: { ok: true, text: AI_META_TAGS },
      // llms.txt and skill.md not in pages → 404
    });
    const result = await fetchHomepageMeta(BASE, fetchFn);
    expect(result.data.aiAgentDiscovery).toBe(`${BASE}/llms.txt`);
    expect(result.data.aiAgentOnboarding).toBe(`${BASE}/skill.md`);
    expect(result.data.aiAgentDiscoveryReachable).toBe(false);
    expect(result.data.aiAgentOnboardingReachable).toBe(false);
  });

  it("handles content attribute before name attribute (reversed order)", async () => {
    const html = htmlWith(
      `<meta content="${BASE}/llms.txt" name="ai-agent-discovery">` +
      `<meta content="${BASE}/skill.md" name="ai-agent-onboarding">`,
    );
    const fetchFn = mkFetch({
      [`${BASE}/`]: { ok: true, text: html },
      [`${BASE}/llms.txt`]: { ok: true, text: "# llms" },
      [`${BASE}/skill.md`]: { ok: true, text: "# skill" },
    });
    const result = await fetchHomepageMeta(BASE, fetchFn);
    expect(result.data.aiAgentDiscovery).toBe(`${BASE}/llms.txt`);
    expect(result.data.aiAgentOnboarding).toBe(`${BASE}/skill.md`);
  });

  it("defaults AI meta fields when homepage fetch fails", async () => {
    const fetchFn = mkFetch({}); // homepage not in pages → 404
    const result = await fetchHomepageMeta(BASE, fetchFn);
    expect(result.data.aiAgentDiscovery).toBeNull();
    expect(result.data.aiAgentOnboarding).toBeNull();
    expect(result.data.aiAgentDiscoveryReachable).toBe(false);
    expect(result.data.aiAgentOnboardingReachable).toBe(false);
  });

  it("preserves existing homepage meta fields (no regression)", async () => {
    const fetchFn = mkFetch({
      [`${BASE}/`]: {
        ok: true,
        text: htmlWith(
          `<meta property="og:image" content="${BASE}/og.png">` +
          `<meta name="twitter:card" content="summary">` +
          `<link rel="canonical" href="${BASE}/">` +
          `<meta name="ai-agent-discovery" content="${BASE}/llms.txt">`,
        ),
      },
      [`${BASE}/og.png`]: { ok: true, text: "png" },
      [`${BASE}/llms.txt`]: { ok: true, text: "# llms" },
    });
    const result = await fetchHomepageMeta(BASE, fetchFn);
    expect(result.data.ogImage).toBe(`${BASE}/og.png`);
    expect(result.data.ogImageReachable).toBe(true);
    expect(result.data.twitterCard).toBe("summary");
    expect(result.data.canonical).toBe(`${BASE}/`);
    expect(result.data.aiAgentDiscovery).toBe(`${BASE}/llms.txt`);
  });
});
