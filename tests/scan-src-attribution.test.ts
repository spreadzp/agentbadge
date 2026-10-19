/**
 * SLICE-201-7: ?src= attribution — parseSrc validation, audit event on
 * scan start, idempotent by scanId, CTA/KO carry the marker.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseSrc,
  recordScanAttribution,
} from "../src/server/lib/src-attribution";
import { auditStore } from "../src/server/lib/keeperhub-audit-store";
import { BLOG_ARTICLES, type BlogArticle } from "../src/server/lib/blog-data";
import { toKnowledgeObject } from "../src/server/lib/blog/knowledge-object";
import { BlogArticlePage } from "../src/views/blog-article";

afterEach(() => vi.restoreAllMocks());

describe("parseSrc (201-7)", () => {
  it("accepts channel:slug format", () => {
    expect(parseSrc("article:arc-c14-agent-discovery")).toBe(
      "article:arc-c14-agent-discovery",
    );
    expect(parseSrc("guide:hire-or-get-hired")).toBe("guide:hire-or-get-hired");
    expect(parseSrc("mcp:board-get")).toBe("mcp:board-get");
  });
  it("rejects malformed values", () => {
    for (const bad of ["", "x", "ARTICLE:x", "a b:c", ":x", "a:", "a_b:c", "mcp:board_get", 1, null, undefined, {}]) {
      expect(parseSrc(bad)).toBeNull();
    }
  });
});

describe("recordScanAttribution (201-7)", () => {
  it("writes an audit event with source=article:<slug> keyed by scanId", async () => {
    const spy = vi.spyOn(auditStore, "add").mockResolvedValue(
      {} as Awaited<ReturnType<typeof auditStore.add>>,
    );
    const scanId = `test-scan-${crypto.randomUUID()}`;
    const rec = await recordScanAttribution(
      "article:test-slug",
      "https://example.com",
      scanId,
    );
    expect(rec).toEqual({ scanId, source: "article:test-slug" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "article:test-slug",
        siteUrl: "https://example.com",
        status: "recorded",
        executionId: scanId, // dedupe key — idempotent by scanId
      }),
    );
  });
  it("ignores invalid src (no event written)", async () => {
    const spy = vi.spyOn(auditStore, "add");
    const rec = await recordScanAttribution(
      "BAD SRC!!",
      "https://e.com",
      crypto.randomUUID(),
    );
    expect(rec).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("src markers in surfaces (201-7)", () => {
  const ARTICLE: BlogArticle = {
    slug: "arc-c14-agent-discovery",
    title: "T",
    description: "d",
    tags: [],
    content: "<p>x</p>",
    author: "a",
    authorRole: "r",
    date: "2026-10-19",
    readingTime: "1 min",
  };

  it("article page CTA links to /scan?src=article:<slug>", () => {
    const html = BlogArticlePage(ARTICLE).toString();
    expect(html).toContain('href="/scan?src=article:arc-c14-agent-discovery"');
  });

  it("Knowledge Object scan action URL carries ?src=article:<slug>", () => {
    const ko = toKnowledgeObject(BLOG_ARTICLES[0]);
    const scanAction = ko.actions.find((a) =>
      a.url.includes("/scan?src="),
    );
    expect(scanAction).toBeTruthy();
    expect(scanAction!.url).toContain(
      `?src=article:${BLOG_ARTICLES[0].slug}`,
    );
  });
});
