import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES } from "../../src/server/lib/blog-data";

const BASE = "http://localhost:4021";

describe("SLICE-119-2: Blog → Agent Guide E2E mapping", () => {
  for (const article of BLOG_ARTICLES) {
    const guideSlug = article.agentGuideSlug ?? article.slug;

    describe(`Blog ${article.slug} → Agent Guide ${guideSlug}`, () => {
      it(`GET /agent-guide/articles/${guideSlug} returns 200`, async () => {
        const res = await fetch(`${BASE}/agent-guide/articles/${guideSlug}`);
        expect(res.status).toBe(200);
      });

      it(`blog page /blog/${article.slug} contains link to agent-guide`, async () => {
        const res = await fetch(`${BASE}/blog/${article.slug}`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain(`/agent-guide/articles/${guideSlug}`);
      });
    });
  }
});
