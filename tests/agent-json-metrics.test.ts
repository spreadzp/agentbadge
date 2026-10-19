/**
 * SLICE-201-13: agent_json_request counter — per-slug + ua_class labels,
 * incremented inside GET /blog/:slug.json; UA classified best-effort.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { blogRoutes } from "../src/server/routes/blog";
import { registry } from "../src/server/metrics/metrics";
import { classifyUserAgent } from "../src/server/lib/ua-classify";
import { BLOG_ARTICLES } from "../src/server/lib/blog-data";

const app = new Hono();
app.route("/", blogRoutes);

const SLUG = BLOG_ARTICLES[0].slug;

async function counterValue(slug: string, ua: string): Promise<number> {
  const text = await registry.metrics();
  const m = text.match(
    new RegExp(
      `agent_json_requests_total\\{[^}]*slug="${slug}"[^}]*ua_class="${ua}"[^}]*\\} (\\d+)`,
    ),
  );
  return m ? Number(m[1]) : 0;
}

describe("agent_json_request metric (201-13)", () => {
  it("GET /blog/:slug.json increments counter with slug + ua_class", async () => {
    const before = await counterValue(SLUG, "fetch");
    const res = await app.request(`/blog/${SLUG}.json`, {
      headers: { "User-Agent": "curl/8.0" },
    });
    expect(res.status).toBe(200);
    const after = await counterValue(SLUG, "fetch");
    expect(after).toBe(before + 1);
  });

  it("GPTBot UA classifies as crawl", async () => {
    const before = await counterValue(SLUG, "crawl");
    await app.request(`/blog/${SLUG}.json`, {
      headers: { "User-Agent": "Mozilla/5.0 GPTBot/1.2" },
    });
    expect(await counterValue(SLUG, "crawl")).toBe(before + 1);
  });
});

describe("classifyUserAgent (201-13)", () => {
  it.each([
    ["Mozilla/5.0 GPTBot/1.2", "crawl"],
    ["ClaudeBot/1.0", "crawl"],
    ["PerplexityBot/1.0", "crawl"],
    ["CCBot/2.0", "crawl"],
    ["curl/8.0", "fetch"],
    ["Mozilla/5.0 (X11; Linux x86_64) Chrome/120", "fetch"],
    ["node-fetch/1.0", "fetch"],
  ])("classifies %s as %s", (ua, klass) => {
    expect(classifyUserAgent(ua)).toBe(klass);
  });
  it("empty/missing UA → unknown", () => {
    expect(classifyUserAgent("")).toBe("unknown");
    expect(classifyUserAgent(undefined)).toBe("unknown");
    expect(classifyUserAgent("x")).toBe("unknown");
  });
});
